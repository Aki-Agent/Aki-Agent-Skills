#!/usr/bin/env node
// Find and download a freely licensed image (person, company, product) from Wikimedia Commons.
// Usage: node find-image.cjs search "QUERY" [--limit=8]                 Commons files: size, license, author
//        node find-image.cjs lead "ARTICLE" [--lang=en]                 the image of a Wikipedia article, if it is on Commons
//        node find-image.cjs get PROJECT_DIR "File:NAME.jpg" [--name=SLUG] [--width=1600]
// `get` saves a raster copy (SVG logos are rasterized by Commons) into public/images/SLUG.EXT and prints the
// `src` and the `credit` line to put on the overlay or screen. Commons only hosts free licenses, but most
// (CC BY, CC BY-SA) require attribution: always set `credit`. Wikipedia article images that are not on
// Commons are usually non-free (logos, posters): `lead` reports them and they must not be used.
// If nothing fits, ask the user for the image instead of using a random one.
const fs = require("node:fs");
const path = require("node:path");
const {get, getJson} = require("./net.cjs");

const COMMONS = "https://commons.wikimedia.org/w/api.php";
const META = "LicenseShortName|Artist|AttributionRequired|ImageDescription|DateTimeOriginal";
const log = (message) => process.stderr.write(message + "\n");
const text = (html) => String(html ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#039;/g, "'").replace(/\s+/g, " ").trim();
const query = (params) => COMMONS + "?" + new URLSearchParams({action: "query", format: "json", formatversion: "2", ...params});

const describe = (page) => {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  const license = text(meta.LicenseShortName?.value) || "unknown license", artist = text(meta.Artist?.value) || "unknown author";
  return {file: page.title, width: info.width, height: info.height, mime: info.mime, license, artist,
    attributionRequired: meta.AttributionRequired?.value !== "false", description: text(meta.ImageDescription?.value).slice(0, 160),
    credit: `${artist} / ${license} / Wikimedia Commons`, page: info.descriptionurl, thumb: info.thumburl ?? info.url};
};
const fileInfo = async (title, width) => {
  const data = await getJson(query({titles: title, prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiextmetadatafilter: META, iiurlwidth: String(width)}));
  const page = data.query?.pages?.[0];
  return page && !page.missing ? describe(page) : null;
};

(async () => {
  try {
    const args = process.argv.slice(2);
    const flags = new Map(args.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
    const [command, ...rest] = args.filter((a) => !a.startsWith("--"));
    if (command === "search") {
      if (!rest[0]) throw new Error("Usage: node find-image.cjs search \"QUERY\" [--limit=8]");
      const data = await getJson(query({generator: "search", gsrnamespace: "6", gsrsearch: rest[0], gsrlimit: String(flags.get("limit") ?? 8),
        prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiextmetadatafilter: META, iiurlwidth: "1600"}));
      const results = (data.query?.pages ?? []).sort((a, b) => a.index - b.index).map(describe).filter((r) => r && /^image\//.test(r.mime));
      results.forEach((r, i) => log(`${i + 1}. ${r.file}  ${r.width}x${r.height}  ${r.license}  by ${r.artist}`));
      if (!results.length) log("No images found on Commons; try another query or ask the user for the image.");
      console.log(JSON.stringify({ok: true, query: rest[0], results}, null, 2));
    } else if (command === "lead") {
      if (!rest[0]) throw new Error("Usage: node find-image.cjs lead \"ARTICLE\" [--lang=en]");
      const lang = flags.get("lang") ?? "en";
      if (!/^[a-z-]+$/.test(lang)) throw new Error(`Bad --lang "${lang}"`);
      const wiki = await getJson(`https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({action: "query", format: "json", formatversion: "2", prop: "pageimages", piprop: "name", titles: rest[0], redirects: "1"}));
      const page = wiki.query?.pages?.[0];
      if (!page || page.missing) throw new Error(`No ${lang}.wikipedia.org article "${rest[0]}"`);
      if (!page.pageimage) { log(`"${page.title}" has no lead image; use search or ask the user.`); console.log(JSON.stringify({ok: true, article: page.title, result: null}, null, 2)); return; }
      const result = await fileInfo(`File:${page.pageimage}`, 1600);
      if (result) log(`${result.file}  ${result.width}x${result.height}  ${result.license}  by ${result.artist}`);
      else log(`File:${page.pageimage} is local to ${lang}.wikipedia.org, not on Commons (usually non-free): do not use it.`);
      console.log(JSON.stringify({ok: true, article: page.title, file: `File:${page.pageimage}`, onCommons: Boolean(result), result}, null, 2));
    } else if (command === "get") {
      const [projectArg, title] = rest;
      if (!projectArg || !title) throw new Error("Usage: node find-image.cjs get PROJECT_DIR \"File:NAME.jpg\" [--name=SLUG] [--width=1600]");
      const info = await fileInfo(title.startsWith("File:") ? title : `File:${title}`, Number(flags.get("width") ?? 1600));
      if (!info) throw new Error(`${title} is not on Wikimedia Commons`);
      const ext = (/\.(jpe?g|png|webp|gif)(?:$|\?)/i.exec(info.thumb)?.[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
      const slug = String(flags.get("name") ?? info.file.replace(/^File:/, "").replace(/\.[^.]+$/, "")).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const target = path.join(path.resolve(projectArg), "public", "images", `${slug}.${ext}`);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, await get(info.thumb));
      const src = `images/${slug}.${ext}`;
      log(`Saved ${src} (${fs.statSync(target).size} bytes) from ${info.file}; credit: ${info.credit}`);
      console.log(JSON.stringify({ok: true, src, credit: info.credit, license: info.license, attributionRequired: info.attributionRequired, page: info.page}, null, 2));
    } else {
      throw new Error("Usage: node find-image.cjs search \"QUERY\" | lead \"ARTICLE\" [--lang=en] | get PROJECT_DIR \"File:NAME\" [--name=SLUG]");
    }
  } catch (error) {
    console.error("ERROR:", error.message);
    process.exitCode = 1;
  }
})();
