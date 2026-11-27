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

const transcriptOf = (words) => ({segments: [{words: words.map(([word, start, end]) => ({word: " " + word, start, end, probability: 0.9}))}]});

test("detect-noises flags an unvoiced burst between words and lists a wordless clip", () => {
  // Words are 200 Hz tones at 0-1 s and 2-3 s; white noise at 1.3-1.6 s; a tone 3.5-3.8 s nobody transcribed.
  const audio = path.join(tmp, "noise.wav"), report = path.join(tmp, "noises.json"), clips = path.join(tmp, "noise-clips.json");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
    "aevalsrc=0.4*sin(2*PI*200*t)*(between(t\\,0\\,1)+between(t\\,2\\,3)+between(t\\,3.5\\,3.8))+0.3*(2*random(0)-1)*between(t\\,1.3\\,1.6):s=16000:d=4", audio]);
  fs.writeFileSync(path.join(tmp, "noise-transcript.json"), JSON.stringify(transcriptOf([["uno", 0, 1], ["dos", 2, 3]])));
  fs.writeFileSync(clips, JSON.stringify({clips: [{start: 0, end: 3.1}, {start: 3.45, end: 3.85}]}));
  const run = spawnSync(process.execPath, [path.join(SKILL, "scripts", "detect-noises.cjs"), audio, path.join(tmp, "noise-transcript.json"), clips, report], {encoding: "utf8"});
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(fs.readFileSync(report, "utf8"));
  const likely = result.candidates.filter((c) => c.likely);
  assert.equal(likely.length, 1, run.stderr);
  assert.ok(Math.abs(likely[0].start - 1.3) < 0.05 && Math.abs(likely[0].end - 1.6) < 0.05, JSON.stringify(likely[0]));
  assert.ok(likely[0].cut[0] >= 1 && likely[0].cut[1] <= 2, "cut stays between the words");
  assert.deepEqual(result.wordlessClips.map((c) => [c.start, c.kind]), [[3.45, "voiced"]]);
});

test("review-script numbers kept words and hints repeats, truncations and hanging words", () => {
  const words = [["La", 0, 0.2], ["pregunta", 0.2, 0.6], ["es", 0.6, 0.8], ["redire,", 0.8, 1.2], ["la", 2, 2.2], ["pregunta", 2.2, 2.6],
    ["es,", 2.6, 2.8], ["una", 2.8, 3], ["redirección", 3, 3.6], ["o", 3.6, 3.8], ["sea", 3.8, 4], ["para", 4, 4.2], ["corte.", 6, 6.5], ["fuera", 8, 8.5]];
  const transcript = path.join(tmp, "review-transcript.json"), review = path.join(tmp, "review.json");
  fs.writeFileSync(transcript, JSON.stringify(transcriptOf(words)));
  fs.writeFileSync(path.join(tmp, "review-clips.json"), JSON.stringify({clips: [{start: 0, end: 7}]}));
  const run = spawnSync(process.execPath, [path.join(SKILL, "scripts", "review-script.cjs"), transcript, path.join(tmp, "review-clips.json"), review], {encoding: "utf8"});
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(fs.readFileSync(review, "utf8"));
  assert.equal(result.keptWords, 13, "the word after the last clip is not kept");
  assert.deepEqual(result.hints.repeats.map((r) => [r.first, r.second]), [[[0, 2], [4, 6]]]);
  assert.deepEqual(result.hints.truncated.map((t) => [t.at, t.completedAt]), [[3, 8]]);
  assert.deepEqual(result.hints.restarts.map((r) => r.at), [9]);
  assert.deepEqual(result.hints.hanging.map((h) => h.at), [11]);
  assert.match(fs.readFileSync(review.replace(/\.json$/, ".txt"), "utf8"), /\[0000-0011\] +0\.00 \| La pregunta/);
});

test("cut.cjs removes a phrase with edges in silence and undoes it", () => {
  const project = path.join(tmp, "cut-project"), src = path.join(project, "src"), pub = path.join(project, "public");
  fs.mkdirSync(src, {recursive: true}); fs.mkdirSync(pub, {recursive: true});
  makeAudio(path.join(pub, "source.wav"));
  fs.writeFileSync(path.join(src, "edit.js"), "export default " + JSON.stringify({source: "source.wav", fps: 30, clips: [{start: 0, end: 4.9}]}) + ";\n");
  const words = [["uno", 0.1, 0.9], ["dos", 1.9, 2.7], ["tres", 3.4, 4.2]].map(([text, a, b]) => ({text: " " + text, startMs: a * 1000, endMs: b * 1000}));
  fs.writeFileSync(path.join(src, "captions.js"), "export default " + JSON.stringify(words) + ";\n");
  const cut = (...args) => spawnSync(process.execPath, [path.join(SKILL, "scripts", "cut.cjs"), project, ...args], {encoding: "utf8"});
  const run = cut("text:DOS");
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.removedWords, 1);
  const [a, b] = result.cuts[0].source;
  assert.ok(a > 1.0 && a < 1.8 && b > 2.8 && b < 3.3, `edges in the silences: ${a}, ${b}`);
  assert.ok(result.cuts[0].edgesBelowGate);
  assert.equal(result.clips, 2);
  assert.equal(cut("--undo").status, 0);
  assert.match(fs.readFileSync(path.join(src, "edit.js"), "utf8"), /"end":4\.9\}\]/);
  // A source cut, then keep: gives the word back and merges the clips again.
  assert.equal(JSON.parse(cut("source:1.0-3.0").stdout).removedWords, 1);
  const kept = JSON.parse(cut("keep:1.0-3.0").stdout);
  assert.deepEqual(kept.restoredWords, ["dos"]);
  assert.equal(kept.clips, 1);
});

test("music.cjs repeats the song exactly to the end, picks the volume by voice, and validate-edit checks media", () => {
  const project = path.join(tmp, "music-project"), src = path.join(project, "src"), pub = path.join(project, "public");
  fs.mkdirSync(src, {recursive: true}); fs.mkdirSync(pub, {recursive: true});
  makeAudio(path.join(pub, "source.wav"));
  for (const f of ["timeline.mjs", "components.jsx"]) fs.copyFileSync(path.join(SKILL, "template", f), path.join(src, f));
  fs.writeFileSync(path.join(src, "captions.js"), "export default " + JSON.stringify(captions) + ";\n");
  fs.writeFileSync(path.join(src, "edit.js"), "export default " + JSON.stringify({source: "source.wav", width: 720, height: 1280, fps: 30, clips: [{start: 0, end: 4.9}]}) + ";\n");
  const song = path.join(tmp, "song 2s.wav");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", song]);
  const music = (...args) => spawnSync(process.execPath, [path.join(SKILL, "scripts", "music.cjs"), project, ...args], {encoding: "utf8"});
  const auto = music(song);
  assert.equal(auto.status, 0, auto.stderr);
  const result = JSON.parse(auto.stdout);
  // 4.9 s of edit with a 2 s song: 3 repetitions, the last one cut at 0.9 s, never past the end.
  assert.deepEqual([result.repeats, result.lastRepeatSeconds, result.voice, result.music.volumeDb, result.music.src], [3, 0.9, true, -40, "audio/music/song-2s.wav"]);
  assert.ok(fs.existsSync(path.join(pub, "audio", "music", "song-2s.wav")));
  assert.equal(JSON.parse(music(song, "--no-voice", "--dry-run").stdout).music.volumeDb, -5);
  assert.equal(JSON.parse(music(song, "--db=-20", "--dry-run").stdout).music.volumeDb, -20);
  const validate = () => spawnSync(process.execPath, [path.join(SKILL, "scripts", "validate-edit.cjs"), project], {encoding: "utf8"});
  let check = validate();
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual(JSON.parse(check.stdout).music, {src: "audio/music/song-2s.wav", volumeDb: -40, repeats: 3});
  // A missing sound effect or image is an error, not a silent gap in the render.
  const file = path.join(src, "edit.js"), edit = JSON.parse(fs.readFileSync(file, "utf8").replace(/^export default /, "").replace(/;\s*$/, ""));
  fs.writeFileSync(file, "export default " + JSON.stringify({...edit, sfx: [{src: "audio/sfx/nope.wav", start: 1}], screenSfx: {out: "audio/sfx/out.wav"},
    overlays: [{start: 0.5, end: 3.5, type: "image", src: "images/nope.jpg"}]}) + ";\n");
  check = validate();
  assert.equal(check.status, 1);
  const errors = JSON.parse(check.stdout).errors.join("\n");
  assert.match(errors, /sfx\[0\]: audio\/sfx\/nope\.wav is missing/);
  assert.match(errors, /overlays\[0\] \(image\): images\/nope\.jpg is missing/);
  assert.match(errors, /screenSfx\.out: audio\/sfx\/out\.wav is missing/);
  const rejected = music("--remove");
  assert.equal(rejected.status, 1, "missing effects prevent a stale preview");
  assert.match(rejected.stderr, /Audio file not found/);
  fs.writeFileSync(file, "export default " + JSON.stringify(edit) + ";\n");
  assert.equal(music("--remove").status, 0);
  assert.ok(!/"music"/.test(fs.readFileSync(file, "utf8")));
});

test("preview mixes cut voice, repeated music and anchored effects into one track", () => {
  const project = path.join(tmp, "preview-mix"), src = path.join(project, "src"), pub = path.join(project, "public");
  fs.mkdirSync(src, {recursive: true}); fs.mkdirSync(pub, {recursive: true});
  const tone = (name, frequency, duration) => execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
    `sine=frequency=${frequency}:duration=${duration}:sample_rate=48000`, path.join(pub, name)]);
  tone("source.wav", 220, 5); tone("song.wav", 440, 1); tone("effect.wav", 880, 0.4);
  const edit = {source: "source.wav", fps: 30, clips: [{start: 0, end: 1}, {start: 2, end: 5}],
    music: {src: "song.wav", duration: 1, volumeDb: -6, fadeOut: 0},
    sfx: [{src: "effect.wav", word: "hello", volumeDb: -6}],
    screens: [{start: 2.5, end: 3, sfx: "effect.wav"}]};
  const file = path.join(src, "edit.js");
  fs.writeFileSync(file, "export default " + JSON.stringify(edit) + ";\n");
  fs.writeFileSync(path.join(src, "captions.js"), 'export default [{"text":" hello","startMs":2200,"endMs":2500}];\n');
  const build = () => spawnSync(process.execPath, [path.join(SKILL, "scripts", "preview-audio.cjs"), project], {encoding: "utf8"});
  let run = build();
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual([JSON.parse(run.stdout).seconds, JSON.parse(run.stdout).sounds], [4, 2]);
  const version = fs.readFileSync(path.join(src, "preview-version.js"), "utf8");
  const samples = execFileSync("ffmpeg", ["-v", "error", "-i", path.join(pub, "preview-audio.wav"),
    "-f", "f32le", "-ac", "1", "-ar", "48000", "-"]);
  const level = (frequency, start) => {
    let re = 0, im = 0;
    for (let i = 0; i < 4800; i++) {
      const x = samples.readFloatLE((Math.round(start * 48000) + i) * 4);
      re += x * Math.cos(2 * Math.PI * frequency * i / 48000);
      im += x * Math.sin(2 * Math.PI * frequency * i / 48000);
    }
    return Math.hypot(re, im) / 2400;
  };
  assert.ok(level(220, 0.4) > 0.05, "voice remains audible");
  assert.ok(level(440, 0.4) > 0.03 && level(440, 3.4) > 0.03, "music repeats throughout the edit");
  assert.ok(level(880, 1.3) > 0.03 && level(880, 2.6) > 0.015, "word-anchored and screen effects play at their configured levels");
  assert.ok(level(880, 0.4) < 0.005 && level(880, 3.4) < 0.005, "effects stay within their windows");
  fs.writeFileSync(file, "export default " + JSON.stringify({...edit, music: undefined, sfx: [], screens: []}) + ";\n");
  run = build();
  assert.equal(run.status, 0, run.stderr);
  assert.notEqual(fs.readFileSync(path.join(src, "preview-version.js"), "utf8"), version, "Studio gets a new audio URL");
});

test("captions.cjs replaces a window with medium words, fixes names and undoes it", () => {
  const project = path.join(tmp, "captions-project"), src = path.join(project, "src");
  fs.mkdirSync(src, {recursive: true});
  const caps = [["Hola", 0, 0.5], ["Anthropiq", 0.5, 1.2], ["duro", 1.3, 3.2], ["fin", 3.4, 3.8]].map(([text, a, b]) => ({text: " " + text, startMs: a * 1000, endMs: b * 1000}));
  fs.writeFileSync(path.join(src, "captions.js"), "export default " + JSON.stringify(caps) + ";\n");
  const medium = path.join(tmp, "medium-2.5-3.3.json");
  fs.writeFileSync(medium, JSON.stringify({clip: "2.5,3.3", segments: [{words: [["Pero", 2.5, 2.7], ["es", 2.7, 2.8], ["duro...", 2.8, 3.2]].map(([word, start, end]) => ({word: " " + word, start, end, probability: 0.9}))}]}));
  const run = (...args) => spawnSync(process.execPath, [path.join(SKILL, "scripts", "captions.cjs"), project, ...args], {encoding: "utf8"});
  const result = run(`--from=${medium}`, "--replace=Anthropiq=Anthropic");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).windows[0].removed, "duro"); // merged word (1.9 s) touching the window
  const text = () => JSON.parse(fs.readFileSync(path.join(src, "captions.js"), "utf8").replace(/^export default /, "").replace(/;\s*$/, "")).map((c) => c.text.trim()).join(" ");
  assert.equal(text(), "Hola Anthropic Pero es duro fin");
  assert.equal(run("--undo").status, 0);
  assert.equal(text(), "Hola Anthropiq duro fin");
});
