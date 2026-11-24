#!/usr/bin/env node
// Plan aggressive silence cuts with the verified procedure: detect short silences, build clips as
// their complement, re-detect on the joined audio until nothing is left, audit every removed
// slice that overlaps a transcript word, and verify the joined result.
// Usage: node plan-silence.cjs VIDEO TRANSCRIPT_JSON|- NEW_PLAN_JSON
//   [--noise=-35] [--min-silence=0.25] [--edge=0.07] [--min-cut=0.2] [--max-passes=4] [--target-pause=0.40] [--gate=-40]
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");

const round = (n) => Math.round(n * 1000) / 1000;
const log = (message) => process.stderr.write(message + "\n");

const ffmpeg = (args, what) => {
  const run = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", ...args], {encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (run.error || run.status !== 0) throw new Error(`${what} failed: ${run.stderr || run.error?.message}`);
  return run.stderr;
};

const probeDuration = (file) => {
  const run = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], {encoding: "utf8"});
  if (run.error || run.status !== 0) throw new Error(run.stderr || run.error?.message || "ffprobe failed");
  const value = Number(run.stdout.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid duration for " + file);
  return value;
};

// silencedetect events; a silence still open at the end of the file closes at `duration`.
const detectSilences = (file, noise, minimum, duration) => {
  const out = ffmpeg(["-i", file, "-vn", "-af", `silencedetect=noise=${noise}dB:d=${minimum}`, "-f", "null", "-"], "silencedetect");
  const silences = [];
  let open = null;
  for (const m of out.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === "start") open = Math.max(0, Number(m[2]));
    else if (open !== null) { silences.push({start: open, end: Number(m[2])}); open = null; }
  }
  if (open !== null && duration - open >= minimum) silences.push({start: open, end: duration});
  return silences;
};

// Decodes mono 16 kHz PCM once; slice RMS is then computed in memory.
const decodePcm = (file) => {
  const run = spawnSync("ffmpeg", ["-v", "error", "-nostdin", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], {maxBuffer: 1024 * 1024 * 1024});
  if (run.error || run.status !== 0) throw new Error("PCM decode failed: " + (run.stderr?.toString() || run.error?.message));
  return new Int16Array(run.stdout.buffer, run.stdout.byteOffset, Math.floor(run.stdout.length / 2));
};
const rmsDb = (pcm, start, end) => {
  const a = Math.max(0, Math.floor(start * 16000)), b = Math.min(pcm.length, Math.ceil(end * 16000));
  if (b <= a) return null;
  let sum = 0;
  for (let i = a; i < b; i++) sum += pcm[i] * pcm[i];
  const rms = Math.sqrt(sum / (b - a)) / 32768;
  return rms > 0 ? round(20 * Math.log10(rms)) : -99;
};

const clipsFromCuts = (cuts, duration) => {
  const sorted = [...cuts].sort((x, y) => x.start - y.start), merged = [];
  for (const cut of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && cut.start <= prev.end + 1e-6) prev.end = Math.max(prev.end, cut.end);
    else merged.push({...cut});
  }
  const clips = [];
  let last = 0;
  for (const cut of merged) {
    if (cut.start > last + 1e-6) clips.push({start: round(last), end: round(cut.start)});
    last = Math.max(last, cut.end);
  }
  if (last < duration - 1e-6) clips.push({start: round(last), end: round(duration)});
  return {cuts: merged, clips};
};

const joinAudio = (input, clips, output) => {
  const script = clips.map((c, i) => `[0:a]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS[a${i}]`).join(";\n")
    + ";\n" + clips.map((_, i) => `[a${i}]`).join("") + `concat=n=${clips.length}:v=0:a=1[out]`;
  const scriptFile = output + ".filter.txt";
  fs.writeFileSync(scriptFile, script);
  const tail = ["-map", "[out]", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output];
  try {
    // FFmpeg 7+ reads the filter from a file with "-/filter_complex"; older builds use -filter_complex_script.
    try { ffmpeg(["-y", "-i", input, "-/filter_complex", scriptFile, ...tail], "join"); }
    catch (error) {
      if (!/Unrecognized option|Option not found/.test(error.message)) throw error;
      ffmpeg(["-y", "-i", input, "-filter_complex_script", scriptFile, ...tail], "join");
    }
  } finally { fs.rmSync(scriptFile, {force: true}); }
};

// Output-time point -> source time.
const toSource = (t, clips) => {
  let acc = 0;
  for (const c of clips) {
    const len = c.end - c.start;
    if (t <= acc + len) return c.start + (t - acc);
    acc += len;
  }
  return clips[clips.length - 1].end;
};

try {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, Number(v)]; }));
  const [inputArg, transcriptArg, outputArg] = positional;
  if (!inputArg || !transcriptArg || !outputArg) throw new Error("Usage: node plan-silence.cjs VIDEO TRANSCRIPT_JSON|- NEW_PLAN_JSON [--noise=-35] [--min-silence=0.25] [--edge=0.07] [--min-cut=0.2] [--max-passes=4] [--target-pause=0.40] [--gate=-40]");
  for (const [k, v] of Object.entries(flags)) if (!Number.isFinite(v)) throw new Error(`Invalid value for --${k}`);
  const p = {noise: flags.noise ?? -35, minSilence: flags["min-silence"] ?? 0.25, edge: flags.edge ?? 0.07, minCut: flags["min-cut"] ?? 0.2,
    maxPasses: flags["max-passes"] ?? 4, targetPause: flags["target-pause"] ?? 0.4, gate: flags.gate ?? -40};
  const input = path.resolve(inputArg), output = path.resolve(outputArg);
  if (fs.existsSync(output)) throw new Error("Plan already exists: " + output);
  let words = [];
  if (transcriptArg !== "-") {
    const transcript = JSON.parse(fs.readFileSync(path.resolve(transcriptArg), "utf8"));
    if (!Array.isArray(transcript.segments)) throw new Error("Transcript is missing segments");
    words = transcript.segments.flatMap((s) => s.words || []).filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
    if (!words.length) throw new Error("Transcript contains no timed words");
  }
  const started = Date.now();
  const duration = probeDuration(input);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "plan-silence-"));
  const joined = path.join(work, "joined.wav");

  // Pass 1 on the source; later passes on the joined audio, mapped back to source time.
  const silences = detectSilences(input, p.noise, p.minSilence, duration);
  let cuts = [];
  for (const s of silences) {
    const start = Math.max(0, s.start + p.edge), end = Math.min(duration, s.end - p.edge);
    if (end - start >= p.minCut) cuts.push({start: round(start), end: round(end)});
  }
  let plan = clipsFromCuts(cuts, duration);
  const passes = [{pass: 1, detected: silences.length, added: plan.cuts.length}];
  for (let pass = 2; pass <= p.maxPasses; pass++) {
    joinAudio(input, plan.clips, joined);
    const remaining = detectSilences(joined, p.noise, p.minSilence, probeDuration(joined));
    const extra = [];
    for (const s of remaining) {
      const a = s.start + p.edge, b = s.end - p.edge;
      if (b - a < p.minCut) continue;
      const start = toSource(a, plan.clips), end = toSource(b, plan.clips);
      if (end - start >= p.minCut) extra.push({start: round(start), end: round(end)});
    }
    passes.push({pass, detected: remaining.length, added: extra.length});
    if (!extra.length) break;
    plan = clipsFromCuts([...plan.cuts, ...extra], duration);
  }

  // Audit: the removed part of any overlapping word must sit below the gate on the source audio.
  const pcm = decodePcm(input);
  const audit = [];
  for (const w of words) for (const c of plan.cuts) {
    const a = Math.max(w.start, c.start), b = Math.min(w.end, c.end);
    if (b - a > 1e-6) audit.push({word: String(w.word).trim(), span: [w.start, w.end], removed: [round(a), round(b)], removedDb: rmsDb(pcm, a, b)});
  }
  const suspicious = audit.filter((x) => x.removedDb !== null && x.removedDb > p.gate);

  // Verify the result, not the plan: pauses left in the joined audio.
  joinAudio(input, plan.clips, joined);
  const finalSilences = detectSilences(joined, p.noise, 0.1, probeDuration(joined));
  const pauses = finalSilences.map((s) => round(s.end - s.start));
  fs.rmSync(work, {recursive: true, force: true});

  const outputDuration = round(plan.clips.reduce((sum, c) => sum + c.end - c.start, 0));
  const result = {source: path.basename(input), duration: round(duration), parameters: p, passes,
    cuts: plan.cuts, clips: plan.clips, outputDuration,
    removedSeconds: round(duration - outputDuration), removedPercent: Math.round((duration - outputDuration) / duration * 1000) / 10,
    verification: {pausesOverTarget: pauses.filter((d) => d > p.targetPause).length, longestPause: pauses.length ? Math.max(...pauses) : 0},
    audit: {overlappingWords: audit.length, suspicious},
    runtimeSeconds: Math.round((Date.now() - started) / 100) / 10};
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n", {flag: "wx"});
  log(`${result.source}: ${result.duration} s -> ${outputDuration} s (${result.removedPercent}% removed, ${plan.cuts.length} cuts, ${passes.length} passes)`);
  log(`Longest pause left ${result.verification.longestPause} s; ${result.verification.pausesOverTarget} over ${p.targetPause} s; `
    + `${audit.length} words overlap a cut, ${suspicious.length} above ${p.gate} dB; ${result.runtimeSeconds} s`);
  for (const s of suspicious) log(`  check "${s.word}" removed ${s.removed[0]}-${s.removed[1]} at ${s.removedDb} dB`);
  console.log(JSON.stringify({plan: output, cuts: plan.cuts.length, clips: plan.clips.length, sourceSeconds: result.duration, outputSeconds: outputDuration,
    removedPercent: result.removedPercent, passes: passes.length, ...result.verification, suspicious: suspicious.length, runtimeSeconds: result.runtimeSeconds}, null, 2));
  if (suspicious.length) process.exitCode = 2;
} catch (error) {
  console.error("ERROR:", error.message);
  process.exitCode = 1;
}
