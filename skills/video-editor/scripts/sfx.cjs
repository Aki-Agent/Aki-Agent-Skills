#!/usr/bin/env node
// Free sound effects from creatorassets.com (CC0 1.0 public domain: commercial use, no attribution).
// Usage: node sfx.cjs packs                            every pack in the catalogue (slug, name, asset count)
//        node sfx.cjs list PROJECT_DIR PACK            files of a pack with duration and peak (downloads them)
//        node sfx.cjs get PROJECT_DIR PACK/N...        copies into public/audio/sfx/PACK-N.wav, ready for edit.js
// Downloads go once to <WORK_DIR>/.cache/video-editor/sfx/PACK/ (next to the project, like the shared
// dependencies) and are reused. `get` trims the leading silence (below -50 dB) so the sound starts on its
// frame, and normalizes the peak to -1 dBFS so `volumeDb: -15` sounds alike for every file.
// One request per page or file: the site's terms forbid scraping that degrades the service.
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {get} = require("./net.cjs");

const SITE = "https://creatorassets.com";
const round = (n) => Math.round(n * 1000) / 1000;
const log = (message) => process.stderr.write(message + "\n");
const tool = (cmd, args) => {
  const run = spawnSync(cmd, args, {encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (run.error) throw new Error(`${cmd} failed to start: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`${cmd} failed: ${run.stderr.trim()}`);
  return run;
};
const measure = (file) => {
  const duration = Number(tool("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).stdout.trim());
  const peak = /max_volume: (-?[\d.]+) dB/.exec(tool("ffmpeg", ["-v", "info", "-nostdin", "-i", file, "-af", "volumedetect", "-f", "null", "-"]).stderr);
  return {seconds: round(duration), peakDb: peak ? Number(peak[1]) : null};
};
const cacheOf = (project) => path.join(path.dirname(project), ".cache", "video-editor", "sfx");

// File URLs listed on a pack page (extensions differ per pack: mp3 or wav); the zip is skipped.
const packFiles = async (pack) => {
  if (!/^[\w-]+$/.test(pack)) throw new Error(`Bad pack name "${pack}"; run "sfx.cjs packs"`);
  const html = (await get(`${SITE}/audio/${pack}/`)).toString("utf8");
  const pattern = new RegExp(`https://cdn\\.creatorassets\\.com/sfx/${pack}/([\\w-]+)\\.(mp3|wav)`, "g");
  const files = [...new Map([...html.matchAll(pattern)].map((m) => [m[1], {n: m[1], url: m[0], ext: m[2]}])).values()];
  if (!files.length) throw new Error(`No audio files found on ${SITE}/audio/${pack}/`);
  return files.sort((a, b) => Number(a.n) - Number(b.n));
};
const download = async (project, pack, file) => {
  const dir = path.join(cacheOf(project), pack), local = path.join(dir, `${file.n}.${file.ext}`);
  if (!fs.existsSync(local)) { fs.mkdirSync(dir, {recursive: true}); fs.writeFileSync(local, await get(file.url)); }
  return local;
};

(async () => {
  try {
    const [command, ...rest] = process.argv.slice(2);
    if (command === "packs") {
      const html = (await get(`${SITE}/catalogue/`)).toString("utf8");
      const packs = html.split('class="catalogue-item"').slice(1).map((block) => ({
        pack: /href="\/audio\/([\w-]+)/.exec(block)?.[1],
        name: /<h3[^>]*>([^<]+)<\/h3>/.exec(block)?.[1]?.trim(),
        // The site's count includes the "Download All" zip of multi-file packs.
        assets: Number(/(\d+)\s*(?:<[^>]+>\s*)*assets?/.exec(block)?.[1] ?? NaN),
      })).filter((p) => p.pack);
      for (const p of packs) log(`${p.pack.padEnd(24)} ${String(p.assets).padStart(3)}  ${p.name}`);
      console.log(JSON.stringify({ok: true, packs}, null, 2));
    } else if (command === "list") {
      const [projectArg, pack] = rest;
      if (!projectArg || !pack) throw new Error("Usage: node sfx.cjs list PROJECT_DIR PACK");
      const project = path.resolve(projectArg), files = [];
      for (const file of await packFiles(pack)) {
        const info = measure(await download(project, pack, file));
        files.push({id: `${pack}/${file.n}`, ...info});
        log(`${`${pack}/${file.n}`.padEnd(28)} ${String(info.seconds).padStart(7)} s  peak ${info.peakDb} dB`);
      }
      console.log(JSON.stringify({ok: true, pack, license: "CC0 1.0", files}, null, 2));
    } else if (command === "get") {
      const [projectArg, ...ids] = rest;
      if (!projectArg || !ids.length) throw new Error("Usage: node sfx.cjs get PROJECT_DIR PACK/N...");
      const project = path.resolve(projectArg), outDir = path.join(project, "public", "audio", "sfx"), added = [];
      fs.mkdirSync(outDir, {recursive: true});
      for (const id of ids) {
        const [pack, n] = id.split("/");
        const file = (await packFiles(pack)).find((f) => f.n === n);
        if (!file) throw new Error(`${id} not found; run "sfx.cjs list PROJECT_DIR ${pack}"`);
        const local = await download(project, pack, file), source = measure(local);
        const name = `${pack}-${n}.wav`, target = path.join(outDir, name);
        const gain = source.peakDb === null ? 0 : -1 - source.peakDb;
        tool("ffmpeg", ["-v", "error", "-nostdin", "-y", "-i", local, "-af", `silenceremove=start_periods=1:start_threshold=-50dB,volume=${gain.toFixed(2)}dB`, "-ar", "48000", target]);
        const result = measure(target);
        added.push({id, src: `audio/sfx/${name}`, seconds: result.seconds, trimmedSeconds: round(source.seconds - result.seconds), peakDb: result.peakDb});
        log(`${id} -> audio/sfx/${name}: ${result.seconds} s (lead silence ${round(source.seconds - result.seconds)} s removed), peak ${result.peakDb} dB`);
      }
      console.log(JSON.stringify({ok: true, license: "CC0 1.0 (creatorassets.com)", added}, null, 2));
    } else {
      throw new Error("Usage: node sfx.cjs packs | list PROJECT_DIR PACK | get PROJECT_DIR PACK/N...");
    }
  } catch (error) {
    console.error("ERROR:", error.message);
    process.exitCode = 1;
  }
})();
