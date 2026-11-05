// Deterministic render of a presentation to MP4 through a headless browser + ffmpeg.
// Usage:
//   node render.js --html <presentation.html> --out <video.mp4> [--sec 15] [--w 2560] [--h 1440] [--fps 30]
//                  [--port 9333] [--clean] [--crf 17] [--frames N]
//   --clean   hides logo, counter and progress bar (#chrome.hide)
//   --frames  limits the number of frames (short test runs)
// Requires a running headless browser (start_browser.js) and ffmpeg on PATH.
// The previous/next buttons are never captured: the "capture" class hides them.
const { spawn } = require('child_process');
const path = require('path');
const { args, connect, openPage } = require('./lib');

const o = args({ sec: 15, w: 2560, h: 1440, fps: 30, port: 9333, crf: 17 });
if (!o.html || !o.out) { console.error('Missing --html and/or --out'); process.exit(1); }
const SUB = 2; // sub-steps per frame: JS logic runs at 60 Hz, same speed as live

(async () => {
  const cdp = await connect(o.port);
  const page = await openPage(cdp, o.html, o.w, o.h);
  const slides = await page.ev(`document.querySelectorAll('.slide').length`);
  await page.ev(`document.documentElement.classList.add('capture');0`);
  if (o.clean) await page.ev(`document.getElementById('chrome')?.classList.add('hide');__syncAnims();0`);
  const perSlide = Math.round(o.fps * o.sec);
  const total = o.frames || slides * perSlide;
  console.log(`${slides} slides x ${o.sec}s · ${o.w}x${o.h}@${o.fps} · ${total} frames`);

  // JPEG over a pipe to x264 in TV range (standard yuv420p, editor friendly)
  const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(o.fps), '-c:v', 'mjpeg', '-i', '-',
    '-vf', 'scale=in_range=full:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(o.crf), '-color_range', 'tv',
    '-r', String(o.fps), '-movflags', '+faststart', path.resolve(o.out)], { stdio: ['pipe', 'inherit', 'inherit'] });
  ff.on('error', e => { console.error('Could not run ffmpeg:', e.message); process.exit(1); });
  const ffDone = new Promise(r => ff.on('close', r));

  const t0 = Date.now(); let last = t0;
  for (let f = 0; f < total; f++) {
    const js = [];
    if (f > 0) for (let s = 1; s <= SUB; s++) js.push(`__stepTo(${((f - 1) * SUB + s) * 1000 / (o.fps * SUB)})`);
    if (f > 0 && f % perSlide === 0) js.push(`go(${f / perSlide});__syncAnims()`);
    if (js.length) await page.ev(js.join(';') + ';0');
    const { data } = await page.S('Page.captureScreenshot', { format: 'jpeg', quality: 95, fromSurface: true });
    if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    if (Date.now() - last > 15000) { last = Date.now(); console.log(`${f + 1}/${total} frames · ${((last - t0) / 1000).toFixed(0)}s`); }
  }
  ff.stdin.end();
  const code = await ffDone;
  await page.close(); cdp.ws.close();
  if (code !== 0) { console.error('ffmpeg exited with code', code); process.exit(1); }
  const secs = (Date.now() - t0) / 1000;
  console.log(`OK ${total} frames in ${secs.toFixed(0)}s -> ${path.resolve(o.out)}`);
  console.log(JSON.stringify({ ok: true, out: path.resolve(o.out), frames: total, slides, seconds: +secs.toFixed(1), capture_fps: +(total / secs).toFixed(1) }));
})().catch(e => { console.error(e.message || e); process.exit(1); });
