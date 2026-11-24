#!/usr/bin/env node
// Optional pass, only when the user asks: prepare the kept script for a consistency review.
// Prints the words the edit keeps, numbered with source times and long pauses, plus deterministic
// hints (repeated phrases, restart markers, truncated words, phrases left hanging before a pause).
// The agent decides what to cut with references/script-review.md; this script edits nothing.
// Usage: node review-script.cjs TRANSCRIPT_JSON CLIPS_JSON|PROJECT_DIR|- NEW_REVIEW_JSON
//   [--window=12] [--pause=0.6] [--min-ngram=2] [--max-ngram=5] [--line-words=14]
// Writes the JSON and a readable NEW_REVIEW.txt next to it.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const round = (n) => Math.round(n * 1000) / 1000;
const log = (message) => process.stderr.write(message + "\n");
const norm = (w) => String(w).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// Spanish and English function words: an n-gram made only of these is not a repetition worth flagging.
const STOP = new Set(("a al de del el la los las lo un una unos unas y o u e que en con por para se te me le les nos mi tu su sus es "
  + "no si ya mas pero como muy hay este esta esto eso the a an and or of to in on for is it that this").split(" "));
const RESTARTS = ["o sea", "mejor dicho", "perdon", "digo", "a ver", "es decir", "bueno", "osea", "i mean", "sorry", "let me"];

// Same rule as keptCaptions: a kept clip covers at least min(0.05 s, word length) of the word.
const isKept = (w, clips) => clips.some((c) => Math.min(c.end, w.end) - Math.max(c.start, w.start) >= Math.min(0.05, w.end - w.start) - 1e-9);

const loadClips = (arg) => {
  if (arg === "-") return null;
  const file = path.resolve(arg);
  let data;
  if (fs.statSync(file).isDirectory()) {
    const code = fs.readFileSync(path.join(file, "src", "edit.js"), "utf8").replace(/^\s*export\s+default\s+/m, "").replace(/;\s*$/, "");
    data = vm.runInNewContext("(" + code + ")");
  } else data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data.clips) || !data.clips.length) throw new Error("No clips in " + arg);
  return data.clips;
};

try {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, Number(v)]; }));
  const [transcriptArg, clipsArg, outputArg] = positional;
  if (!transcriptArg || !clipsArg || !outputArg) throw new Error("Usage: node review-script.cjs TRANSCRIPT_JSON CLIPS_JSON|PROJECT_DIR|- NEW_REVIEW_JSON [--window=12] [--pause=0.6] [--min-ngram=2] [--max-ngram=5] [--line-words=14]");
  for (const [k, v] of Object.entries(flags)) if (!Number.isFinite(v)) throw new Error(`Invalid value for --${k}`);
  const p = {window: flags.window ?? 12, pause: flags.pause ?? 0.6, minNgram: flags["min-ngram"] ?? 2, maxNgram: flags["max-ngram"] ?? 5, lineWords: flags["line-words"] ?? 14};
  const output = path.resolve(outputArg), textOutput = output.replace(/\.json$/i, "") + ".txt";
  for (const f of [output, textOutput]) if (fs.existsSync(f)) throw new Error("Review already exists: " + f);
  const transcript = JSON.parse(fs.readFileSync(path.resolve(transcriptArg), "utf8"));
  if (!Array.isArray(transcript.segments)) throw new Error("Transcript is missing segments");
  const all = transcript.segments.flatMap((s) => s.words || []).filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
  if (!all.length) throw new Error("Transcript contains no timed words");
  const clips = loadClips(clipsArg);

  // Index every transcript word; review only the kept ones, in order.
  const words = all.map((w, i) => ({i, word: String(w.word).trim(), start: w.start, end: w.end, kept: clips ? isKept(w, clips) : true}));
  const kept = words.filter((w) => w.kept);
  for (let k = 0; k < kept.length; k++) { kept[k].norm = norm(kept[k].word); kept[k].pauseAfter = k + 1 < kept.length ? round(kept[k + 1].start - kept[k].end) : 0; }

  // Repeated phrases: the longest n-grams that occur again within the window, not overlapping.
  const repeats = [], claimed = new Set();
  for (let n = p.maxNgram; n >= p.minNgram; n--) {
    for (let a = 0; a + n <= kept.length; a++) {
      const gram = kept.slice(a, a + n).map((w) => w.norm);
      if (gram.some((g) => !g) || gram.every((g) => STOP.has(g))) continue;
      for (let b = a + n; b + n <= kept.length && kept[b].start - kept[a].start <= p.window; b++) {
        if (!kept.slice(b, b + n).every((w, k) => w.norm === gram[k])) continue;
        const key = `${a}:${b}`;
        if ([...Array(n).keys()].some((k) => claimed.has(`${a + k}:${b + k}`))) continue;
        for (let k = 0; k < n; k++) claimed.add(`${a + k}:${b + k}`);
        repeats.push({phrase: kept.slice(a, a + n).map((w) => w.word).join(" "), first: [kept[a].i, kept[a + n - 1].i], second: [kept[b].i, kept[b + n - 1].i],
          firstStart: kept[a].start, secondStart: kept[b].start, gapSeconds: round(kept[b].start - kept[a + n - 1].end), key});
        break;
      }
    }
  }
  repeats.sort((x, y) => x.firstStart - y.firstStart);
  for (const r of repeats) delete r.key;

  // Restart markers from RESTARTS, matched on normalized consecutive words.
  const restarts = [];
  for (const marker of RESTARTS) {
    const parts = marker.split(" ");
    for (let a = 0; a + parts.length <= kept.length; a++)
      if (parts.every((x, k) => kept[a + k].norm === x)) restarts.push({marker, at: kept[a].i, start: kept[a].start, context: kept.slice(Math.max(0, a - 5), a + parts.length + 5).map((w) => w.word).join(" ")});
  }
  restarts.sort((x, y) => x.start - y.start);

  // Truncated words: a word that a later word (within 8) extends, e.g. a fragment before its full form.
  const truncated = [];
  for (let a = 0; a < kept.length; a++) {
    const w = kept[a].norm;
    if (w.length < 3 || STOP.has(w)) continue;
    const later = kept.slice(a + 1, a + 9).find((x) => x.norm.length > w.length && x.norm.startsWith(w));
    if (later) truncated.push({word: kept[a].word, at: kept[a].i, start: kept[a].start, completedBy: later.word, completedAt: later.i});
  }

  // Hanging phrases: a function word with no punctuation right before a long pause.
  const hanging = kept.filter((w) => w.pauseAfter >= p.pause && !/[.,;:!?…]$/.test(w.word) && STOP.has(w.norm))
    .map((w) => ({word: w.word, at: w.i, start: w.start, pauseAfter: w.pauseAfter}));

  // Readable script: one line per sentence, long pause or line-words, pauses shown inline.
  const lines = [];
  let line = [];
  const flush = () => { if (line.length) lines.push({from: line[0].i, to: line[line.length - 1].i, start: line[0].start, end: line[line.length - 1].end,
    text: line.map((w) => w.word + (w.pauseAfter >= p.pause ? ` ‖${w.pauseAfter.toFixed(1)}s` : "")).join(" ")}); line = []; };
  for (const w of kept) {
    line.push(w);
    if (/[.!?…]$/.test(w.word) || w.pauseAfter >= p.pause * 2 || line.length >= p.lineWords) flush();
  }
  flush();

  const result = {source: transcriptArg, parameters: p, totalWords: words.length, keptWords: kept.length,
    hints: {repeats, restarts, truncated, hanging}, lines,
    words: words.map(({i, word, start, end, kept: k}) => ({i, word, start, end, kept: k}))};
  const pad = (n) => String(n).padStart(4, "0");
  const text = [`# Kept script: ${kept.length} of ${words.length} words. [first-last word index] source seconds | text (‖ = pause in the source, before silence cuts)`, "",
    ...lines.map((l) => `[${pad(l.from)}-${pad(l.to)}] ${l.start.toFixed(2).padStart(7)} | ${l.text}`), "",
    `# Repeated phrases within ${p.window} s (${repeats.length})`, ...repeats.map((r) => `#${r.first[0]}-${r.first[1]} and #${r.second[0]}-${r.second[1]} (${r.firstStart.toFixed(2)} s): "${r.phrase}"`), "",
    `# Restart markers (${restarts.length})`, ...restarts.map((r) => `#${r.at} (${r.start.toFixed(2)} s) "${r.marker}": ${r.context}`), "",
    `# Truncated words (${truncated.length})`, ...truncated.map((t) => `#${t.at} (${t.start.toFixed(2)} s) "${t.word}" completed by #${t.completedAt} "${t.completedBy}"`), "",
    `# Hanging before a pause (${hanging.length})`, ...hanging.map((h) => `#${h.at} (${h.start.toFixed(2)} s) "${h.word}" then ${h.pauseAfter} s`), ""].join("\n");
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n", {flag: "wx"});
  fs.writeFileSync(textOutput, text, {flag: "wx"});
  log(`${kept.length} of ${words.length} words kept; ${repeats.length} repeats, ${restarts.length} restart markers, ${truncated.length} truncated, ${hanging.length} hanging`);
  console.log(JSON.stringify({review: output, text: textOutput, keptWords: kept.length, repeats: repeats.length, restarts: restarts.length,
    truncated: truncated.length, hanging: hanging.length}, null, 2));
} catch (error) {
  console.error("ERROR:", error.message);
  process.exitCode = 1;
}
