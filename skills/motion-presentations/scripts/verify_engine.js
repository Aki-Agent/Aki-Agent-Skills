// Confirms the shared engine (controls, scaling, navigation) was not edited. No browser needed.
// Usage: node verify_engine.js [presentation.html ...]
// With no files, checks that all templates share one engine. Exit: 0 identical, 2 different, 1 could not run.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const dir = path.join(__dirname, '..', 'templates');
const templates = fs.readdirSync(dir).filter(f => f.endsWith('.html')).map(f => path.join(dir, f));
const blocks = [['ENGINE-CSS', /\/\* ENGINE-CSS:BEGIN[\s\S]*?\/\* ENGINE-CSS:END \*\//], ['ENGINE-JS', /\/\* ENGINE-JS:BEGIN[\s\S]*?\/\* ENGINE-JS:END \*\//]];
const required = ['id="stage"', 'id="chrome"', 'id="wipe"', 'id="cur"', 'id="tot"', 'id="prog"', 'id="secName"', 'class="slide'];

function read(file) {
  let html;
  try { html = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch (e) { console.error(e.message); process.exit(1); }
  const out = { missing: required.filter(s => !html.includes(s)) };
  for (const [name, re] of blocks) { const m = html.match(re); out[name] = m && crypto.createHash('sha256').update(m[0]).digest('hex').slice(0, 16); }
  return out;
}

const ref = read(templates[0]);
const results = [...templates, ...process.argv.slice(2)].map(file => {
  const r = read(file);
  const changed = blocks.map(b => b[0]).filter(n => r[n] !== ref[n]);
  const ok = !changed.length && !r.missing.length;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${path.basename(file)}${changed.length ? ' · changed: ' + changed.join(', ') : ''}${r.missing.length ? ' · missing: ' + r.missing.join(', ') : ''}`);
  return { file: path.basename(file), ok, changed, missing: r.missing };
});
const ok = results.every(r => r.ok);
console.log(JSON.stringify({ ok, results }));
process.exit(ok ? 0 : 2);
