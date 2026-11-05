// Suggests primary, secondary and tertiary colors from a logo or brand image, decoded in the headless browser.
// Usage: node extract_palette.js --image <png|jpg|webp|gif|svg> [--port 9333]
// Near-white, near-black and gray pixels only count when the image has too few real colors.
const fs = require('fs'), path = require('path');
const { args, connect } = require('./lib');
const o = args({ port: 9333 });
const fail = m => { console.error(m); process.exit(1); };
if (!o.image) fail('Missing --image');
const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }[path.extname(o.image).toLowerCase()];
if (!mime) fail(`Unsupported image format: ${path.extname(o.image)}`);
let data;
try { data = fs.readFileSync(o.image); } catch (e) { fail(e.message); }

const inPage = uri => `new Promise((res,rej)=>{const im=new Image();im.onerror=()=>rej(new Error('The browser could not decode the image'));im.onload=()=>{
  const S=128,c=document.createElement('canvas');c.width=c.height=S;const x=c.getContext('2d');x.drawImage(im,0,0,S,S);
  const d=x.getImageData(0,0,S,S).data,b=new Map();
  for(let i=0;i<d.length;i+=4){if(d[i+3]<128)continue;const k=(d[i]>>3)<<10|(d[i+1]>>3)<<5|d[i+2]>>3;const e=b.get(k)||{n:0,r:0,g:0,b:0};e.n++;e.r+=d[i];e.g+=d[i+1];e.b+=d[i+2];b.set(k,e)}
  res([...b.values()].map(e=>({n:e.n,r:Math.round(e.r/e.n),g:Math.round(e.g/e.n),b:Math.round(e.b/e.n)})))};im.src=${JSON.stringify(uri)}})`;

const hex = c => '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
const sat = c => { const a = Math.max(c.r, c.g, c.b), z = Math.min(c.r, c.g, c.b); return a ? (a - z) / a : 0; };
const light = c => (Math.max(c.r, c.g, c.b) + Math.min(c.r, c.g, c.b)) / 510;
const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
const mix = (c, t, f) => ({ r: Math.round(c.r + (t - c.r) * f), g: Math.round(c.g + (t - c.g) * f), b: Math.round(c.b + (t - c.b) * f) });

(async () => {
  const cdp = await connect(o.port);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const r = await cdp.send('Runtime.evaluate', { expression: inPage(`data:${mime};base64,${data.toString('base64')}`), awaitPromise: true, returnByValue: true }, sessionId);
  await cdp.send('Target.closeTarget', { targetId }); cdp.ws.close();
  if (r.exceptionDetails) fail(r.exceptionDetails.exception?.description || 'Could not read the image');
  const colors = r.result.value;
  if (!colors.length) fail('The image has no opaque pixels');

  const total = colors.reduce((s, c) => s + c.n, 0);
  const brand = colors.filter(c => sat(c) > .2 && light(c) > .12 && light(c) < .92).map(c => ({ ...c, score: c.n * (.3 + sat(c)) })).sort((a, b) => b.score - a.score);
  const picks = [];
  for (const c of brand) { if (picks.every(p => dist(p, c) > 70)) picks.push(c); if (picks.length === 3) break; }
  let derived = 0;
  if (!picks.length) { picks.push(colors.sort((a, b) => b.n - a.n).find(c => light(c) < .92) || { r: 47, g: 72, b: 110 }); derived++; }
  if (picks.length < 2) { picks.push(mix(picks[0], light(picks[0]) > .5 ? 0 : 255, .35)); derived++; }
  if (picks.length < 3) { picks.push(mix(picks[0], light(picks[0]) > .5 ? 0 : 255, .7)); derived++; }
  const [primary, secondary, tertiary] = picks.map(hex);
  console.log(`primary ${primary} · secondary ${secondary} · tertiary ${tertiary}${derived ? ` (${derived} derived: the image has few distinct colors)` : ''}`);
  console.log(JSON.stringify({ ok: true, primary, secondary, tertiary, derived, candidates: brand.slice(0, 8).map(c => ({ hex: hex(c), share: +(c.n / total).toFixed(3) })) }));
})().catch(e => fail(e.message || e));
