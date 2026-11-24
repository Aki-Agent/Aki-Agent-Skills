#!/usr/bin/env node
// Create an isolated Remotion project from local media and optional word timestamps.
// Usage: node create-project.cjs VIDEO PROJECT_DIR [TRANSCRIPT_JSON] [--proxy|--no-proxy] [--copy] [--deps=DIR] [--no-install] [--install-timeout=MIN]
const fs = require("node:fs");
const path = require("node:path");
const {execFileSync, spawnSync} = require("node:child_process");

const REMOTION = "4.0.546";
const DEPENDENCIES = {"@remotion/cli":REMOTION, "@remotion/media":REMOTION, "@remotion/captions":REMOTION, remotion:REMOTION, react:"19.2.0", "react-dom":"19.2.0"};
const TEMPLATE_FILES = ["index.jsx", "Video.jsx", "components.jsx", "timeline.mjs", "themes.mjs"];

const log = (message) => process.stderr.write(message + "\n");

// Hardlink the source when possible (instant, no extra disk); copy across drives or on refusal.
const linkOrCopy = (from, to, forceCopy) => {
  if (!forceCopy) {
    try { fs.linkSync(from, to); return "hardlink"; } catch (error) { if (!["EXDEV","EPERM","EACCES","ENOTSUP"].includes(error.code)) throw error; }
  }
  fs.copyFileSync(from, to);
  return "copy";
};

// npm can be a broken Corepack shim; the pinned npx fallback was verified in this environment.
// Each attempt is bounded, so an unreachable registry ends with its real error instead of hanging.
const npmInstall = (dir, minutes) => {
  const args = ["install", "--no-audit", "--no-fund"];
  const options = {cwd:dir, shell:true, stdio:["ignore","inherit","pipe"], encoding:"utf8", timeout:minutes*60*1000};
  const failure = (run) => ((run.stderr || "").trim() + (run.error?.code === "ETIMEDOUT" || run.signal ? `\n(stopped after ${minutes} min)` : run.error ? "\n" + run.error.message : "")).trim();
  let run = spawnSync("npm", args, options);
  if (run.status === 0) return "npm";
  const first = failure(run);
  log("npm install failed, retrying with npx npm@10.9.2:\n" + first);
  run = spawnSync("npx", ["--yes", "npm@10.9.2", ...args], options);
  if (run.status !== 0) throw new Error("Dependency install failed.\nnpm: " + first + "\nnpx npm@10.9.2: " + failure(run));
  return "npx npm@10.9.2";
};

// One installed node_modules is shared by every project through a directory junction, so a new
// project does not reinstall ~240 packages. The shared folder is created once, before the project,
// so a failed install leaves no half-created project behind.
const ensureDependencies = (depsDir, install, minutes) => {
  const modules = path.join(depsDir, "node_modules");
  let installedWith = null;
  if (!fs.existsSync(path.join(modules, "remotion", "package.json"))) {
    if (!install) return {status:"skipped", depsDir, modules:null};
    fs.mkdirSync(depsDir, {recursive:true});
    fs.writeFileSync(path.join(depsDir, "package.json"), JSON.stringify({name:"remotion-shared-deps", private:true, dependencies:DEPENDENCIES}, null, 2) + "\n");
    log("Installing shared dependencies once into " + depsDir);
    installedWith = npmInstall(depsDir, minutes);
  }
  const installed = JSON.parse(fs.readFileSync(path.join(modules, "remotion", "package.json"), "utf8")).version;
  if (installed !== REMOTION) throw new Error(`Shared deps at ${depsDir} have remotion ${installed}, expected ${REMOTION}`);
  return {status: installedWith ? "installed" : "reused", depsDir, installedWith, modules};
};

// Light preview copy for Studio: short side 720 px, 30 fps, a keyframe every second for fast seeking.
const makeProxy = (source, output, width, height) => {
  const scale = width >= height ? "scale=-2:720" : "scale=720:-2";
  const run = spawnSync("ffmpeg", ["-v","error","-y","-i",source,"-vf",scale,"-r","30","-c:v","libx264","-preset","veryfast","-crf","23",
    "-g","30","-pix_fmt","yuv420p","-c:a","aac","-b:a","128k","-movflags","+faststart",output], {encoding:"utf8"});
  if (run.error || run.status !== 0) throw new Error("Proxy encoding failed: " + (run.stderr || run.error?.message));
};

try {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = new Map(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
  const [inputArg, targetArg, transcriptArg] = positional;
  if (!inputArg || !targetArg) throw new Error("Usage: node create-project.cjs VIDEO PROJECT_DIR [TRANSCRIPT_JSON] [--proxy|--no-proxy] [--copy] [--deps=DIR] [--no-install] [--install-timeout=MIN]");
  const source = path.resolve(inputArg), target = path.resolve(targetArg);
  if (!fs.statSync(source).isFile()) throw new Error("Input must be a file");
  if (fs.existsSync(target)) throw new Error("Project directory already exists: " + target);
  const info = JSON.parse(execFileSync("ffprobe", ["-v","error","-show_streams","-show_format","-of","json",source], {encoding:"utf8"}));
  const video = info.streams.find(s => s.codec_type === "video");
  if (!video) throw new Error("Input has no video stream");
  const [num,den] = (video.avg_frame_rate || "0/1").split("/").map(Number);
  const fps = num / den, duration = Number(video.duration || info.format.duration);
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(duration) || duration <= 0) throw new Error("Video has no usable frame rate or duration");
  let captions = [];
  if (transcriptArg) {
    const transcript = JSON.parse(fs.readFileSync(path.resolve(transcriptArg),"utf8"));
    if (!Array.isArray(transcript.segments)) throw new Error("Transcript must contain segments with word timestamps");
    captions = transcript.segments.flatMap(s => s.words || []).filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && typeof w.word === "string").map(w => ({
      text:w.word, startMs:Math.round(w.start*1000), endMs:Math.round(w.end*1000),
      timestampMs:Math.round((w.start+w.end)*500), confidence:w.probability ?? null
    }));
    if (!captions.length) throw new Error("Transcript contains no timed words");
  }
  // Proxy by default for sources above 1080 px on the short side or above 30 fps.
  const large = Math.min(video.width, video.height) > 1080 || fps > 31;
  const wantProxy = flags.has("proxy") || (large && !flags.has("no-proxy"));
  const depsDir = path.resolve(typeof flags.get("deps") === "string" ? flags.get("deps") : path.join(path.dirname(target), ".cache", "video-editor", "remotion-" + REMOTION));
  const minutes = Number(flags.get("install-timeout") ?? 10);
  if (!(minutes > 0)) throw new Error("--install-timeout must be a positive number of minutes");
  const {modules, ...deps} = ensureDependencies(depsDir, !flags.has("no-install"), minutes);
  const template = path.resolve(__dirname, "../template");
  const ext = path.extname(source).toLowerCase() || ".mp4";
  const config = {source:"source"+ext, ...(wantProxy ? {proxy:"proxy.mp4"} : {}), width:video.width, height:video.height, fps, clips:[{start:0,end:Math.floor(duration*fps)/fps}], zooms:[], overlays:[], screens:[]};
  fs.mkdirSync(path.join(target,"src"),{recursive:true});
  fs.mkdirSync(path.join(target,"public"),{recursive:true});
  const sourceMode = linkOrCopy(source, path.join(target,"public",config.source), flags.has("copy"));
  const started = Date.now();
  if (wantProxy) makeProxy(source, path.join(target,"public",config.proxy), video.width, video.height);
  const proxySeconds = wantProxy ? Math.round((Date.now() - started) / 100) / 10 : null;
  for (const file of TEMPLATE_FILES) fs.copyFileSync(path.join(template,file),path.join(target,"src",file));
  fs.writeFileSync(path.join(target,"src","edit.js"),"export default "+JSON.stringify(config,null,2)+";\n");
  fs.writeFileSync(path.join(target,"src","captions.js"),"export default "+JSON.stringify(captions)+";\n");
  const pkg={name:"remotion-video-project",private:true,version:"1.0.0",dependencies:DEPENDENCIES};
  fs.writeFileSync(path.join(target,"package.json"),JSON.stringify(pkg,null,2)+"\n");
  if (modules) fs.symlinkSync(modules, path.join(target, "node_modules"), "junction");
  const result = {project:target, width:video.width, height:video.height, fps, duration, words:captions.length,
    source:sourceMode, proxy:wantProxy ? config.proxy : null, proxySeconds, dependencies:deps};
  log(`Project ${target}: ${video.width}x${video.height} @ ${Math.round(fps*1000)/1000} fps, ${duration.toFixed(2)} s, ${captions.length} words; source ${sourceMode}`
    + (wantProxy ? `; proxy in ${proxySeconds} s` : "") + `; dependencies ${deps.status}` + (deps.status === "skipped" ? " (run npm install in the project)" : ""));
  console.log(JSON.stringify(result,null,2));
} catch (error) {
  console.error("ERROR:",error.message);
  process.exitCode=1;
}
