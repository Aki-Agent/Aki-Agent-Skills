// Renders HTML components to transparent clips (MOV, PNG codec, alpha) or PNG stills.
// Usage:
//   node overlay_render.js --jobs jobs.json [--port 9341] [--browser <path>]
// jobs.json is a list:
//   { "html": "components/callout.html", "params": {...}, "w": 720, "h": 1280, "fps": 30, "dur": 4, "out": "a.mov" }
//   { "html": "scene.html", "params": {...}, "w": 720, "h": 1280, "still": true, "at": 1.5, "out": "a.png" }
// One headless Edge/Chrome serves every job and is closed at the end if this script started it.
// Time is virtual: timers, rAF, performance.now and CSS animations follow the frame clock,
// so a slow machine renders the same frames as a fast one and no frame is dropped.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

if (typeof WebSocket === 'undefined' || typeof fetch === 'undefined') {
  console.error(`Node 22+ is required (native WebSocket and fetch). Found ${process.version}.`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const jobsPath = opt('jobs');
const port = +opt('port', 9341);
if (!jobsPath) { console.error('Missing --jobs <jobs.json>'); process.exit(2); }
const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const SUB = 2; // JS logic steps per frame, so timers run at 2x the frame rate
const CALL_TIMEOUT = 60000;

const fileUrl = p => 'file:///' + path.resolve(p).replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CLOCK = `(()=>{
let T=0,seed=20261014;
Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
const D0=Date.now();Date.now=()=>D0+T;performance.now=()=>T;
const tm=new Map();let tid=1;const rf=new Map();let rid=1;
window.setTimeout=(fn,ms,...a)=>{const id=tid++;tm.set(id,{fn,at:T+Math.max(0,+ms||0),a,iv:0});return id};
window.setInterval=(fn,ms,...a)=>{const id=tid++;const iv=Math.max(1,+ms||0);tm.set(id,{fn,at:T+iv,a,iv});return id};
window.clearTimeout=window.clearInterval=id=>{tm.delete(id)};
window.requestAnimationFrame=fn=>{const id=rid++;rf.set(id,fn);return id};
window.cancelAnimationFrame=id=>{rf.delete(id)};
const seen=new WeakMap();
window.__syncAnims=()=>{for(const a of document.getAnimations()){let s=seen.get(a);if(s===undefined){s=T;seen.set(a,s);a.pause()}a.currentTime=T-s}};
window.__stepTo=(target)=>{
  for(;;){let b=null,bid=0;for(const [id,t] of tm){if(t.at<=target&&(!b||t.at<b.at||(t.at===b.at&&id<bid))){b=t;bid=id}}
    if(!b)break;T=Math.max(T,b.at);if(b.iv)b.at+=b.iv;else tm.delete(bid);
    try{typeof b.fn==='function'?b.fn(...b.a):(0,eval)(b.fn)}catch(e){console.error(e)}}
  T=target;const cbs=[...rf.values()];rf.clear();for(const cb of cbs){try{cb(T)}catch(e){console.error(e)}}
  window.__syncAnims();
};})();`;

async function alive() {
  try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; }
}

async function ensureBrowser() {
  if (await alive()) return false;
  // The profile is throwaway and wiped on every launch: a reused profile restored the previous
  // session's tabs (extension welcome pages, an old render) next to the new render tab.
  const profile = path.join(__dirname, '..', '.cache', 'overlay-browser');
  fs.rmSync(profile, { recursive: true, force: true });
  const flags = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    // Without --disable-extensions a fresh profile still opened extension welcome tabs
    // (an ad blocker, a tech profiler with payment iframes) that competed for the renderer.
    '--hide-scrollbars', '--mute-audio', '--no-first-run', '--disable-extensions',
    '--force-color-profile=srgb', 'about:blank'];
  const given = opt('browser');
  const candidates = given ? [given]
    : process.platform === 'win32' ? ['msedge', 'chrome']
    : process.platform === 'darwin' ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'];
  for (const cmd of candidates) {
    // On Windows, "start" resolves App Paths entries such as msedge, which are usually not on PATH.
    const child = process.platform === 'win32' && !given
      ? spawn('cmd', ['/c', 'start', '""', cmd, ...flags], { detached: true, stdio: 'ignore' })
      : spawn(cmd, flags, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    for (const t0 = Date.now(); Date.now() - t0 < 10000; await sleep(300)) if (await alive()) return true;
  }
  throw new Error(`No browser answered on port ${port}. Tried: ${candidates.join(', ')}. Pass --browser <path>.`);
}

async function connect() {
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error(`Could not connect to the browser on port ${port}`)); });
  let mid = 0; const pend = new Map(); const listeners = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); clearTimeout(p.timer); m.error ? p.j(new Error(JSON.stringify(m.error))) : p.r(m.result); }
    else if (m.method) listeners.forEach(l => l(m));
  };
  ws.onclose = () => { for (const p of pend.values()) { clearTimeout(p.timer); p.j(new Error('Browser connection closed')); } pend.clear(); };
  // A throttled background tab never answers captureScreenshot; fail with the method name
  // instead of hanging the whole pass (a real run stalled for minutes on one b-roll clip).
  const send = (method, params = {}, sessionId) => new Promise((r, j) => {
    const id = ++mid;
    const timer = setTimeout(() => { pend.delete(id); j(new Error(`${method} did not answer in ${CALL_TIMEOUT / 1000}s`)); }, CALL_TIMEOUT);
    pend.set(id, { r, j, timer }); ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  return { ws, send, listeners };
}

async function openPage(cdp, job) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);
  const errors = [];
  cdp.listeners.push(m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.description || a.value).join(' '));
  });
  await S('Page.enable');
  await S('Runtime.enable');
  // Headless Chromium throttles tabs it considers hidden: keep the render tab in front and focused.
  await S('Page.bringToFront');
  await S('Emulation.setFocusEmulationEnabled', { enabled: true });
  await S('Emulation.setDeviceMetricsOverride', { width: job.w, height: job.h, deviceScaleFactor: 1, mobile: false });
  // Transparent page background: whatever the component does not paint stays alpha 0.
  await S('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await S('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK });
  const params = { ...(job.params || {}), dur: job.dur || (job.params || {}).dur || 4 };
  await S('Page.navigate', { url: fileUrl(job.html) + '#' + encodeURIComponent(JSON.stringify(params)) });
  const ev = async expr => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  for (const t0 = Date.now(); ; await sleep(100)) {
    if (await ev('document.readyState').catch(() => '') === 'complete') break;
    if (Date.now() - t0 > 15000) throw new Error(`Page did not finish loading: ${job.html}`);
  }
  await ev('document.fonts.ready.then(()=>1)');
  // A missing image renders as an empty card, which looks like success; fail instead.
  const broken = await ev(`Promise.all([...document.images].map(i => i.decode().catch(() => 0)))
    .then(() => [...document.images].filter(i => !i.naturalWidth).map(i => i.getAttribute('src') || '(no src)'))`);
  if (broken.length) errors.push('Image failed to load: ' + broken.join(', '));
  await ev('__syncAnims();0');
  return { S, ev, errors, close: () => cdp.send('Target.closeTarget', { targetId }) };
}

async function renderJob(cdp, job) {
  const t0 = Date.now();
  const page = await openPage(cdp, job);
  let part = null;
  try {
    if (page.errors.length) throw new Error(`${path.basename(job.html)}: ${page.errors.join(' | ')}`);
    fs.mkdirSync(path.dirname(path.resolve(job.out)), { recursive: true });
    if (job.still) {
      await page.ev(`__stepTo(${(job.at || 0) * 1000});0`);
      const { data } = await page.S('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(job.out, Buffer.from(data, 'base64'));
      return { out: path.resolve(job.out), still: true, seconds: +((Date.now() - t0) / 1000).toFixed(2) };
    }
    const fps = job.fps || 30;
    const frames = Math.max(1, Math.round((job.dur || 4) * fps));
    // Write to a .part file and rename on success: a killed or failed render must not leave
    // a file at the final path, or the cache in enhance.py would reuse it as finished.
    part = path.resolve(job.out) + '.part';
    // Chrome already provides PNG frames with alpha; mux them without decoding and re-encoding.
    const ff = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
      '-c:v', 'copy', '-f', 'mov', part], { stdio: ['pipe', 'inherit', 'pipe'] });
    let ffErr = '';
    ff.stderr.on('data', d => { ffErr += d; });
    const ffDone = new Promise((r, j) => { ff.on('close', r); ff.on('error', e => j(new Error(`Could not run ffmpeg: ${e.message}`))); });
    for (let f = 0; f < frames; f++) {
      if (f > 0) {
        const steps = [];
        for (let s = 1; s <= SUB; s++) steps.push(`__stepTo(${((f - 1) * SUB + s) * 1000 / (fps * SUB)})`);
        await page.ev(steps.join(';') + ';0');
      }
      const { data } = await page.S('Page.captureScreenshot', { format: 'png', fromSurface: true });
      if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    const code = await ffDone;
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code} for ${job.out}\n${ffErr.trim()}`);
    if (page.errors.length) throw new Error(`${path.basename(job.html)} raised during render: ${page.errors.join(' | ')}`);
    fs.renameSync(part, path.resolve(job.out));
    return { out: path.resolve(job.out), frames, fps, seconds: +((Date.now() - t0) / 1000).toFixed(2) };
  } finally {
    if (part) fs.rmSync(part, { force: true });
    await page.close().catch(() => {});
  }
}

(async () => {
  const started = await ensureBrowser();
  const cdp = await connect();
  const results = [];
  let failed = null;
  try {
    for (const [i, job] of jobs.entries()) {
      const result = await renderJob(cdp, job);
      results.push(result);
      console.log(`[${i + 1}/${jobs.length}] ${path.basename(job.out)}  ${result.frames ? result.frames + ' frames' : 'still'}  ${result.seconds}s`);
    }
  } catch (e) {
    failed = e;
  } finally {
    if (started) await cdp.send('Browser.close').catch(() => {});
    cdp.ws.close();
  }
  if (failed) { console.error(failed.message || failed); process.exit(1); }
  console.log(JSON.stringify({ ok: true, jobs: results }));
})().catch(e => { console.error(e.message || e); process.exit(1); });
