// Pre-delivery QA: simulates every slide on the virtual clock (no capture) and reports, at the end of each slide,
// animated elements left invisible, elements outside the stage, text overlapping the chrome, and JS errors.
// Usage: node check.js --html <presentation.html> [--sec 15] [--port 9333]
// Exit: 0 clean, 2 problems found, 1 could not run.
const { args, connect, openPage } = require('./lib');
const o = args({ sec: 15, port: 9333 });
if (!o.html) { console.error('Missing --html'); process.exit(1); }

(async () => {
  const cdp = await connect(o.port);
  const page = await openPage(cdp, o.html, 2560, 1440);
  const n = await page.ev(`document.querySelectorAll('.slide').length`);
  if (!n) throw new Error('No .slide elements found');
  const steps = Math.round(o.sec * 60);
  let problems = 0; const report = [];
  for (let k = 0; k < n; k++) {
    for (let f = k * steps + 1; f <= (k + 1) * steps; f++) await page.ev(`__stepTo(${f * 1000 / 60});0`);
    const r = await page.ev(`(()=>{const s=document.querySelector('.slide.active');
      const els=[...s.querySelectorAll('.r,h1,h2')];
      const hidden=els.filter(e=>+getComputedStyle(e).opacity<0.99&&!e.closest('.dim,.out,.strike')).length;
      const stage=document.getElementById('stage').getBoundingClientRect(),z=stage.width/1920;
      const overflow=[...s.querySelectorAll('*')].filter(e=>{const b=e.getBoundingClientRect();return b.width&&!e.closest('.ticker')&&(b.right>stage.right+2||b.bottom>stage.bottom+2||b.left<stage.left-2)}).length;
      const texts=[...s.querySelectorAll('*')].filter(e=>[...e.childNodes].some(c=>c.nodeType===3&&c.textContent.trim())&&!e.closest('.sec-num,.sec-big,.num,.ticker'));
      const overlap=texts.filter(e=>{const b=e.getBoundingClientRect();return b.width&&((b.top-stage.top)/z<100||(b.bottom-stage.top)/z>958)}).map(e=>e.textContent.trim().slice(0,30));
      const vals=[...s.querySelectorAll('[data-count],[data-type],.tm')].map(e=>e.textContent.trim()).join(' | ');
      return {slide:slides.indexOf(s)+1,sec:s.dataset.sec||'',animated:els.length,hidden,overflow,overlap,vals}})()`);
    const bad = r.hidden || r.overflow || r.overlap.length;
    if (bad) problems++;
    report.push(r);
    console.log(`${String(r.slide).padStart(2)} ${bad ? 'FAIL' : 'ok  '} [${r.sec}] animated=${r.animated} hidden=${r.hidden} overflow=${r.overflow} chrome_overlap=${r.overlap.length}${r.overlap.length ? ' (' + r.overlap.join(' / ') + ')' : ''}${r.vals ? ' · ' + r.vals : ''}`);
    if (k < n - 1) await page.ev(`go(${k + 1});__syncAnims();0`);
  }
  const errors = [...new Set(page.errors)];
  errors.forEach(e => console.log('JS ERROR:', e));
  await page.close(); cdp.ws.close();
  const ok = !problems && !errors.length;
  console.log(ok ? `OK: ${n} slides with no problems` : `${problems} slide(s) with problems, ${errors.length} JS error(s)`);
  console.log(JSON.stringify({ ok, slides: n, problems, errors, report }));
  process.exit(ok ? 0 : 2);
})().catch(e => { console.error(e.message || e); process.exit(1); });
