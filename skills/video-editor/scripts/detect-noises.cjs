#!/usr/bin/env node
// Optional pass, only when the user asks: find throat clearings, coughs and similar noises inside
// the kept clips. Whisper rarely transcribes them, so look for loud stretches that no transcript
// word covers, score them by shape (abrupt onset, noisy, not voiced) and propose cut ranges.
// It never edits anything: the agent shows the proposals and the user approves them.
// Usage: node detect-noises.cjs VIDEO TRANSCRIPT_JSON CLIPS_JSON|PROJECT_DIR|- NEW_REPORT_JSON
//   [--floor=-45] [--min-length=0.08] [--max-length=1.2] [--min-score=0.6] [--gate=-40] [--margin=0.04]
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");

const RATE = 16000, HOP = 160, WIN = 480, FFT = 512; // 10 ms hop, 30 ms window
const round = (n) => Math.round(n * 1000) / 1000;
const log = (message) => process.stderr.write(message + "\n");

const decodePcm = (file) => {
  const run = spawnSync("ffmpeg", ["-v", "error", "-nostdin", "-i", file, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"], {maxBuffer: 1024 * 1024 * 1024});
  if (run.error || run.status !== 0) throw new Error("PCM decode failed: " + (run.stderr?.toString() || run.error?.message));
  const raw = new Int16Array(run.stdout.buffer, run.stdout.byteOffset, Math.floor(run.stdout.length / 2));
  return Float32Array.from(raw, (v) => v / 32768);
};

// Clips come from a plan JSON (`clips`), a project's src/edit.js, or "-" for the whole file.
const loadClips = (arg, duration) => {
  if (arg === "-") return [{start: 0, end: duration}];
  const file = path.resolve(arg);
  let data;
  if (fs.statSync(file).isDirectory()) {
    const code = fs.readFileSync(path.join(file, "src", "edit.js"), "utf8").replace(/^\s*export\s+default\s+/m, "").replace(/;\s*$/, "");
    data = vm.runInNewContext("(" + code + ")");
  } else data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data.clips) || !data.clips.length) throw new Error("No clips in " + arg);
  return data.clips;
};

const fft = (re, im) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
      const a = i + k, b = a + len / 2;
      const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
};

const frameDb = (pcm, f) => {
  const a = f * HOP, b = Math.min(pcm.length, a + WIN);
  let sum = 0;
  for (let i = a; i < b; i++) sum += pcm[i] * pcm[i];
  const rms = b > a ? Math.sqrt(sum / (b - a)) : 0;
  return rms > 0 ? 20 * Math.log10(rms) : -99;
};

// Voicing: best normalized autocorrelation for 80-400 Hz. Speech vowels read high; a throat
// clearing or cough is turbulent noise and reads low.
const periodicity = (pcm, f) => {
  const a = f * HOP;
  if (a + WIN + 200 > pcm.length) return 0;
  let best = 0;
  for (let lag = 40; lag <= 200; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = a; i < a + WIN; i++) { const x = pcm[i], y = pcm[i + lag]; xy += x * y; xx += x * x; yy += y * y; }
    if (xx > 0 && yy > 0) best = Math.max(best, xy / Math.sqrt(xx * yy));
  }
  return best;
};

// Spectral flatness (0 tonal .. 1 white noise) and centroid in Hz, Hann window.
const spectrum = (pcm, f) => {
  const re = new Float64Array(FFT), im = new Float64Array(FFT), a = f * HOP;
  for (let i = 0; i < WIN && a + i < pcm.length; i++) re[i] = pcm[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (WIN - 1)));
  fft(re, im);
  let logSum = 0, sum = 0, weighted = 0;
  const bins = FFT / 2 - 1;
  for (let k = 1; k <= bins; k++) {
    const p = re[k] * re[k] + im[k] * im[k] + 1e-12;
    logSum += Math.log(p); sum += p; weighted += p * k * RATE / FFT;
  }
  return {flatness: Math.exp(logSum / bins) / (sum / bins), centroid: weighted / sum};
};

const median = (values) => {
  const s = [...values].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));

try {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, Number(v)]; }));
  const [inputArg, transcriptArg, clipsArg, outputArg] = positional;
  if (!inputArg || !transcriptArg || !clipsArg || !outputArg) throw new Error("Usage: node detect-noises.cjs VIDEO TRANSCRIPT_JSON CLIPS_JSON|PROJECT_DIR|- NEW_REPORT_JSON [--floor=-45] [--min-length=0.08] [--max-length=1.2] [--min-score=0.6] [--gate=-40] [--margin=0.04]");
  for (const [k, v] of Object.entries(flags)) if (!Number.isFinite(v)) throw new Error(`Invalid value for --${k}`);
  const p = {floor: flags.floor ?? -45, minLength: flags["min-length"] ?? 0.08, maxLength: flags["max-length"] ?? 1.2,
    minScore: flags["min-score"] ?? 0.6, gate: flags.gate ?? -40, margin: flags.margin ?? 0.04};
  const input = path.resolve(inputArg), output = path.resolve(outputArg);
  if (fs.existsSync(output)) throw new Error("Report already exists: " + output);
  const transcript = JSON.parse(fs.readFileSync(path.resolve(transcriptArg), "utf8"));
  if (!Array.isArray(transcript.segments)) throw new Error("Transcript is missing segments");
  const words = transcript.segments.flatMap((s) => s.words || []).filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
  if (!words.length) throw new Error("Transcript contains no timed words");
  const started = Date.now();

  const pcm = decodePcm(input);
  const duration = pcm.length / RATE;
  const clips = loadClips(clipsArg, duration);
  const frames = Math.floor((pcm.length - WIN) / HOP);
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) db[f] = frameDb(pcm, f);
  const time = (f) => f * HOP / RATE + WIN / RATE / 2;

  // Masks: kept by a clip, covered by a word (plus margin).
  const kept = new Uint8Array(frames), covered = new Uint8Array(frames);
  const mark = (mask, start, end) => { for (let f = Math.max(0, Math.floor(start * RATE / HOP)); f < frames && time(f) <= end; f++) if (time(f) >= start) mask[f] = 1; };
  for (const c of clips) mark(kept, c.start, c.end);
  for (const w of words) mark(covered, w.start - p.margin, w.end + p.margin);
  const speechMedian = median(Array.from(db).filter((_, f) => covered[f] && kept[f] && db[f] > p.floor));

  // Candidate regions: kept, uncovered, above the floor; gaps of up to 20 ms are bridged.
  const regions = [];
  let open = null, quiet = 0;
  for (let f = 0; f <= frames; f++) {
    const hot = f < frames && kept[f] && !covered[f] && db[f] > p.floor;
    if (hot) { if (!open) open = {a: f, b: f}; open.b = f; quiet = 0; }
    else if (open && ++quiet > 2) { regions.push(open); open = null; quiet = 0; }
  }
  if (open) regions.push(open);

  const before = (t) => { let w = null; for (const x of words) if (x.end <= t + 1e-6) w = x; else break; return w; };
  const after = (t) => words.find((x) => x.start >= t - 1e-6) || null;
  const candidates = [];
  for (const r of regions) {
    const start = time(r.a) - HOP / RATE / 2, end = time(r.b) + HOP / RATE / 2, length = end - start;
    if (length < p.minLength || length > p.maxLength) continue;
    const idx = [];
    for (let f = r.a; f <= r.b; f++) idx.push(f);
    const peak = Math.max(...idx.map((f) => db[f]));
    const loud = idx.filter((f) => db[f] > peak - 10);
    const per = median(loud.map((f) => periodicity(pcm, f)));
    const spec = loud.map((f) => spectrum(pcm, f));
    const flat = median(spec.map((s) => s.flatness)), centroid = median(spec.map((s) => s.centroid));
    const pre = Math.min(...[1, 2, 3, 4, 5].map((k) => db[Math.max(0, r.a - k)]));
    const onset = peak - pre;
    // Weighted shape score; 1 = abrupt, loud, unvoiced noise.
    const score = 0.4 * clamp01((0.6 - per) / 0.4) + 0.25 * clamp01(flat / 0.3) + 0.2 * clamp01(onset / 15)
      + 0.15 * clamp01((peak - p.floor) / Math.max(1, speechMedian - p.floor));
    // Cut proposal: widen to the quietest frame within 150 ms on each side, never into a word.
    const prev = before(start), next = after(end);
    const lo = Math.max(prev ? prev.end : 0, start - 0.15), hi = Math.min(next ? next.start : duration, end + 0.15);
    let cutA = start, cutB = end;
    for (let f = Math.max(0, Math.ceil(lo * RATE / HOP)); time(f) < start; f++) if (db[f] < frameDb(pcm, Math.round(cutA * RATE / HOP))) cutA = time(f);
    for (let f = r.b; f < frames && time(f) <= hi; f++) if (db[f] < frameDb(pcm, Math.min(frames - 1, Math.round(cutB * RATE / HOP)))) cutB = time(f);
    const edgeDb = [db[Math.round(cutA * RATE / HOP)], db[Math.min(frames - 1, Math.round(cutB * RATE / HOP))]].map(round);
    // No rise in energy means the region trails off the previous word (a sibilant tail), not a new sound.
    const tail = onset < 3;
    candidates.push({start: round(start), end: round(end), length: round(length), peakDb: round(peak), onsetDb: round(onset),
      periodicity: round(per), flatness: round(flat), centroidHz: Math.round(centroid), score: round(score), tail,
      likely: score >= p.minScore && !tail, cut: [round(cutA), round(cutB)], cutEdgesDb: edgeDb, edgesBelowGate: edgeDb.every((v) => v <= p.gate),
      before: prev ? String(prev.word).trim() : null, after: next ? String(next.word).trim() : null});
  }
  candidates.sort((x, y) => y.score - x.score);

  // Words that may have swallowed a noise: low probability and unusually long.
  const medianLength = median(words.map((w) => w.end - w.start));
  const suspectWords = words.filter((w) => (w.probability ?? 1) < 0.5 && w.end - w.start > 2 * medianLength
    && clips.some((c) => w.start < c.end && w.end > c.start))
    .map((w) => ({word: String(w.word).trim(), start: w.start, end: w.end, probability: w.probability}));

  // A kept clip that no word touches is either a noise or speech Whisper missed. Voiced ones need
  // `transcribe.py --clip` or a listen before cutting; unvoiced or quiet ones are noise.
  const wordlessClips = clips.filter((c) => !words.some((w) => w.start < c.end && w.end > c.start)).map((c) => {
    const idx = [];
    for (let f = Math.max(0, Math.floor(c.start * RATE / HOP)); f < frames && time(f) <= c.end; f++) idx.push(f);
    const peak = idx.length ? Math.max(...idx.map((f) => db[f])) : -99;
    const loud = idx.filter((f) => db[f] > Math.max(p.floor, peak - 10));
    const per = loud.length ? median(loud.map((f) => periodicity(pcm, f))) : 0;
    const kind = !loud.length ? "quiet" : per >= 0.6 ? "voiced" : "noise";
    return {start: c.start, end: c.end, peakDb: round(peak), periodicity: round(per), kind};
  });

  const likely = candidates.filter((c) => c.likely);
  const result = {source: path.basename(input), duration: round(duration), parameters: p, speechMedianDb: round(speechMedian),
    regionsChecked: regions.length, candidates, wordlessClips, suspectWords, runtimeSeconds: Math.round((Date.now() - started) / 100) / 10};
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n", {flag: "wx"});
  log(`${result.source}: speech median ${result.speechMedianDb} dB, ${regions.length} uncovered regions, ${candidates.length} candidates, ${likely.length} likely; ${result.runtimeSeconds} s`);
  for (const c of candidates.slice(0, 15)) log(`  ${c.likely ? "*" : " "} ${c.start}-${c.end} score ${c.score} peak ${c.peakDb} dB per ${c.periodicity} flat ${c.flatness} onset ${c.onsetDb} | ${c.before} || ${c.after} -> cut ${c.cut[0]}-${c.cut[1]}`);
  for (const c of wordlessClips) log(`  clip without words ${c.start}-${c.end} ${c.kind} peak ${c.peakDb} dB per ${c.periodicity}`);
  for (const w of suspectWords) log(`  word "${w.word}" ${w.start}-${w.end} p ${w.probability}`);
  console.log(JSON.stringify({report: output, candidates: candidates.length, likely: likely.length, wordlessClips: wordlessClips.length, suspectWords: suspectWords.length,
    speechMedianDb: result.speechMedianDb, runtimeSeconds: result.runtimeSeconds}, null, 2));
} catch (error) {
  console.error("ERROR:", error.message);
  process.exitCode = 1;
}
