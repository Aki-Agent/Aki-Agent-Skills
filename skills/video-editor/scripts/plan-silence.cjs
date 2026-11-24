#!/usr/bin/env node
// Propose aggressive silence cuts while keeping word-timestamp guard regions.
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");

try {
  const [inputArg, transcriptArg, outputArg] = process.argv.slice(2);
  if (!inputArg || !transcriptArg || !outputArg) {
    throw new Error("Usage: node plan-silence.cjs VIDEO TRANSCRIPT_JSON NEW_PLAN_JSON");
  }
  const input=path.resolve(inputArg), output=path.resolve(outputArg);
  if (fs.existsSync(output)) throw new Error("Plan already exists: "+output);
  const transcript=JSON.parse(fs.readFileSync(path.resolve(transcriptArg),"utf8"));
  if (!Array.isArray(transcript.segments)) throw new Error("Transcript is missing segments");
  const words=transcript.segments.flatMap(s=>s.words || [])
    .filter(w=>Number.isFinite(w.start) && Number.isFinite(w.end) && w.end>w.start);
  if (!words.length) throw new Error("Transcript contains no timed words");
  const probe=spawnSync("ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",input],{encoding:"utf8"});
  if (probe.error || probe.status!==0) throw new Error(probe.stderr || probe.error?.message || "ffprobe failed");
  const duration=Number(probe.stdout.trim());
  if (!Number.isFinite(duration) || duration<=0) throw new Error("Invalid source duration");
  const run=spawnSync("ffmpeg",["-hide_banner","-nostdin","-i",input,"-vn","-af","silencedetect=noise=-35dB:d=0.5","-f","null","-"],{encoding:"utf8",maxBuffer:16*1024*1024});
  if (run.error || run.status!==0) throw new Error(run.stderr || run.error?.message || "ffmpeg failed");
  const silences=[...run.stderr.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)]
    .map(m=>({start:Number(m[1]),end:Number(m[2])}));
  const guard=0.08, pad=0.08, minimumCut=0.2, cuts=[];
  for (const silence of silences) {
    let ranges=[[Math.max(0,silence.start+pad),Math.min(duration,silence.end-pad)]];
    for (const word of words) {
      const left=word.start-guard, right=word.end+guard, next=[];
      for (const [a,b] of ranges) {
        if (right<=a || left>=b) next.push([a,b]);
        else {
          if (left>a) next.push([a,Math.min(left,b)]);
          if (right<b) next.push([Math.max(right,a),b]);
        }
      }
      ranges=next;
      if (!ranges.length) break;
    }
    for (const [start,end] of ranges) if (end-start>=minimumCut) {
      // Round inward: never remove more than the protected interval allows.
      cuts.push({start:Math.ceil(start*1000)/1000,end:Math.floor(end*1000)/1000});
    }
  }
  const clips=[]; let last=0;
  for (const cut of cuts) {
    if (cut.start>last) clips.push({start:last,end:cut.start});
    last=cut.end;
  }
  if (last<duration) clips.push({start:last,end:duration});
  const plan={duration,parameters:{noiseDb:-35,minSilence:0.5,pad,wordGuard:guard,minimumCut},
    detectedSilences:silences.length,cuts,clips,
    outputDuration:clips.reduce((sum,clip)=>sum+clip.end-clip.start,0)};
  fs.writeFileSync(output,JSON.stringify(plan,null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify({plan:output,silences:silences.length,cuts:cuts.length,
    sourceSeconds:duration,outputSeconds:Math.round(plan.outputDuration*1000)/1000},null,2));
} catch (error) {
  console.error("ERROR:",error.message);
  process.exitCode=1;
}
