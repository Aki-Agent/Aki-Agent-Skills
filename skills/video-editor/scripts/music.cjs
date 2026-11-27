#!/usr/bin/env node
// Add background music to a project: copies the song into public/audio/music/, measures it and writes
// `music` into src/edit.js. Video.jsx repeats the song back to back exactly as many times as the edit
// needs and cuts the last repetition at the end of the video (never past it), with a fade-out.
// Usage: node music.cjs PROJECT_DIR SONG [--voice | --no-voice] [--db=N] [--fade-out=1] [--dry-run]
//        node music.cjs PROJECT_DIR --remove
// Volume: -27 dB under speech, -5 dB on a video without voice. Without --voice/--no-voice the project's
// captions decide (any caption word = speech). --db overrides both (what the user asked for).
// edit.js is written back as JSON (comments are lost), like cut.cjs.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {pathToFileURL} = require("node:url");
const {spawnSync} = require("node:child_process");

const VOICE_DB = -27, NO_VOICE_DB = -5;
const round = (n) => Math.round(n * 1000) / 1000;
const log = (message) => process.stderr.write(message + "\n");
const readModule = (file) => vm.runInNewContext("(" + fs.readFileSync(file, "utf8").replace(/^\s*export\s+default\s+/m, "").replace(/;\s*$/, "") + ")");
const tool = (cmd, args) => {
  const run = spawnSync(cmd, args, {encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (run.error) throw new Error(`${cmd} failed to start: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`${cmd} failed: ${run.stderr.trim()}`);
  return run;
};

(async () => {
  try {
    const args = process.argv.slice(2);
    const flags = new Map(args.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
    const [projectArg, songArg] = args.filter((a) => !a.startsWith("--"));
    if (!projectArg || (!songArg && !flags.has("remove"))) throw new Error("Usage: node music.cjs PROJECT_DIR SONG [--voice|--no-voice] [--db=N] [--fade-out=1] [--dry-run] | PROJECT_DIR --remove");
    const project = path.resolve(projectArg), editFile = path.join(project, "src", "edit.js");
    const edit = readModule(editFile);
    const write = (next) => fs.writeFileSync(editFile, "export default " + JSON.stringify(next, null, 2) + ";\n");
    const rebuildPreview = () => tool(process.execPath, [path.join(__dirname, "preview-audio.cjs"), project]);

    if (flags.has("remove")) {
      if (!edit.music) throw new Error("edit.js has no music");
      const {music, ...rest} = edit;
      write(rest);
      try { rebuildPreview(); } catch (error) { write(edit); throw error; }
      log(`Removed music ${music.src} (the file stays in public/)`);
      return;
    }

    const song = path.resolve(songArg);
    if (!fs.existsSync(song)) throw new Error(`Song not found: ${song}`);
    const probe = JSON.parse(tool("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", song]).stdout);
    if (!probe.streams.some((s) => s.codec_type === "audio")) throw new Error(`${song} has no audio stream`);
    const songSeconds = Number(probe.format.duration);
    if (!(songSeconds > 0)) throw new Error(`Could not read the duration of ${song}`);
    const peak = /max_volume: (-?[\d.]+) dB/.exec(tool("ffmpeg", ["-v", "info", "-nostdin", "-i", song, "-vn", "-af", "volumedetect", "-f", "null", "-"]).stderr);

    // Output length with the project's own timeline, exactly as Studio and the render compute it.
    // Music covers the speech only: a closing `outro` tail (an `endcard`) stays silent.
    const {clipsInFrames, durationInFrames} = await import(pathToFileURL(path.join(project, "src", "timeline.mjs")).href);
    const editSeconds = durationInFrames(edit) / edit.fps;

    let voice, reason;
    if (flags.has("voice")) { voice = true; reason = "--voice"; }
    else if (flags.has("no-voice")) { voice = false; reason = "--no-voice"; }
    else {
      const captionsFile = path.join(project, "src", "captions.js");
      const words = fs.existsSync(captionsFile) ? readModule(captionsFile).length : 0;
      voice = words > 0; reason = `${words} caption words in the project`;
    }
    const volumeDb = flags.has("db") ? Number(flags.get("db")) : voice ? VOICE_DB : NO_VOICE_DB;
    if (!Number.isFinite(volumeDb)) throw new Error(`--db must be a number of dB, got ${flags.get("db")}`);
    const fadeOut = flags.has("fade-out") ? Number(flags.get("fade-out")) : 1;

    const name = path.basename(song).replace(/[^\w.-]+/g, "-");
    const src = `audio/music/${name}`, target = path.join(project, "public", "audio", "music", name);
    // Same frame math as Video.jsx: whole song frames per repetition, the last one cut at the end.
    const music = {src, duration: round(songSeconds), volumeDb, fadeOut};
    const songFrames = Math.max(1, Math.floor(music.duration * edit.fps)), total = clipsInFrames(edit);
    const repeats = Math.ceil(total / songFrames), lastSeconds = (total - (repeats - 1) * songFrames) / edit.fps;
    const report = {ok: true, dryRun: flags.has("dry-run"), music, songSeconds: round(songSeconds), editSeconds: round(editSeconds),
      repeats, lastRepeatSeconds: round(lastSeconds), songPeakDb: peak ? Number(peak[1]) : null, voice, voiceFrom: reason};

    if (!flags.has("dry-run")) {
      fs.mkdirSync(path.dirname(target), {recursive: true});
      if (!fs.existsSync(target) || fs.statSync(target).size !== fs.statSync(song).size) fs.copyFileSync(song, target);
      write({...edit, music});
      try { rebuildPreview(); } catch (error) { write(edit); throw error; }
    }
    log(`${report.dryRun ? "Dry run: " : ""}song ${report.songSeconds} s, edit ${report.editSeconds} s -> ${repeats} repetition(s), last one ${report.lastRepeatSeconds} s; `
      + `${volumeDb} dB (${voice ? "speech" : "no voice"}, from ${reason}), fade-out ${fadeOut} s`);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error("ERROR:", error.message);
    process.exitCode = 1;
  }
})();
