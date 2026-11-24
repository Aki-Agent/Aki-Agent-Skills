#!/usr/bin/env node
// Remove parts of an existing edit in one command; Studio hot-reloads the result.
// Usage: node cut.cjs PROJECT_DIR SPEC... [--dry-run] [--exact] [--gate=-40]
//        node cut.cjs PROJECT_DIR --undo
// SPEC (any number, applied together):
//   words:120-135     transcript word indices, as numbered in review.txt (inclusive)
//   text:"una frase"  the first kept occurrence of the phrase; text:"una frase"@2 for the second
//   source:12.3-15    source seconds (from locate.cjs, including words only --medium found)
//   output:83.2-90    seconds of the current edit (what the user sees in Studio); m:ss also works
//   keep:80.9-81.3    source seconds to give back (a word an earlier cut clipped); applied before the cuts
// source:, output: and keep: edges move to the quietest 20 ms within ±80 ms; --exact keeps them as given.
// Word cuts exit and re-enter at the quietest 20 ms window between the neighboring words, so joins
// stay in silence. Captions follow automatically (the template drops words of removed parts).
// Every run saves the previous edit.js in src/edit-history/, so --undo restores it.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");

const RATE = 16000, WIN = 320, HOP = 80; // 20 ms window, 5 ms hop
const round = (n) => Math.round(n * 1000) / 1000;
const log = (message) => process.stderr.write(message + "\n");
const norm = (w) => String(w).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const readModule = (file) => vm.runInNewContext("(" + fs.readFileSync(file, "utf8").replace(/^\s*export\s+default\s+/m, "").replace(/;\s*$/, "") + ")");
const isKept = (w, clips) => clips.some((c) => Math.min(c.end, w.end) - Math.max(c.start, w.start) >= Math.min(0.05, w.end - w.start) - 1e-9);
const seconds = (v) => v.includes(":") ? v.split(":").reduce((acc, x) => acc * 60 + Number(x), 0) : Number(v);

// Quietest 20 ms window inside [a, b] of the source, as its center time and level.
const quietest = (source, a, b) => {
  if (b - a < WIN / RATE) return {t: (a + b) / 2, db: null};
  const run = spawnSync("ffmpeg", ["-v", "error", "-nostdin", "-ss", String(a), "-t", String(b - a), "-i", source, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"], {maxBuffer: 64 * 1024 * 1024});
  if (run.error || run.status !== 0) throw new Error("Audio decode failed: " + (run.stderr?.toString() || run.error?.message));
  const pcm = new Int16Array(run.stdout.buffer, run.stdout.byteOffset, Math.floor(run.stdout.length / 2));
  let best = {t: (a + b) / 2, db: Infinity};
  for (let s = 0; s + WIN <= pcm.length; s += HOP) {
    let sum = 0;
    for (let i = s; i < s + WIN; i++) sum += (pcm[i] / 32768) ** 2;
    const db = 10 * Math.log10(sum / WIN + 1e-12);
    if (db < best.db) best = {t: a + (s + WIN / 2) / RATE, db};
  }
  return {t: best.t, db: Math.round(best.db * 10) / 10};
};

// Remove [a, b] from the clip list; fragments under 0.1 s are dropped.
const removeRange = (clips, a, b) => clips.flatMap((c) => {
  if (b <= c.start || a >= c.end) return [c];
  return [{start: c.start, end: a}, {start: b, end: c.end}].filter((p) => p.end - p.start >= 0.1).map((p) => ({start: round(p.start), end: round(p.end)}));
});

// Add [a, b] back to the clip list, merging it with the clips it touches.
const addRange = (clips, a, b) => [...clips, {start: round(a), end: round(b)}].sort((x, y) => x.start - y.start).reduce((out, c) => {
  const last = out[out.length - 1];
  if (last && c.start <= last.end + 0.001) last.end = Math.max(last.end, c.end); else out.push({...c});
  return out;
}, []);

const outputToSource = (clips, t) => {
  let acc = 0;
  for (const c of clips) { if (t <= acc + c.end - c.start) return c.start + t - acc; acc += c.end - c.start; }
  return clips[clips.length - 1].end;
};

try {
  const args = process.argv.slice(2);
  const flags = new Map(args.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
  const [projectArg, ...specs] = args.filter((a) => !a.startsWith("--"));
  if (!projectArg) throw new Error("Usage: node cut.cjs PROJECT_DIR SPEC... [--dry-run] | --undo (SPEC: words:A-B, text:\"phrase\"[@N], source:A-B, output:A-B, keep:A-B)");
  const project = path.resolve(projectArg), editFile = path.join(project, "src", "edit.js"), historyDir = path.join(project, "src", "edit-history");
  if (flags.has("undo")) {
    const saved = fs.existsSync(historyDir) ? fs.readdirSync(historyDir).filter((f) => /^edit-\d+\.js$/.test(f)).sort() : [];
    if (!saved.length) throw new Error("Nothing to undo");
    const last = path.join(historyDir, saved[saved.length - 1]);
    fs.copyFileSync(last, editFile);
    fs.unlinkSync(last);
    const clips = readModule(editFile).clips;
    log(`Restored ${saved[saved.length - 1]}: ${clips.length} clips, ${round(clips.reduce((s, c) => s + c.end - c.start, 0))} s`);
    process.exit(0);
  }
  if (!specs.length) throw new Error("No cut given");
  const gate = Number(flags.get("gate") ?? -40);
  const edit = readModule(editFile);
  const source = path.join(project, "public", edit.source);
  const words = readModule(path.join(project, "src", "captions.js")).map((c, i) => ({i, word: String(c.text).trim(), start: c.startMs / 1000, end: c.endMs / 1000}));
  const keptWords = words.filter((w) => isKept(w, edit.clips));

  // Resolve every spec to a source range, plus the word span when it is word-based.
  const ranges = specs.map((spec) => {
    const [kind, ...rest] = spec.split(":");
    const value = rest.join(":");
    if (kind === "source" || kind === "output" || kind === "keep") {
      let [a, b] = value.split("-").map(seconds);
      if (!(b > a)) throw new Error("Bad range: " + spec);
      if (kind === "output") [a, b] = [outputToSource(edit.clips, a), outputToSource(edit.clips, b)];
      const keep = kind === "keep";
      if (flags.has("exact")) return {spec, a, b, keep};
      // Times read from a transcript or a player are off by tens of ms: move each edge to the quietest point within ±80 ms.
      const exit = quietest(source, Math.max(0, a - 0.08), a + 0.08), entry = quietest(source, Math.max(0, b - 0.08), b + 0.08);
      return {spec, a: exit.t, b: entry.t, edgesDb: [exit.db, entry.db], keep};
    }
    let first, last;
    if (kind === "words") {
      [first, last] = value.split("-").map(Number);
      if (last === undefined || Number.isNaN(last)) last = first;
      if (!words[first] || !words[last] || last < first) throw new Error("Bad word range: " + spec);
    } else if (kind === "text") {
      const m = value.match(/^"?(.*?)"?(?:@(\d+))?$/);
      const target = m[1].split(/\s+/).map(norm).filter(Boolean), nth = Number(m[2] || 1);
      let seen = 0;
      for (let k = 0; k + target.length <= keptWords.length; k++)
        if (target.every((t, j) => norm(keptWords[k + j].word) === t) && ++seen === nth) { first = keptWords[k].i; last = keptWords[k + target.length - 1].i; break; }
      if (first === undefined) throw new Error("Phrase not found among kept words: " + spec);
    } else throw new Error("Unknown spec: " + spec);
    // Edges in the silence between neighbors, searched on the source audio.
    const prev = words[first - 1], next = words[last + 1];
    const exit = quietest(source, prev ? prev.end : Math.max(0, words[first].start - 0.3), words[first].start);
    const entry = quietest(source, words[last].end, next ? next.start : words[last].end + 0.3);
    return {spec, a: exit.t, b: entry.t, edgesDb: [exit.db, entry.db], text: words.slice(first, last + 1).map((w) => w.word).join(" ")};
  });

  let clips = edit.clips;
  // Restores first, so one call can drop a bad take and give back the clipped start of the good one.
  for (const r of ranges.filter((r) => r.keep)) clips = addRange(clips, r.a, r.b);
  for (const r of ranges.filter((r) => !r.keep)) clips = removeRange(clips, r.a, r.b);
  const total = (list) => round(list.reduce((s, c) => s + c.end - c.start, 0));
  const removedWords = keptWords.filter((w) => !isKept(w, clips));
  const restoredWords = words.filter((w) => !isKept(w, edit.clips) && isKept(w, clips));
  const report = {before: total(edit.clips), after: total(clips), clips: clips.length, removedWords: removedWords.length, restoredWords: restoredWords.map((w) => w.word),
    cuts: ranges.map((r) => ({spec: r.spec, source: [round(r.a), round(r.b)], ...(r.text ? {text: r.text} : {}), ...(r.edgesDb ? {edgesDb: r.edgesDb, edgesBelowGate: r.edgesDb.every((d) => d === null || d <= gate)} : {})}))};
  if (!flags.has("dry-run")) {
    fs.mkdirSync(historyDir, {recursive: true});
    const n = fs.readdirSync(historyDir).filter((f) => /^edit-\d+\.js$/.test(f)).length + 1;
    fs.copyFileSync(editFile, path.join(historyDir, `edit-${String(n).padStart(3, "0")}.js`));
    fs.writeFileSync(editFile, "export default " + JSON.stringify({...edit, clips}, null, 2) + ";\n");
  }
  log(`${flags.has("dry-run") ? "Dry run: " : ""}${report.before} s -> ${report.after} s, ${removedWords.length} words removed: ${removedWords.map((w) => w.word).join(" ")}`);
  for (const c of report.cuts) if (c.edgesBelowGate === false) log(`  warning: ${c.spec} edge above ${gate} dB (${c.edgesDb.join(", ")}); check the join by ear`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error("ERROR:", error.message);
  process.exitCode = 1;
}
