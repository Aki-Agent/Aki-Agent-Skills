#!/usr/bin/env node
/*
  Captures each .slide as a full-bleed PNG and writes a manifest JSON.
  Serves the deck over HTTP (file:// is unreliable for fonts and CORS) and
  drives navigation through the deck's own engine so that values written by
  JS (counters, typewriter, canvas) finish animating before the shot.

  Usage:
    node scripts/export_slides.mjs --html /workspace/deck.html \
      --out /workspace/.cache/motion-presentations/export --sec 4

  Flags: --sec seconds per slide (use the value check.js passes for that
  template), --port 8777, --browser /usr/bin/google-chrome, --scale 2.
  Dependencies are bootstrapped on every run (idempotent), so a recreated
  sandbox works without manual npm install.
*/
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};

// Validate the flag before resolving: path.resolve('') would turn a missing
// --html into the current directory and fail later with a slow timeout.
const HTML_RAW = flag('html', '');
if (!HTML_RAW) {
  console.error('error: --html <deck.html> is required');
  process.exit(2);
}
const DECK = path.resolve(HTML_RAW);
const ROOT = path.dirname(DECK);
const OUT = path.resolve(flag('out', '/workspace/.cache/motion-presentations/export'));
const PORT = Number(flag('port', 8777));
const SEC = Number(flag('sec', 4));
const SCALE = Number(flag('scale', 2));
const BROWSER = flag('browser', '/usr/bin/google-chrome');
const BOOTSTRAP_DIR = flag('bootstrap-dir', '/workspace/.cache/motion-presentations/node');

try { fs.accessSync(DECK, fs.constants.R); }
catch (e) {
  console.error(`error: cannot read ${DECK} (${e.code}). Project-file tools can list it (uid 999, mode 600) while the sandbox user cannot open it, and chmod on those files is not permitted. Read it with the project file tools and copy the deck into /workspace, then rerun.`);
  process.exit(2);
}
if (!fs.existsSync(BROWSER)) { console.error(`error: browser not found at ${BROWSER}. Pass --browser <path>.`); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

async function loadPuppeteer() {
  try {
    return (await import('puppeteer-core')).default;
  } catch (e) {
    if (!String(e.message).includes("Cannot find package 'puppeteer-core'")) throw e;
    fs.mkdirSync(BOOTSTRAP_DIR, { recursive: true });
    console.log(`puppeteer-core not found: bootstrapping in ${BOOTSTRAP_DIR}`);
    execFileSync('npm', ['install', '--no-save', '--no-package-lock', 'puppeteer-core'], { cwd: BOOTSTRAP_DIR, stdio: 'inherit' });
    const pkg = createRequire(path.join(BOOTSTRAP_DIR, 'noop.js')).resolve('puppeteer-core');
    return (await import('file://' + pkg)).default;
  }
}
const puppeteer = await loadPuppeteer();

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? path.basename(DECK) : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: SCALE },
});

const HIDE_CHROME = `
  html,body{margin:0;padding:0;width:1920px;height:1080px;overflow:hidden;background:#111827}
  #stage{left:0!important;top:0!important;transform:none!important;width:1920px!important;height:1080px!important}
  #chrome,.hint,.nav,#dots,#counter,#progress,#fullscreen,.nav-btn,.controls,.btn-nav{display:none!important}
`;

const page = await browser.newPage();
page.setDefaultTimeout(30000);
await page.goto(`http://127.0.0.1:${PORT}/${path.basename(DECK)}`, { waitUntil: 'networkidle0', timeout: 30000 });
await page.addStyleTag({ content: HIDE_CHROME });
await page.waitForSelector('.slide');
const stageRect = await page.evaluate(() => {
  const r = document.getElementById('stage')?.getBoundingClientRect();
  return r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null;
});
if (!stageRect) { console.error('error: #stage not found; the clip cannot be aligned'); await browser.close(); server.close(); process.exit(2); }
if (stageRect.x !== 0 || stageRect.y !== 0 || stageRect.width !== 1920 || stageRect.height !== 1080) {
  console.error(`error: #stage renders at (${stageRect.x}, ${stageRect.y}) with size ${stageRect.width}x${stageRect.height}; the clip expects (0,0) 1920x1080. Reset left/top, not only the transform, or keep an equivalent centering.`);
  await browser.close(); server.close(); process.exit(2);
}
console.log(`stage ok: ${JSON.stringify(stageRect)}`);
try { await page.evaluateHandle('document.fonts.ready'); } catch {}
await new Promise((r) => setTimeout(r, 400));

const slides = await page.evaluate(() => [...document.querySelectorAll('.slide')].map((s, i) => ({
  index: i,
  data_sec: s.getAttribute('data-sec') || '',
  title: (s.querySelector('h1,h2,.title')?.innerText || '').trim().split('\n')[0].slice(0, 120),
})));
if (!slides.length) { console.error('error: no .slide elements found'); await browser.close(); server.close(); process.exit(2); }
const canGo = await page.evaluate(() => typeof window.go === 'function');

for (let i = 0; i < slides.length; i++) {
  if (canGo) {
    await page.evaluate((n) => window.go(n, true), i);
  } else {
    await page.evaluate((n) => {
      [...document.querySelectorAll('.slide')].forEach((s, k) => {
        s.classList.toggle('is-active', k === n);
        s.style.display = k === n ? 'block' : 'none';
      });
    }, i);
  }
  await new Promise((r) => setTimeout(r, SEC * 1000));
  const png = path.join(OUT, `slide-${String(i + 1).padStart(2, '0')}.png`);
  await page.screenshot({ path: png, type: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  console.log(`captured ${i + 1}/${slides.length} ${path.basename(png)}`);
}

const manifest = {
  deck: DECK, out: OUT, slides: slides.length, sec: SEC, scale: SCALE,
  engine_nav: canGo, width: 1920 * SCALE, height: 1080 * SCALE,
  files: slides.map((s) => ({ n: s.index + 1, png: path.join(OUT, `slide-${String(s.index + 1).padStart(2, '0')}.png`), data_sec: s.data_sec, title: s.title })),
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
await browser.close();
server.close();
console.log(`ok: ${slides.length} slides captured (engine_nav=${canGo}, sec=${SEC}, scale=${SCALE})`);
