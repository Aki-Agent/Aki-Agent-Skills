#!/usr/bin/env node
// Show what is said around one point of an edit, to turn a user request into exact cut specs.
// Usage: node locate.cjs PROJECT_DIR TARGET [--window=8] [--medium] [--python=python] [--cache-dir=DIR] [--language=es] [--json]
// TARGET: output:0:41 (Studio time, m:ss or seconds), source:75.2, or text:"una frase"[@N] (any occurrence, kept or cut)
// Prints every word in the window with its source and Studio time and whether it is kept, the kept clips
// (wordless ones are flagged, with a ready source: spec) and words longer than 1.2 s, which often hide a
// repetition that `small` merged. --medium re-transcribes only this window (about 10 s) and lists those words
// too; results are cached in WORK_DIR/locate/. --python, --cache-dir and --language default to the values
// auto-edit.cjs saved in WORK_DIR/auto-edit.json.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");

const round = (n) => Math.round(n * 100) / 100;
const norm = (w) => String(w).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const readModule = (file) => vm.runInNewContext("(" + fs.readFileSync(file, "utf8").replace(/^\s*export\s+default\s+/m, "").replace(/;\s*$/, "") + ")");
const seconds = (v) => v.includes(":") ? v.split(":").reduce((acc, x) => acc * 60 + Number(x), 0) : Number(v);
const clock = (t) => t === null ? "  cut  " : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;

const outputToSource = (clips, t) => {
  let acc = 0;
  for (const c of clips) { if (t <= acc + c.end - c.start) return c.start + t - acc; acc += c.end - c.start; }
  return clips[clips.length - 1].end;
};
// Studio time of a source instant, or null when that instant was cut.
const sourceToOutput = (clips, t) => {
  let acc = 0;
  for (const c of clips) { if (t >= c.start && t <= c.end) return acc + t - c.start; acc += c.end - c.start; }
  return null;
};
const keptShare = (clips, a, b) => clips.reduce((s, c) => s + Math.max(0, Math.min(c.end, b) - Math.max(c.start, a)), 0) / Math.max(1e-6, b - a);

try {
  const args = process.argv.slice(2);
  const flags = new Map(args.filter((a) => a.startsWith("--")).map((a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.length ? v.join("=") : true]; }));
  const [projectArg, target] = args.filter((a) => !a.startsWith("--"));
  if (!projectArg || !target) throw new Error("Usage: node locate.cjs PROJECT_DIR output:M:SS|source:S|text:\"phrase\"[@N] [--window=8] [--medium] [--json]");
  const project = path.resolve(projectArg), work = path.dirname(project);
  const saved = fs.existsSync(path.join(work, "auto-edit.json")) ? JSON.parse(fs.readFileSync(path.join(work, "auto-edit.json"), "utf8")).tools ?? {} : {};
  const edit = readModule(path.join(project, "src", "edit.js"));
  const words = readModule(path.join(project, "src", "captions.js")).map((c, i) => ({i, word: String(c.text).trim(), start: c.startMs / 1000, end: c.endMs / 1000}));
  const half = Number(flags.get("window") ?? 8) / 2;

  const [kind, ...rest] = target.split(":");
  const value = rest.join(":");
  let center;
  if (kind === "output") center = outputToSource(edit.clips, seconds(value));
  else if (kind === "source") center = seconds(value);
  else if (kind === "text") {
    const m = value.match(/^"?(.*?)"?(?:@(\d+))?$/);
    const t = m[1].split(/\s+/).map(norm).filter(Boolean), nth = Number(m[2] || 1);
    let seen = 0;
    for (let k = 0; k + t.length <= words.length && center === undefined; k++)
      if (t.every((x, j) => norm(words[k + j].word) === x) && ++seen === nth) center = (words[k].start + words[k + t.length - 1].end) / 2;
    if (center === undefined) throw new Error("Phrase not found in the transcript: " + target + " (it may be one of the words small did not transcribe; locate it by time with --medium)");
  } else throw new Error("Unknown target: " + target);
  const a = round(Math.max(0, center - half)), b = round(center + half);

  const row = (w) => { const share = keptShare(edit.clips, w.start, w.end);
    return {word: w.word, source: [round(w.start), round(w.end)], studio: sourceToOutput(edit.clips, (w.start + w.end) / 2), kept: share >= 0.5, share: round(share)}; };
  const inWindow = (w) => w.end >= a && w.start <= b;
  const small = words.filter(inWindow).map((w) => ({i: w.i, ...row(w)}));
  // Kept clips in the window plus one on each side: after a long pause the next one (often a noise) is far away.
  const hit = edit.clips.map((c, k) => c.end >= a && c.start <= b ? k : -1).filter((k) => k >= 0);
  const after = edit.clips.findIndex((c) => c.start > b);
  const first = hit.length ? Math.max(0, hit[0] - 1) : (after < 0 ? edit.clips.length : after) - 1;
  const last = hit.length ? hit[hit.length - 1] + 1 : first + 1;
  const clips = edit.clips.slice(Math.max(0, first), last + 1).map((c) => {
    const spoken = words.filter((w) => Math.min(c.end, w.end) - Math.max(c.start, w.start) > 0.05).map((w) => w.word);
    return {source: [c.start, c.end], studio: round(sourceToOutput(edit.clips, c.start)), words: spoken.join(" ")};
  });

  let medium = null, out = null;
  if (flags.has("medium")) {
    const dir = path.join(work, "locate");
    out = path.join(dir, `medium-${a}-${b}.json`);
    if (!fs.existsSync(out)) {
      fs.mkdirSync(dir, {recursive: true});
      const python = flags.get("python") || saved.python || "python", cache = flags.get("cache-dir") || saved.cacheDir;
      const run = spawnSync(python, [path.resolve(__dirname, "transcribe.py"), path.join(project, "public", edit.source), out, "--model", "medium",
        "--language", flags.get("language") || saved.language || "es", "--clip", `${a},${b}`, ...(cache ? ["--cache-dir", cache] : [])], {encoding: "utf8"});
      if (run.error || run.status !== 0) throw new Error("medium re-transcription failed: " + (run.stderr || run.error?.message));
    }
    medium = JSON.parse(fs.readFileSync(out, "utf8")).segments.flatMap((s) => s.words).map((w) => row({word: w.word.trim(), start: w.start, end: w.end}));
  }

  const report = {window: [a, b], studio: [sourceToOutput(edit.clips, a), sourceToOutput(edit.clips, b)].map((t) => t === null ? null : round(t)), small, clips, medium, mediumFile: out};
  if (flags.has("json")) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
  // "part" = an earlier cut clipped this word; give it back with cut.cjs keep:.
  const status = (w) => w.share >= 0.95 ? "kept" : w.share <= 0.05 ? "cut " : "part";
  const line = (w, id) => `${id.padStart(5)}  ${w.source[0].toFixed(2).padStart(7)}-${w.source[1].toFixed(2).padEnd(7)} ${clock(w.studio)}  ${status(w)}  ${w.word}${w.source[1] - w.source[0] > 1.2 ? "   <- long word: may hide a repetition, narrow --window" : ""}`;
  console.log(`Source ${a}-${b} s | idx  source           studio   status  word`);
  for (const w of small) console.log(line(w, String(w.i)));
  console.log("\nKept clips:");
  for (const c of clips) console.log(`  source:${c.source[0]}-${c.source[1]}  studio ${clock(c.studio)}  ${c.words || "(no words: noise, throat clearing or an untranscribed take)"}`);
  if (medium) { console.log(`\nmedium (${out}):`); for (const w of medium) console.log(line(w, "m")); }
} catch (error) {
  console.error("ERROR:", error.message);
  process.exitCode = 1;
}
