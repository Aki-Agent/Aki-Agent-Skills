#!/usr/bin/env node
// Export the edit to a video file the fast way, in one command.
// Usage: node export.cjs PROJECT_DIR OUTPUT.mp4 [--quality=1080p|1440p|2160p] [--fps=30|60] [--concurrency=N]
//        [--crf=18] [--x264-preset=veryfast] [--frames=A-B] [--decode=d3d11va|none]
// Default 1080p 30 fps. 1440p ("2K"), 2160p ("4K") and 60 fps are allowed but slower (see SKILL.md).
// 1. Builds a "flat" render source once: only the kept clips, already scaled and at the output fps, encoded in
//    parallel with FFmpeg (decoding the 4K original is what makes a direct render slow), joined into one file,
//    plus the audio cut the same way in a single pass. It is cached in WORK_DIR/render/<size>@<fps>/ and reused
//    while clips, source, size and fps do not change (screens, zooms, captions and theme can change freely).
// 2. Renders with Remotion from that folder (--public-dir), so the multi-GB original is not copied into the bundle.
// 3. Checks the output with ffprobe and prints a JSON summary with the timings.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawn, spawnSync} = require("node:child_process");
const {pathToFileURL} = require("node:url");

const MEDIA = /\.(mp4|mov|mkv|webm|m4v|avi|wav|m4a|mp3|aac|flac|ogg)$/i;
const log = (m) => process.stderr.write(m + "\n");
const secondsSince = (t) => Math.round((Date.now() - t) / 100) / 10;
const readModule = (file) => vm.runInNewContext("(" + fs.readFileSync(file, "utf8").replace(/^\s*export\s+default\s+/m, "").replace(/;\s*$/, "") + ")");
const run = (cmd, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, {stdio: ["ignore", "pipe", "pipe"], ...options});
  let err = "";
  child.stdout.on("data", (d) => { if (options.echo) process.stderr.write(d); }); // Remotion prints its progress on stdout
  child.stderr.on("data", (d) => { err = (err + d).slice(-4000); if (options.echo) process.stderr.write(d); });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.slice(-1500)}`)));
});
const pool = async (jobs, size) => { let next = 0; await Promise.all(Array.from({length: size}, async () => { while (next < jobs.length) await jobs[next++](); })); };

(async () => {
  const args = process.argv.slice(2);
  const flags = new Map(args.filter((a) => a.startsWith("--")).map((a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.length ? v.join("=") : true]; }));
  const [projectArg, outputArg] = args.filter((a) => !a.startsWith("--"));
  if (!projectArg || !outputArg) throw new Error("Usage: node export.cjs PROJECT_DIR OUTPUT.mp4 [--quality=1080p|1440p|2160p] [--fps=30|60] [--concurrency=N]");
  const started = Date.now(), timings = {};
  const project = path.resolve(projectArg), output = path.resolve(outputArg), work = path.dirname(project);
  const edit = readModule(path.join(project, "src", "edit.js"));
  const source = path.join(project, "public", edit.source);

  // Output size from the short side; fps never above the edit's.
  const short = Number(String(flags.get("quality") ?? "1080p").replace(/p$/i, "").replace(/^2k$/i, "1440").replace(/^4k$/i, "2160"));
  const fps = Math.min(Number(flags.get("fps") ?? 30), edit.fps);
  const scale = Math.min(1, short / Math.min(edit.width, edit.height));
  const even = (n) => Math.round(n / 2) * 2;
  const width = even(edit.width * scale), height = even(edit.height * scale);
  if (short > 1080 || fps > 30) log(`Note: ${width}x${height} @ ${fps} fps is slower than the 1080p 30 fps default.`);

  // Clips at the output fps, exactly as the template builds them.
  const {buildClips} = await import(pathToFileURL(path.join(project, "src", "timeline.mjs")).href);
  const clips = buildClips({...edit, fps});
  const frames = clips.reduce((s, c) => s + c.length, 0);
  // `outro` adds silent frames after the last clip (the closing card); they are not in the flat source.
  const tailFrames = Math.round((Number(edit.outro) || 0) * fps);
  // 1. Flat render source (cached).
  const dir = path.join(work, "render", `${width}x${height}@${fps}`), flat = path.join(dir, "render.mp4"), stamp = path.join(dir, "render.json");
  const st = fs.statSync(source);
  const key = JSON.stringify({source: edit.source, size: st.size, mtime: st.mtimeMs, width, height, fps, clips: clips.map((c) => [c.srcFrom, c.length])});
  let t = Date.now();
  if (fs.existsSync(flat) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === key) log(`Reusing ${flat}`);
  else {
    fs.rmSync(dir, {recursive: true, force: true});
    fs.mkdirSync(path.join(dir, "parts"), {recursive: true});
    const decode = flags.get("decode") ?? "d3d11va", hw = decode === "none" ? [] : ["-hwaccel", decode];
    const crf = String(Math.max(10, Number(flags.get("crf") ?? 18) - 4)); // intermediate a little above the final quality
    const jobs = clips.map((c, i) => async () => {
      const part = path.join(dir, "parts", `${String(i).padStart(4, "0")}.mp4`);
      const a = ["-v", "error", "-y", ...hw, "-ss", (c.srcFrom / fps).toFixed(6), "-i", source, "-frames:v", String(c.length), "-an",
        "-vf", `fps=${fps},scale=${width}:${height}:flags=bicubic`, "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-g", String(fps), "-r", String(fps), part];
      // Hardware decode is not available everywhere: fall back to CPU decoding for this part.
      try { await run("ffmpeg", a); } catch (error) { if (!hw.length) throw error; await run("ffmpeg", a.filter((x, k) => !(k >= 3 && k < 3 + hw.length))); }
    });
    await pool(jobs, Math.max(2, Math.min(6, Math.floor(require("node:os").cpus().length / 3))));
    fs.writeFileSync(path.join(dir, "parts.txt"), clips.map((_, i) => `file 'parts/${String(i).padStart(4, "0")}.mp4'`).join("\n") + "\n");
    timings.videoParts = secondsSince(t);
    // Audio: the same clips from the original in one pass, joined sample-accurately, one AAC encode.
    t = Date.now();
    const graph = clips.map((c, i) => `[0:a]atrim=start=${(c.srcFrom / fps).toFixed(6)}:end=${((c.srcFrom + c.length) / fps).toFixed(6)},asetpts=PTS-STARTPTS[a${i}]`).join(";")
      + ";" + clips.map((_, i) => `[a${i}]`).join("") + `concat=n=${clips.length}:v=0:a=1[a]`;
    fs.writeFileSync(path.join(dir, "audio.graph"), graph);
    await run("ffmpeg", ["-v", "error", "-y", "-vn", "-i", source, "-filter_complex_script", path.join(dir, "audio.graph"), "-map", "[a]", "-c:a", "aac", "-b:a", "192k", path.join(dir, "audio.m4a")]);
    await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(dir, "parts.txt"), "-i", path.join(dir, "audio.m4a"), "-map", "0:v", "-map", "1:a", "-c", "copy", "-movflags", "+faststart", flat]);
    fs.rmSync(path.join(dir, "parts"), {recursive: true, force: true});
    fs.writeFileSync(stamp, key);
    timings.audioAndJoin = secondsSince(t);
  }
  // Fonts and images of public/ next to the render source; media files stay out of the bundle.
  for (const f of fs.readdirSync(path.join(project, "public"))) if (!MEDIA.test(f)) fs.cpSync(path.join(project, "public", f), path.join(dir, f), {recursive: true});
  timings.prepare = secondsSince(started);

  // 2. Render.
  t = Date.now();
  const cli = path.join(project, "node_modules", "@remotion", "cli", "remotion-cli.js");
  const renderArgs = [cli, "render", "src/index.jsx", "EditedVideo", output, `--public-dir=${dir}`, `--props=${JSON.stringify({fps, source: "render.mp4", flat: true})}`,
    `--scale=${scale}`, `--concurrency=${flags.get("concurrency") ?? Math.max(1, require("node:os").cpus().length - 2)}`, `--crf=${flags.get("crf") ?? 18}`,
    `--x264-preset=${flags.get("x264-preset") ?? "veryfast"}`, "--audio-bitrate=192k", ...(flags.has("frames") ? [`--frames=${flags.get("frames")}`] : [])];
  await run(process.execPath, renderArgs, {cwd: project, echo: true});
  timings.render = secondsSince(t);

  // 3. Verify.
  const probe = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames", "-of", "json", output], {encoding: "utf8"}).stdout);
  const video = probe.streams.find((s) => s.codec_type === "video"), audio = probe.streams.find((s) => s.codec_type === "audio");
  const expected = flags.has("frames") ? null : Math.round((frames + tailFrames) / fps * 1000) / 1000;
  const duration = Number(probe.format.duration);
  const ok = Boolean(video && audio && video.width === width && video.height === height && (expected === null || Math.abs(duration - expected) < 0.1));
  timings.total = secondsSince(started);
  console.log(JSON.stringify({ok, output, width: video?.width, height: video?.height, fps: video?.r_frame_rate, duration, expected, frames,
    sizeMB: Math.round(Number(probe.format.size) / 1048576 * 10) / 10, audio: audio?.codec_name ?? null, renderSource: flat, timings}, null, 2));
  if (!ok) process.exitCode = 1;
})().catch((error) => { console.error("ERROR:", error.message); process.exitCode = 1; });
