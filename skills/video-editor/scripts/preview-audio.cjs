#!/usr/bin/env node
// Build the continuous preview audio track that Remotion Studio plays.
// Usage: node preview-audio.cjs PROJECT_DIR [--source=proxy|source]
//
// Why this exists: in Studio each clip is its own player, so every join makes the audio
// scheduler seek inside the media file. When that seek is not ready in time Studio drops
// 0.1-0.7 s of sound at the join (renders are not affected: they wait for every frame).
// Playing one pre-joined audio file removes the seek entirely. Measured on a 62-clip edit:
// 1600-2043 ms of dropped audio per 30 s before, 0-107 ms after, three cold runs each.
//
// The output mixes the edited voice, music and effects into public/<previewAudio>. It is rebuilt
// by create-project.cjs, auto-edit.cjs, cut.cjs and music.cjs, and is only used in Studio.
// Renders keep their original audio layers.
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const vm = require("node:vm");
const {pathToFileURL} = require("node:url");

const log = (message) => process.stderr.write(message + "\n");
const DEFAULT_NAME = "preview-audio.wav";

// Read project modules without importing them.
const readModule = (file) => vm.runInNewContext("(" + fs.readFileSync(file, "utf8")
  .replace(/^\s*export\s+default\s+/, "").replace(/;\s*$/, "") + ")");
const readEdit = (project) => readModule(path.join(project, "src", "edit.js"));

const probeDuration = (file) => {
  const out = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", file], {encoding: "utf8"});
  const parsed = JSON.parse(out.stdout || "{}");
  return Number(parsed.format?.duration);
};

const build = async (project, options = {}) => {
  const edit = readEdit(project);
  const timeline = await import(pathToFileURL(path.join(__dirname, "../template/timeline.mjs")).href);
  const captionsFile = path.join(project, "src", "captions.js");
  const captions = fs.existsSync(captionsFile) ? timeline.keptCaptions(readModule(captionsFile), edit) : [];
  const sounds = timeline.resolveSounds(edit, captions);
  const fps = Number(edit.fps);
  const clips = edit.clips || [];
  if (!fps || !clips.length) throw new Error("edit.js has no fps or no clips");
  const media = options.source === "source" ? edit.source : (edit.proxy || edit.source);
  const mediaPath = path.join(project, "public", media);
  if (!fs.existsSync(mediaPath)) throw new Error("Media not found: " + mediaPath);

  // Same frame rounding as template/timeline.mjs, so audio and picture cut at the same sample.
  const ranges = clips.map((c) => ({start: Math.round(c.start * fps) / fps, end: Math.round(c.end * fps) / fps}));
  const graph = ranges.map((r, i) => `[0:a]atrim=start=${r.start.toFixed(6)}:end=${r.end.toFixed(6)},asetpts=PTS-STARTPTS[a${i}]`);
  graph.push(ranges.map((_, i) => `[a${i}]`).join("") + `concat=n=${ranges.length}:v=0:a=1[out]`);
  const graphFile = path.join(project, ".preview-audio.graph");
  fs.writeFileSync(graphFile, graph.join(";"));

  const name = edit.previewAudio || DEFAULT_NAME;
  const output = path.join(project, "public", name);
  const speech = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
  // `outro` is a silent closing tail (an `endcard` lives there), so the mix is longer than the voice.
  const outro = Math.max(0, Number(edit.outro) || 0);
  const expected = speech + outro;
  // Pass 1: concatenate the clips. The joined length is checked before anything is padded, so clips
  // that point past the end of the media (stale edit.js) fail loudly instead of turning into silence.
  const joined = path.join(project, "public", ".preview-audio.tmp.wav");
  const run = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", mediaPath, "-filter_complex_script", graphFile,
    "-map", "[out]", "-c:a", "pcm_s16le", joined], {encoding: "utf8"});
  fs.rmSync(graphFile, {force: true});
  if (run.error || run.status !== 0) throw new Error("Preview audio build failed: " + (run.stderr || run.error?.message));

  const natural = probeDuration(joined);
  if (!Number.isFinite(natural)) throw new Error("Joined preview audio has no readable duration");
  // AAC frames pad the tail by up to ~0.03 s; anything larger means the clips do not match the media.
  const slack = Math.max(0.05, 2 / fps);
  if (natural < speech - slack) {
    throw new Error(`Joined preview audio is ${natural.toFixed(3)} s but the speech is ${speech.toFixed(3)} s: clips point past the end of ${media}`);
  }
  if (natural > speech + slack) {
    throw new Error(`Joined preview audio is ${natural.toFixed(3)} s but the speech is ${speech.toFixed(3)} s: clips overlap or fps is wrong`);
  }

  // Mix the voice, repeated music, and all resolved effects into one Studio audio stream.
  // Frame rounding and effect placement match Video.jsx. The render still plays its own layers.
  // Music stops with the speech (the closing tail stays silent); effects may run into the tail.
  const rate = 48000, speechFrames = Math.round(speech * fps), totalFrames = Math.round(expected * fps);
  const inputs = ["-i", joined], mix = [
    `[0:a]aresample=${rate},aformat=channel_layouts=stereo,apad=whole_dur=${expected.toFixed(6)},atrim=duration=${expected.toFixed(6)}[voice]`
  ], labels = ["[voice]"];
  const addInput = (src) => {
    const file = path.join(project, "public", src);
    if (!fs.existsSync(file)) throw new Error("Audio file not found: " + file);
    const index = inputs.length / 2;
    inputs.push("-i", file);
    return index;
  };
  if (edit.music) {
    const music = edit.music, index = addInput(music.src);
    const songFrames = Math.max(1, Math.floor(music.duration * fps));
    const songSeconds = songFrames / fps, fadeFrames = timeline.toFrame(music.fadeOut ?? 1, fps);
    if (!Number.isFinite(songSeconds) || !Number.isFinite(fadeFrames)) throw new Error("Invalid music duration or fade");
    const fade = fadeFrames > 0 ? `,volume=${Math.min(1, speechFrames / fadeFrames)},afade=t=out:st=${Math.max(0, (speechFrames - fadeFrames) / fps)}:d=${Math.min(fadeFrames, speechFrames) / fps}` : "";
    mix.push(`[${index}:a]aresample=${rate},aformat=channel_layouts=stereo,apad=whole_dur=${songSeconds},atrim=duration=${songSeconds},aloop=loop=-1:size=${Math.round(songSeconds * rate)},atrim=duration=${speech},asetpts=PTS-STARTPTS,volume=${music.volumeDb ?? -27}dB${fade}[music]`);
    labels.push("[music]");
  }
  for (const s of sounds) {
    const from = Math.max(0, timeline.toFrame(s.start + (s.offset ?? 0), fps));
    const length = Math.min(totalFrames - from, timeline.toFrame(s.seconds ?? 4, fps));
    if (from >= totalFrames || length <= 0) continue;
    if (!Number.isFinite(from) || !Number.isFinite(length)) throw new Error("Invalid sound effect timing: " + s.src);
    const index = addInput(s.src), label = `sfx${labels.length}`;
    mix.push(`[${index}:a]aresample=${rate},aformat=channel_layouts=stereo,atrim=duration=${length / fps},asetpts=PTS-STARTPTS,volume=${s.volumeDb ?? -15}dB,adelay=${Math.round(from / fps * rate)}S:all=1[${label}]`);
    labels.push(`[${label}]`);
  }
  mix.push(labels.join("") + `amix=inputs=${labels.length}:duration=first:normalize=0[out]`);
  fs.writeFileSync(graphFile, mix.join(";"));
  const mixed = path.join(project, "public", ".preview-audio.mix.wav");
  const fix = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex_script", graphFile,
    "-map", "[out]", "-c:a", "pcm_s16le", mixed], {encoding: "utf8"});
  fs.rmSync(graphFile, {force: true});
  fs.rmSync(joined, {force: true});
  if (fix.error || fix.status !== 0) throw new Error("Preview audio mix failed: " + (fix.stderr || fix.error?.message));

  const duration = probeDuration(mixed);
  if (!Number.isFinite(duration)) throw new Error("Preview audio has no readable duration: " + output);

  // One frame of drift is audible as a lip-sync error, so refuse anything above half a frame.
  const tolerance = 0.5 / fps;
  if (Math.abs(duration - expected) > tolerance) {
    throw new Error(`Preview audio is ${duration.toFixed(3)} s but the edit is ${expected.toFixed(3)} s (tolerance ${tolerance.toFixed(4)} s)`);
  }
  fs.renameSync(mixed, output);
  // A changed URL makes Studio reload decoded audio after every successful rebuild.
  fs.writeFileSync(path.join(project, "src", "preview-version.js"), `export default "${Date.now()}-${process.pid}";\n`);
  return {previewAudio: name, clips: ranges.length, sounds: sounds.length, music: Boolean(edit.music), seconds: Number(duration.toFixed(3)), expected: Number(expected.toFixed(3)), source: media};
};

if (require.main === module) {
  (async () => { try {
    const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
    const flags = new Map(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
    const [projectArg] = positional;
    if (!projectArg) throw new Error("Usage: node preview-audio.cjs PROJECT_DIR [--source=proxy|source]");
    const result = await build(path.resolve(projectArg), {source: flags.get("source") === "source" ? "source" : "proxy"});
    log(`Preview audio: ${result.previewAudio}, ${result.clips} clips, ${result.seconds} s`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("ERROR:", error.message);
    process.exitCode = 1;
  } })();
}

module.exports = {build, readEdit, DEFAULT_NAME};
