#!/usr/bin/env node
// Fix captions in one command; Studio hot-reloads the result.
// Usage: node captions.cjs PROJECT_DIR [--from=MEDIUM_JSON]... [--replace=FROM=TO]... [--dry-run]
//        node captions.cjs PROJECT_DIR --undo
// --from      a JSON written by locate.cjs --medium (or transcribe.py --clip): the caption words inside its
//             window are replaced by its words and timings. Use it when `small` merged a repetition or never
//             transcribed the take that was kept, so captions match what is heard.
// --replace   whole-word, case-sensitive text fix in every caption, e.g. --replace=Anthropiq=Anthropic.
// Word indices change after --from: run locate.cjs again instead of reusing old review.txt indices.
// Every run saves the previous captions.js in src/edit-history/, so --undo restores it.
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\s*export\s+default\s+/, "").replace(/;\s*$/, ""));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

try {
  const args = process.argv.slice(2);
  const values = (name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
  const [projectArg] = args.filter((a) => !a.startsWith("--"));
  if (!projectArg) throw new Error("Usage: node captions.cjs PROJECT_DIR [--from=MEDIUM_JSON]... [--replace=FROM=TO]... [--dry-run] | --undo");
  const project = path.resolve(projectArg), file = path.join(project, "src", "captions.js"), historyDir = path.join(project, "src", "edit-history");
  const history = () => fs.existsSync(historyDir) ? fs.readdirSync(historyDir).filter((f) => /^captions-\d+\.js$/.test(f)).sort() : [];
  if (args.includes("--undo")) {
    const saved = history();
    if (!saved.length) throw new Error("Nothing to undo");
    fs.copyFileSync(path.join(historyDir, saved[saved.length - 1]), file);
    fs.unlinkSync(path.join(historyDir, saved[saved.length - 1]));
    console.error(`Restored ${saved[saved.length - 1]}`);
    process.exit(0);
  }

  let caps = read(file);
  const report = {before: caps.length, windows: [], replaced: 0};
  for (const json of values("from")) {
    const data = JSON.parse(fs.readFileSync(path.resolve(json), "utf8"));
    const [a, b] = String(data.clip).split(",").map(Number);
    if (!(b > a)) throw new Error(`No clip window in ${json}`);
    // A window that ends mid-sentence makes whisper add "..." to its last word.
    const words = data.segments.flatMap((s) => s.words).map((w) => ({...w, word: w.word.trim().replace(/(\.\.\.|…)$/, "")})).filter((w) => w.word);
    // Replaced: words mostly inside the window, and merged words (over 1.2 s) that touch it.
    const inside = (c) => { const s = c.startMs / 1000, e = c.endMs / 1000, o = Math.min(b, e) - Math.max(a, s);
      return o > 0 && (o >= (e - s) / 2 || e - s > 1.2); };
    const removed = caps.filter(inside).map((c) => c.text.trim());
    caps = caps.filter((c) => !inside(c)).concat(words.map((w) => ({text: " " + w.word.trim(), startMs: Math.round(w.start * 1000),
      endMs: Math.round(w.end * 1000), timestampMs: Math.round((w.start + w.end) * 500), confidence: w.probability}))).sort((x, y) => x.startMs - y.startMs);
    report.windows.push({window: [a, b], removed: removed.join(" "), added: words.map((w) => w.word.trim()).join(" ")});
  }
  for (const pair of values("replace")) {
    const at = pair.indexOf("=");
    if (at < 1) throw new Error("Bad --replace (use FROM=TO): " + pair);
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(pair.slice(0, at))}(?![\\p{L}\\p{N}])`, "gu"), to = pair.slice(at + 1);
    for (const c of caps) { const next = c.text.replace(re, to); if (next !== c.text) { c.text = next; report.replaced++; } }
  }
  report.after = caps.length;
  if (!args.includes("--dry-run")) {
    fs.mkdirSync(historyDir, {recursive: true});
    fs.copyFileSync(file, path.join(historyDir, `captions-${String(history().length + 1).padStart(3, "0")}.js`));
    fs.writeFileSync(file, "export default " + JSON.stringify(caps) + ";\n");
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error("ERROR:", error.message);
  process.exitCode = 1;
}
