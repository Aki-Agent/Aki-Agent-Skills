// Shared helpers: arguments, minimal CDP client (native WebSocket, Node 22+) and virtual clock.
const path = require('path');

if (typeof WebSocket === 'undefined' || typeof fetch === 'undefined') {
  console.error(`Node 22+ is required (native WebSocket and fetch). Found ${process.version}.`);
  process.exit(1);
}

function args(defaults) {
  const out = { ...defaults };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2), nx = a[i + 1];
    if (nx === undefined || nx.startsWith('--')) out[k] = true;
    else { out[k] = isNaN(+nx) || nx.startsWith('#') ? nx : +nx; i++; }
  }
  return out;
}

const fileUrl = p => 'file:///' + path.resolve(p).replace(/\\/g, '/');

async function connect(port) {
  let ver;
  try {
    ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  } catch (e) {
    throw new Error(`No browser with remote debugging on port ${port} (run start_browser.js first): ${e.cause?.code || e.message}`);
  }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error(`Could not connect to the browser on port ${port}`)); });
  let mid = 0; const pend = new Map(); const listeners = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.j(new Error(JSON.stringify(m.error))) : p.r(m.result); }
    else if (m.method) listeners.forEach(l => l(m));
  };
  const send = (method, params = {}, sessionId) => new Promise((r, j) => {
    const id = ++mid; pend.set(id, { r, j }); ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  return { ws, send, listeners };
}

// Opens a new tab with the virtual clock injected and returns helpers. page.errors collects JS errors.
async function openPage(cdp, html, w, h) {
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
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await S('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK });
  await S('Page.navigate', { url: fileUrl(html) });
  await new Promise(r => setTimeout(r, 2500));
  const ev = async expr => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await ev('document.fonts.ready.then(()=>1)');
  return { S, ev, errors, close: () => cdp.send('Target.closeTarget', { targetId }) };
}

// Virtual clock: timers, rAF, performance.now, Date.now, seeded Math.random and CSS animations
// (Web Animations API: paused on appearance and positioned with currentTime = virtual time).
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

module.exports = { args, connect, openPage, CLOCK, fileUrl };
