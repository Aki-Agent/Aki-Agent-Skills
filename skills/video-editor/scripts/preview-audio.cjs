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
// The output is written to public/<previewAudio> and its name is stored in src/edit.js as
// `previewAudio`, so template/Video.jsx picks it up. It is rebuilt by create-project.cjs and
// by cut.cjs after every cut, and it is only used in Studio: renders keep the original audio.
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");

const log = (message) => process.stderr.write(message + "\n");
const DEFAULT_NAME = "preview-audio.wav";

// Reads src/edit.js (JSON written by the scripts) without importing it.
const readEdit = (project) => JSON.parse(fs.readFileSync(path.join(project, "src", "edit.js"), "utf8")
  .replace(/^\s*export\s+default\s+/, "").replace(/;\s*$/, ""));

const probeDuration = (file) => {
  const out = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", file], {encoding: "utf8"});
  const parsed = JSON.parse(out.stdout || "{}");
  return Number(parsed.format?.duration);
};

const build = (project, options = {}) => {
  const edit = readEdit(project);
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
  const expected = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);

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
  if (natural < expected - slack) {
    throw new Error(`Joined preview audio is ${natural.toFixed(3)} s but the edit is ${expected.toFixed(3)} s: clips point past the end of ${media}`);
  }
  if (natural > expected + slack) {
    throw new Error(`Joined preview audio is ${natural.toFixed(3)} s but the edit is ${expected.toFixed(3)} s: clips overlap or fps is wrong`);
  }

  // Pass 2: pad a short tail with silence and cut a long one, so the track matches the edit exactly.
  const fix = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", joined, "-af",
    `apad=whole_dur=${expected.toFixed(6)},atrim=start=0:end=${expected.toFixed(6)}`,
    "-c:a", "pcm_s16le", output], {encoding: "utf8"});
  fs.rmSync(joined, {force: true});
  if (fix.error || fix.status !== 0) throw new Error("Preview audio padding failed: " + (fix.stderr || fix.error?.message));

  const duration = probeDuration(output);
  if (!Number.isFinite(duration)) throw new Error("Preview audio has no readable duration: " + output);

  // One frame of drift is audible as a lip-sync error, so refuse anything above half a frame.
  const tolerance = 0.5 / fps;
  if (Math.abs(duration - expected) > tolerance) {
    throw new Error(`Preview audio is ${duration.toFixed(3)} s but the edit is ${expected.toFixed(3)} s (tolerance ${tolerance.toFixed(4)} s)`);
  }
  return {previewAudio: name, clips: ranges.length, seconds: Number(duration.toFixed(3)), expected: Number(expected.toFixed(3)), source: media};
};

if (require.main === module) {
  try {
    const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
    const flags = new Map(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
    const [projectArg] = positional;
    if (!projectArg) throw new Error("Usage: node preview-audio.cjs PROJECT_DIR [--source=proxy|source]");
    const result = build(path.resolve(projectArg), {source: flags.get("source") === "source" ? "source" : "proxy"});
    log(`Preview audio: ${result.previewAudio}, ${result.clips} clips, ${result.seconds} s`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("ERROR:", error.message);
    process.exitCode = 1;
  }
}

module.exports = {build, readEdit, DEFAULT_NAME};
