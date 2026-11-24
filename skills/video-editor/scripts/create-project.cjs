#!/usr/bin/env node
// Create an isolated Remotion project from local media and optional word timestamps.
const fs = require("node:fs");
const path = require("node:path");
const {execFileSync} = require("node:child_process");

try {
  const [inputArg, targetArg, transcriptArg] = process.argv.slice(2);
  if (!inputArg || !targetArg) throw new Error("Usage: node create-project.cjs VIDEO PROJECT_DIR [TRANSCRIPT_JSON]");
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
  const template = path.resolve(__dirname, "../template");
  const ext = path.extname(source).toLowerCase() || ".mp4";
  const config = {source:"source"+ext, width:video.width, height:video.height, fps, clips:[{start:0,end:Math.floor(duration*fps)/fps}], zooms:[], overlays:[], screens:[]};
  fs.mkdirSync(path.join(target,"src"),{recursive:true});
  fs.mkdirSync(path.join(target,"public"),{recursive:true});
  fs.copyFileSync(source,path.join(target,"public",config.source));
  fs.copyFileSync(path.join(template,"index.jsx"),path.join(target,"src","index.jsx"));
  fs.copyFileSync(path.join(template,"Video.jsx"),path.join(target,"src","Video.jsx"));
  fs.writeFileSync(path.join(target,"src","edit.js"),"export default "+JSON.stringify(config,null,2)+";\n");
  fs.writeFileSync(path.join(target,"src","captions.js"),"export default "+JSON.stringify(captions)+";\n");
  const pkg={name:"remotion-video-project",private:true,version:"1.0.0",dependencies:{"@remotion/cli":"4.0.546","@remotion/media":"4.0.546","@remotion/captions":"4.0.546",remotion:"4.0.546",react:"19.2.0","react-dom":"19.2.0"}};
  fs.writeFileSync(path.join(target,"package.json"),JSON.stringify(pkg,null,2)+"\n");
  console.log(JSON.stringify({project:target,width:video.width,height:video.height,fps,duration,words:captions.length},null,2));
} catch (error) {
  console.error("ERROR:",error.message);
  process.exitCode=1;
}
