#!/usr/bin/env node
// Check a project's src/edit.js before showing it: resolved timings, component types, the
// visual budget (zooms per 30 s, total overlays) and collisions. Uses the project's own timeline.mjs.
// Usage: node validate-edit.cjs PROJECT_DIR
// Exit code: 0 = no errors (warnings allowed), 1 = errors or failure.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {pathToFileURL} = require("node:url");
const {execFileSync} = require("node:child_process");

const round = (n) => Math.round(n * 1000) / 1000;
// edit.js and captions.js are `export default <object literal>;`.
const loadDefault = (file) => {
  const code = fs.readFileSync(file, "utf8").replace(/^\s*export\s+default\s+/m, "").replace(/;\s*$/, "");
  return vm.runInNewContext("(" + code + ")", {}, {filename: file});
};
// Registered type names, read from the registries in components.jsx.
const registry = (source, name) => {
  const m = source.match(new RegExp(`export const ${name} = \\{([^}]*)\\}`));
  return m ? m[1].split(",").map((pair) => pair.split(":")[0].trim()).filter(Boolean) : null;
};
const positionOf = (item, kind) => item.position ?? (kind === "overlay" ? ({lowerThird:"bottom-left", alert:"top-center", notification:"top-center",
  icon:"center", badge:"top-right", counter:"top-center", cta:"bottom-center", sidePanel:"side", ticker:"bottom", image:"top-right"}[item.type ?? "callout"] ?? "top-left") : "full");

(async () => {
  try {
    const projectArg = process.argv[2];
    if (!projectArg) throw new Error("Usage: node validate-edit.cjs PROJECT_DIR");
    const src = path.join(path.resolve(projectArg), "src");
    const timelineFile = path.join(src, "timeline.mjs");
    if (!fs.existsSync(timelineFile)) throw new Error("Missing src/timeline.mjs; the project was created with an older template");
    const {buildClips, clipsInFrames, durationInFrames, keptCaptions, resolveItem, toFrame} = await import(pathToFileURL(timelineFile).href);
    const plan = loadDefault(path.join(src, "edit.js"));
    const allCaptions = fs.existsSync(path.join(src, "captions.js")) ? loadDefault(path.join(src, "captions.js")) : [];
    const components = fs.readFileSync(path.join(src, "components.jsx"), "utf8");
    const types = {overlay: registry(components, "OVERLAYS"), screen: registry(components, "SCREENS")};
    const errors = [], warnings = [];

    // Clips: positive, inside the source, in order.
    const sourceFile = path.join(path.resolve(projectArg), "public", plan.source);
    let sourceDuration = null;
    try { sourceDuration = Number(execFileSync("ffprobe", ["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",sourceFile], {encoding:"utf8"}).trim()); }
    catch (error) { warnings.push(`Could not probe ${plan.source}: ${error.message.split("\n")[0]}`); }
    plan.clips.forEach((c, i) => {
      if (!(c.end > c.start)) errors.push(`clips[${i}] has end <= start (${c.start}-${c.end})`);
      if (c.start < 0 || (sourceDuration && c.end > sourceDuration + 0.05)) errors.push(`clips[${i}] ${c.start}-${c.end} is outside the source (0-${round(sourceDuration)})`);
      if (i && c.start < plan.clips[i - 1].end - 1e-6) warnings.push(`clips[${i}] starts before clips[${i - 1}] ends; that part plays twice`);
    });
    if (plan.proxy && !fs.existsSync(path.join(path.resolve(projectArg), "public", plan.proxy))) errors.push(`proxy ${plan.proxy} is missing from public/`);
    const total = durationInFrames(plan) / plan.fps;
    const speech = clipsInFrames(plan) / plan.fps;
    // A closing `endcard` belongs in the silent tail, never on top of the speech.
    const endcards = (plan.screens ?? []).filter((s) => s.type === "endcard");
    if (endcards.length) {
      if (!(Number(plan.outro) > 0)) warnings.push("an endcard needs `outro` (seconds of silence after the last clip), or it covers the end of the speech");
      for (const s of endcards) {
        // Compare in frames: seconds are rounded in edit.js, so a card at the speech end is fine.
        if (toFrame(Number(s.start), plan.fps) < clipsInFrames(plan)) warnings.push(`endcard starts at ${round(Number(s.start))} s but the speech ends at ${round(speech)} s; it will cover the voice`);
        if (toFrame(Number(s.end), plan.fps) > durationInFrames(plan)) errors.push(`endcard ends at ${round(Number(s.end))} s, past the edit (${round(total)} s); raise \`outro\``);
      }
    }
    const captions = keptCaptions(allCaptions, plan);

    // Items: resolve anchors exactly like Video.jsx, then check each one.
    const resolved = {};
    for (const [field, kind] of [["zooms","zoom"],["overlays","overlay"],["screens","screen"]]) {
      resolved[field] = (plan[field] ?? []).map((item, i) => {
        const label = `${field}[${i}]${item.type ? ` (${item.type})` : ""}`;
        let r;
        try { r = resolveItem(item, plan, captions); } catch (error) { errors.push(`${label}: ${error.message}`); return null; }
        const frames = toFrame(r.end, plan.fps) - toFrame(r.start, plan.fps);
        if (frames <= 0) errors.push(`${label} has a duration of ${frames} frames (${round(r.start)}-${round(r.end)} s)`);
        if (r.start < 0 || r.end > total + 1 / plan.fps) errors.push(`${label} ${round(r.start)}-${round(r.end)} s is outside the edit (0-${round(total)} s)`);
        if (kind !== "zoom" && types[kind] && !types[kind].includes(item.type ?? (kind === "overlay" ? "callout" : "title"))) errors.push(`${label}: unknown type; available: ${types[kind].join(", ")}`);
        if (kind === "overlay" && r.end - r.start < 2.5) warnings.push(`${label} lasts ${round(r.end - r.start)} s; give overlays at least 2.5 s to be read`);
        if (kind === "zoom" && !(item.scale > 1)) warnings.push(`${label} has scale ${item.scale}; a zoom needs scale > 1`);
        return {...r, label, kind};
      }).filter(Boolean);
    }

    // Media: music, sound effects and local images must exist in public/ (renders cannot fetch a missing file).
    const publicDir = path.join(path.resolve(projectArg), "public");
    const needFile = (src, label) => { if (typeof src !== "string" || !src) errors.push(`${label} has no src`); else if (!/^(https?:|data:)/.test(src) && !fs.existsSync(path.join(publicDir, src))) errors.push(`${label}: ${src} is missing from public/`); };
    let musicSummary = null;
    if (plan.music) {
      needFile(plan.music.src, "music");
      if (!(plan.music.duration > 0)) errors.push("music.duration must be the song length in seconds (written by music.cjs)");
      else musicSummary = {src: plan.music.src, volumeDb: plan.music.volumeDb ?? -27, repeats: Math.ceil(clipsInFrames(plan) / Math.max(1, Math.floor(plan.music.duration * plan.fps)))};
      if (plan.music.volumeDb !== undefined && !Number.isFinite(plan.music.volumeDb)) errors.push(`music.volumeDb "${plan.music.volumeDb}" is not a number`);
    }
    const sfxOf = (spec) => typeof spec === "string" ? {src: spec} : spec;
    let sfxCount = 0;
    // Defaults for every screen (in/out) and zoom; an item's own sfx/sfxOut wins and false silences it.
    for (const [spec, label] of [[plan.screenSfx?.in, "screenSfx.in"], [plan.screenSfx?.out, "screenSfx.out"], [plan.zoomSfx, "zoomSfx"]]) if (spec) needFile(sfxOf(spec).src, label);
    const defaults = {sfx: {screens: plan.screenSfx?.in, zooms: plan.zoomSfx}, sfxOut: {screens: plan.screenSfx?.out}};
    for (const field of ["overlays", "screens", "zooms"]) (plan[field] ?? []).forEach((item, i) => {
      for (const key of field === "screens" ? ["sfx", "sfxOut"] : ["sfx"]) {
        const spec = item[key] === false ? null : item[key] ?? defaults[key][field];
        if (!spec) continue;
        sfxCount++;
        if (item[key]) needFile(sfxOf(item[key]).src, `${field}[${i}].${key}`);
      }
      if (item.type === "image") needFile(item.src, `${field}[${i}] (image)`);
    });
    (plan.sfx ?? []).forEach((item, i) => {
      sfxCount++;
      needFile(item.src, `sfx[${i}]`);
      try { const r = resolveItem(item, plan, captions); if (!(r.start >= 0 && r.start < total)) errors.push(`sfx[${i}] starts at ${round(r.start)} s, outside the edit (0-${round(total)} s)`); }
      catch (error) { errors.push(`sfx[${i}]: ${error.message}`); }
    });

    // Theme: known preset and effect, valid hex colors, readable text on the screen background.
    const themesFile = path.join(src, "themes.mjs");
    let themeSummary = null;
    if (fs.existsSync(themesFile)) {
      const {resolveTheme, isHexColor, contrast} = await import(pathToFileURL(themesFile).href);
      const checkTheme = (input, label) => {
        if (input === undefined) return null;
        for (const key of ["primary", "secondary", "tertiary", "accent", "highlight", "background", "background2", "text", "muted"]) {
          if (input[key] !== undefined && !isHexColor(input[key])) errors.push(`${label}.${key} "${input[key]}" is not a #rgb or #rrggbb color`);
        }
        let resolved;
        try { resolved = resolveTheme(input); } catch (error) { errors.push(`${label}: ${error.message}`); return null; }
        if (isHexColor(resolved.text) && isHexColor(resolved.background)) {
          const ratio = contrast(resolved.text, resolved.background);
          if (ratio < 4.5) warnings.push(`${label}: text ${resolved.text} on background ${resolved.background} has contrast ${ratio.toFixed(2)} (below 4.5)`);
        }
        return resolved;
      };
      const base = checkTheme(plan.theme ?? {}, "theme");
      if (base) themeSummary = {preset: base.preset, effect: base.effect, primary: base.primary, secondary: base.secondary, tertiary: base.tertiary};
      for (const field of ["overlays", "screens"]) (plan[field] ?? []).forEach((item, i) => { if (item.theme) checkTheme({...(plan.theme ?? {}), ...item.theme}, `${field}[${i}].theme`); });
    }

    // Budget: at most 2 zooms per 30 s window of output time, 1-2 overlays per video.
    const windows = [];
    for (let w = 0; w * 30 < total; w++) {
      const count = resolved.zooms.filter((z) => z.start >= w * 30 && z.start < (w + 1) * 30).length;
      windows.push(count);
      if (count > 2) warnings.push(`window ${w * 30}-${(w + 1) * 30} s has ${count} zooms (budget 2)`);
    }
    if (resolved.overlays.length > 2) warnings.push(`${resolved.overlays.length} overlays (budget 1-2 per video); prefer screens`);

    // Collisions: overlapping screens, overlapping overlays in the same position.
    const overlap = (a, b) => a.start < b.end && b.start < a.end;
    resolved.screens.forEach((a, i) => resolved.screens.slice(i + 1).forEach((b) => { if (overlap(a, b)) warnings.push(`${a.label} overlaps ${b.label}`); }));
    resolved.overlays.forEach((a, i) => resolved.overlays.slice(i + 1).forEach((b) => {
      if (overlap(a, b) && positionOf(a, "overlay") === positionOf(b, "overlay")) warnings.push(`${a.label} and ${b.label} overlap at ${positionOf(a, "overlay")}`);
    }));

    const result = {ok: errors.length === 0, outputSeconds: round(total), clips: buildClips(plan).length,
      captions: {total: allCaptions.length, kept: captions.length},
      budget: {zoomsPer30s: windows, overlays: resolved.overlays.length, screens: resolved.screens.length}, theme: themeSummary, music: musicSummary, sfx: sfxCount,
      items: Object.values(resolved).flat().map((r) => ({item: r.label, start: round(r.start), end: round(r.end)})),
      errors, warnings};
    process.stderr.write(`${result.ok ? "OK" : "FAILED"}: ${result.outputSeconds} s, ${result.clips} clips, captions ${captions.length}/${allCaptions.length} kept, `
      + `zooms per 30 s [${windows.join(", ")}], ${resolved.overlays.length} overlays, ${resolved.screens.length} screens`
      + (themeSummary ? `, theme ${themeSummary.preset} (${themeSummary.primary} / ${themeSummary.secondary} / ${themeSummary.tertiary})` : "")
      + (musicSummary ? `, music ×${musicSummary.repeats} at ${musicSummary.volumeDb} dB` : "") + (sfxCount ? `, ${sfxCount} sfx` : "") + "\n");
    for (const e of errors) process.stderr.write("  error: " + e + "\n");
    for (const w of warnings) process.stderr.write("  warning: " + w + "\n");
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error("ERROR:", error.message);
    process.exitCode = 1;
  }
})();
