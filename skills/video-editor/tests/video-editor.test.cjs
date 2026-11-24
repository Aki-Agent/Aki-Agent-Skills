// Run: node --test skills/video-editor/tests/
// Needs FFmpeg/ffprobe on PATH. Inputs are synthetic (lavfi), so no media is committed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync, execFileSync} = require("node:child_process");
const {pathToFileURL} = require("node:url");

const SKILL = path.resolve(__dirname, "..");
const timeline = () => import(pathToFileURL(path.join(SKILL, "template", "timeline.mjs")).href);
const themes = () => import(pathToFileURL(path.join(SKILL, "template", "themes.mjs")).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "video-editor-test-"));
test.after(() => fs.rmSync(tmp, {recursive: true, force: true}));

// Tone 0-1 s, 1.8-2.8 s and 3.3-4.3 s; silences of 0.8 s, 0.5 s and a trailing 0.6 s.
const makeAudio = (file) => execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
  "aevalsrc=0.5*sin(2*PI*440*t)*(between(t\\,0\\,1)+between(t\\,1.8\\,2.8)+between(t\\,3.3\\,4.3)):s=16000:d=4.9", file]);

test("plan-silence cuts every pause, including a trailing one, and verifies the joined audio", () => {
  const audio = path.join(tmp, "tones.wav"), plan = path.join(tmp, "plan.json");
  makeAudio(audio);
  const run = spawnSync(process.execPath, [path.join(SKILL, "scripts", "plan-silence.cjs"), audio, "-", plan], {encoding: "utf8"});
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(fs.readFileSync(plan, "utf8"));
  assert.equal(result.cuts.length, 3);
  const expected = [[1.07, 1.73], [2.87, 3.23], [4.37, 4.9]];
  result.cuts.forEach((c, i) => {
    assert.ok(Math.abs(c.start - expected[i][0]) < 0.03, `cut ${i} start ${c.start}`);
    assert.ok(Math.abs(c.end - expected[i][1]) < 0.1, `cut ${i} end ${c.end}`);
  });
  assert.equal(result.verification.pausesOverTarget, 0);
  assert.ok(result.outputDuration > 3.3 && result.outputDuration < 3.6, `output ${result.outputDuration}`);
});

test("plan-silence refuses to overwrite a plan and reports the real error", () => {
  const plan = path.join(tmp, "exists.json");
  fs.writeFileSync(plan, "{}");
  const run = spawnSync(process.execPath, [path.join(SKILL, "scripts", "plan-silence.cjs"), path.join(tmp, "missing.wav"), "-", plan], {encoding: "utf8"});
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Plan already exists/);
});

const plan = {fps: 30, clips: [{start: 0, end: 2}, {start: 3, end: 5}]};
const captions = [
  {text: " Hello", startMs: 100, endMs: 400}, {text: " of", startMs: 1900, endMs: 1940},
  {text: " more", startMs: 2200, endMs: 2600}, {text: " Aki.ar", startMs: 3200, endMs: 3700},
  {text: " now", startMs: 4000, endMs: 4200}, {text: " café", startMs: 4200, endMs: 4500},
];

test("timeline maps source time to output time, snapping removed time to a kept clip", async () => {
  const {sourceToOutput, durationInFrames} = await timeline();
  assert.equal(durationInFrames(plan), 120);
  assert.equal(sourceToOutput(1, plan), 1);
  assert.equal(sourceToOutput(3.5, plan), 2.5);
  assert.equal(sourceToOutput(2.5, plan, "start"), 2);
  assert.equal(sourceToOutput(2.5, plan, "end"), 2);
});

test("keptCaptions drops words of removed time but keeps short words inside a clip", async () => {
  const {keptCaptions} = await timeline();
  const kept = keptCaptions(captions, plan).map((c) => c.text.trim());
  assert.deepEqual(kept, ["Hello", "of", "Aki.ar", "now", "café"]);
});

test("word anchors ignore case and accents, and count occurrences", async () => {
  const {resolveItem, findWord} = await timeline();
  assert.deepEqual(findWord(captions, "CAFE"), {start: 4.2, end: 4.5});
  const r = resolveItem({word: "aki.ar", duration: 1}, plan, captions);
  assert.ok(Math.abs(r.start - 2.2) < 1e-9 && Math.abs(r.end - 3.2) < 1e-9);
  const s = resolveItem({at: "source", start: 3.2, end: 4.5}, plan, captions);
  assert.ok(Math.abs(s.start - 2.2) < 1e-9 && Math.abs(s.end - 3.5) < 1e-9);
  assert.throws(() => findWord(captions, "now", 2), /not found/);
});

test("limitPageWords splits long caption pages without losing tokens", async () => {
  const {limitPageWords} = await timeline();
  const tokens = Array.from({length: 7}, (_, i) => ({text: ` w${i}`, fromMs: i * 100, toMs: i * 100 + 90}));
  const pages = limitPageWords([{text: "", startMs: 0, durationMs: 800, tokens}], 3);
  assert.deepEqual(pages.map((p) => p.tokens.length), [3, 3, 1]);
  assert.deepEqual(pages.map((p) => [p.startMs, p.startMs + p.durationMs]), [[0, 300], [300, 600], [600, 800]]);
});

test("every theme preset resolves with readable text, also with custom colors", async () => {
  const {THEME_NAMES, resolveTheme, contrast} = await themes();
  const combos = [{}, {primary: "#ffe456", secondary: "#3d8bff", tertiary: "#ef4444"}, {primary: "#111111", secondary: "#222222", tertiary: "#333333"}];
  for (const preset of THEME_NAMES) for (const colors of combos) {
    const t = resolveTheme({preset, ...colors}), label = `${preset} ${JSON.stringify(colors)}`;
    assert.ok(contrast(t.text, t.background) >= 4.5, `${label}: text ${contrast(t.text, t.background).toFixed(2)}`);
    assert.ok(contrast(t.accentText, t.background) >= 3 || t.accentText === t.text, `${label}: accentText`);
    assert.ok(contrast(t.highlightText, t.background) >= 3, `${label}: highlightText`);
    if (colors.primary) assert.equal(t.primary, colors.primary);
  }
});

test("theme aliases, explicit colors and unknown presets", async () => {
  const {resolveTheme} = await themes();
  const t = resolveTheme({accent: "#e11d48", highlight: "#22d3ee"});
  assert.deepEqual([t.primary, t.secondary, t.preset], ["#e11d48", "#22d3ee", "default"]);
  // An explicit background is kept as given, even when it is hard to read.
  assert.equal(resolveTheme({preset: "luxe", primary: "#ffe456", background: "#ffe456"}).background, "#ffe456");
  assert.equal(resolveTheme({preset: "comic", primary: "#ffe456"}).text, "#111111");
  assert.throws(() => resolveTheme({preset: "nope"}), /Unknown theme preset "nope"/);
  assert.throws(() => resolveTheme({effect: "nope"}), /Unknown theme effect "nope"/);
});

test("validate-edit reports a negative item duration as an error", () => {
  const project = path.join(tmp, "project"), src = path.join(project, "src");
  fs.mkdirSync(src, {recursive: true});
  fs.mkdirSync(path.join(project, "public"));
  makeAudio(path.join(project, "public", "source.wav"));
  for (const f of ["timeline.mjs", "components.jsx"]) fs.copyFileSync(path.join(SKILL, "template", f), path.join(src, f));
  fs.writeFileSync(path.join(src, "captions.js"), "export default " + JSON.stringify(captions) + ";\n");
  fs.writeFileSync(path.join(src, "edit.js"), "export default " + JSON.stringify({source: "source.wav", width: 720, height: 1280, fps: 30,
    clips: plan.clips, zooms: [], overlays: [{start: 3, end: 2, type: "callout", text: "x"}], screens: [{word: "Aki.ar", duration: 1, type: "nope"}]}) + ";\n");
  const run = spawnSync(process.execPath, [path.join(SKILL, "scripts", "validate-edit.cjs"), project], {encoding: "utf8"});
  assert.equal(run.status, 1, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.ok(result.errors.some((e) => /overlays\[0\].*duration of -30 frames/.test(e)), result.errors.join("\n"));
  assert.ok(result.errors.some((e) => /screens\[0\].*unknown type/.test(e)), result.errors.join("\n"));
});
