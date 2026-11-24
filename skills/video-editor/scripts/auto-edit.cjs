#!/usr/bin/env node
// One command from a raw video to a cut project ready for Studio:
//   transcribe  ||  create project + proxy    (in parallel: the two slowest steps)
//   -> plan silences -> clips into edit.js, captions into captions.js
//   -> detect noises -> remove noise-only clips and likely noises with quiet edges
//   -> review-script (review.txt for the one script read) -> validate-edit
// Usage: node auto-edit.cjs VIDEO WORK_DIR [--python=python] [--language=es] [--cache-dir=DIR]
//   [--model=small] [--deps=DIR] [--transcript=EXISTING_JSON] [--min-score=0.6]
// WORK_DIR must not exist. It gets transcript.json, silence-plan.json, noises.json, review.json/.txt,
// auto-edit.json (summary) and project/.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawn} = require("node:child_process");

const SCRIPTS = __dirname;
const round = (n) => Math.round(n * 1000) / 1000;
const log = (message) => process.stderr.write(message + "\n");
const readModule = (file) => vm.runInNewContext("(" + fs.readFileSync(file, "utf8").replace(/^\s*export\s+default\s+/m, "").replace(/;\s*$/, "") + ")");

// Run a command, keep its stdout, stream its stderr with a prefix; resolve on an allowed exit code.
const run = (label, command, args, ok = [0]) => new Promise((resolve, reject) => {
  const started = Date.now();
  const child = spawn(command, args, {stdio: ["ignore", "pipe", "pipe"]});
  let out = "", err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  child.on("error", reject);
  child.on("close", (code) => {
    const secondsTaken = Math.round((Date.now() - started) / 100) / 10;
    log(`[${label}] exit ${code} in ${secondsTaken} s`);
    if (!ok.includes(code)) return reject(new Error(`${label} failed (exit ${code}):\n${err.trim().split("\n").slice(-15).join("\n")}`));
    resolve({out, err, code, seconds: secondsTaken});
  });
});
const json = (text) => { const i = text.indexOf("{"); return i < 0 ? {} : JSON.parse(text.slice(i)); };

const removeRange = (clips, a, b) => clips.flatMap((c) => {
  if (b <= c.start || a >= c.end) return [c];
  return [{start: c.start, end: a}, {start: b, end: c.end}].filter((p) => p.end - p.start >= 0.1).map((p) => ({start: round(p.start), end: round(p.end)}));
});
const total = (clips) => round(clips.reduce((s, c) => s + c.end - c.start, 0));

(async () => {
  const args = process.argv.slice(2);
  const flags = new Map(args.filter((a) => a.startsWith("--")).map((a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.length ? v.join("=") : true]; }));
  const [videoArg, workArg] = args.filter((a) => !a.startsWith("--"));
  if (!videoArg || !workArg) throw new Error("Usage: node auto-edit.cjs VIDEO WORK_DIR [--python=python] [--language=es] [--cache-dir=DIR] [--model=small] [--deps=DIR] [--transcript=JSON] [--min-score=0.6]");
  const video = path.resolve(videoArg), work = path.resolve(workArg);
  if (!fs.statSync(video).isFile()) throw new Error("Input must be a file");
  if (fs.existsSync(work)) throw new Error("Work directory already exists: " + work);
  fs.mkdirSync(work, {recursive: true});
  const file = (name) => path.join(work, name), project = file("project");
  const started = Date.now(), timings = {};

  // 1. The two slow steps in parallel. The project is created without captions; they are written after.
  const transcript = file("transcript.json");
  const transcribing = flags.has("transcript")
    ? Promise.resolve(fs.copyFileSync(path.resolve(flags.get("transcript")), transcript)).then(() => ({seconds: 0}))
    : run("transcribe", flags.get("python") || "python", [path.join(SCRIPTS, "transcribe.py"), video, transcript, "--language", flags.get("language") || "es",
      "--model", flags.get("model") || "small", ...(flags.has("cache-dir") ? ["--cache-dir", path.resolve(flags.get("cache-dir"))] : [])]);
  const creating = run("create-project", process.execPath, [path.join(SCRIPTS, "create-project.cjs"), video, project,
    ...(flags.has("deps") ? ["--deps=" + path.resolve(flags.get("deps"))] : [])]);
  const [tr, cp] = await Promise.all([transcribing, creating]);
  timings.transcribe = tr.seconds; timings.createProject = cp.seconds;

  // 2. Silence plan (exit 2 = audit flagged words; the plan is still written and listed in the summary).
  const plan = await run("plan-silence", process.execPath, [path.join(SCRIPTS, "plan-silence.cjs"), video, transcript, file("silence-plan.json")], [0, 2]);
  timings.planSilence = plan.seconds;
  const silence = JSON.parse(fs.readFileSync(file("silence-plan.json"), "utf8"));
  const words = JSON.parse(fs.readFileSync(transcript, "utf8")).segments.flatMap((s) => s.words || [])
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && typeof w.word === "string");
  const captions = words.map((w) => ({text: w.word, startMs: Math.round(w.start * 1000), endMs: Math.round(w.end * 1000),
    timestampMs: Math.round((w.start + w.end) * 500), confidence: w.probability ?? null}));
  fs.writeFileSync(path.join(project, "src", "captions.js"), "export default " + JSON.stringify(captions) + ";\n");
  const editFile = path.join(project, "src", "edit.js");
  const edit = readModule(editFile);
  const writeEdit = (clips) => fs.writeFileSync(editFile, "export default " + JSON.stringify({...edit, clips}, null, 2) + ";\n");
  writeEdit(silence.clips);

  // 3. Noises on the silence-cut clips. Applied without asking: noise-only or quiet clips that touch no
  // word, and likely noises whose cut edges are below the gate. Voiced wordless clips are kept and listed.
  const noise = await run("detect-noises", process.execPath, [path.join(SCRIPTS, "detect-noises.cjs"), video, transcript, project, file("noises.json"),
    "--min-score=" + (flags.get("min-score") || 0.6)]);
  timings.detectNoises = noise.seconds;
  const noises = JSON.parse(fs.readFileSync(file("noises.json"), "utf8"));
  const applied = [];
  let clips = silence.clips;
  for (const c of noises.wordlessClips || []) if (c.kind !== "voiced") { clips = removeRange(clips, c.start, c.end); applied.push({type: "wordless-" + c.kind, source: [c.start, c.end]}); }
  for (const c of noises.candidates || []) if (c.likely && c.edgesBelowGate) { clips = removeRange(clips, c.cut[0], c.cut[1]); applied.push({type: "noise", score: c.score, source: c.cut, between: [c.before, c.after]}); }
  writeEdit(clips);

  // 4. Script review on the result, then validation.
  const review = await run("review-script", process.execPath, [path.join(SCRIPTS, "review-script.cjs"), transcript, project, file("review.json")]);
  const validate = await run("validate-edit", process.execPath, [path.join(SCRIPTS, "validate-edit.cjs"), project], [0, 1]);
  timings.total = Math.round((Date.now() - started) / 100) / 10;

  const summary = {project, sourceSeconds: json(plan.out).sourceSeconds ?? null, afterSilence: total(silence.clips), afterNoises: total(clips), clips: clips.length,
    words: captions.length, silence: json(plan.out), noiseCutsApplied: applied,
    voicedWordlessClips: (noises.wordlessClips || []).filter((c) => c.kind === "voiced").map((c) => [c.start, c.end]),
    review: {text: file("review.txt"), ...json(review.out)}, validation: (validate.out + validate.err).trim().split("\n").slice(-3).join(" | "), timings,
    // Reused by locate.cjs --medium, so later fixes need no paths.
    tools: {python: flags.get("python") || "python", cacheDir: flags.has("cache-dir") ? path.resolve(flags.get("cache-dir")) : null, language: flags.get("language") || "es"}};
  fs.writeFileSync(file("auto-edit.json"), JSON.stringify(summary, null, 2) + "\n");
  log(`Done in ${timings.total} s: ${summary.sourceSeconds ?? "?"} s -> ${summary.afterSilence} s (silences) -> ${summary.afterNoises} s (${applied.length} noise cuts). Next: read ${file("review.txt")} and cut with cut.cjs.`);
  console.log(JSON.stringify(summary, null, 2));
})().catch((error) => {
  console.error("ERROR:", error.message);
  process.exitCode = 1;
});
