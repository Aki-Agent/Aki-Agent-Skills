// Applies brand colors, logo and title to a presentation copied from templates/. Touches only the theme and brand blocks.
// Usage: node apply_brand.js --html <presentation.html> [--primary #rrggbb] [--secondary #rrggbb] [--tertiary #rrggbb]
//                            [--logo <png|jpg|webp|gif|svg>] [--no-logo] [--title "Text"] [--lang es]
// Omitted options keep their current value. Readable text colors (--on-*) are recalculated.
const fs = require('fs'), path = require('path');
const { args } = require('./lib');
const o = args({});
const fail = m => { console.error(m); process.exit(1); };
if (!o.html) fail('Missing --html');
let html;
try { html = fs.readFileSync(o.html, 'utf8'); } catch (e) { fail(e.message); }

const DARK = '#0f1115';
const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
};
// White when it reaches 3:1 (large display text), otherwise near-black.
const onColor = hex => 1.05 / (lum(hex) + .05) >= 3 ? '#ffffff' : DARK;

const themeRe = /:root\{--primary:(#[0-9a-f]{6});--secondary:(#[0-9a-f]{6});--tertiary:(#[0-9a-f]{6});[^}]*\}/i;
const m = html.match(themeRe);
if (!m) fail('Theme block not found: the file must be a copy of a template in templates/');
const theme = { primary: m[1], secondary: m[2], tertiary: m[3] };
for (const k of Object.keys(theme)) {
  if (o[k] === undefined) continue;
  if (!/^#[0-9a-f]{6}$/i.test(String(o[k]))) fail(`--${k} must be #rrggbb, got: ${o[k]}`);
  theme[k] = String(o[k]).toLowerCase();
}
const on = { primary: onColor(theme.primary), secondary: onColor(theme.secondary), tertiary: onColor(theme.tertiary) };

// Each template declares which theme colors it also uses as text, and on which surface.
const surface = (html.match(/data-surface="(\w+)"/) || [])[1] || 'dark';
const textColors = ((html.match(/data-text-colors="([^"]*)"/) || [])[1] || '').split(' ').filter(Boolean);
const surfaceLum = lum(surface === 'light' ? '#fbfaf6' : '#0a0a0e');
const warnings = textColors.map(k => {
  const l = lum(theme[k]);
  const ratio = (Math.max(l, surfaceLum) + .05) / (Math.min(l, surfaceLum) + .05);
  return ratio < 3 ? `--${k} ${theme[k]} has contrast ${ratio.toFixed(1)}:1 as text on this template's ${surface} background (minimum 3:1): use a ${surface === 'light' ? 'darker' : 'lighter'} shade or another template.` : null;
}).filter(Boolean);
html = html.replace(themeRe, `:root{--primary:${theme.primary};--secondary:${theme.secondary};--tertiary:${theme.tertiary};--on-primary:${on.primary};--on-secondary:${on.secondary};--on-tertiary:${on.tertiary}}`);

let logo = 'unchanged';
const logoRe = /const LOGO="[^"]*";/;
if (o['no-logo']) { html = html.replace(logoRe, () => 'const LOGO="";'); logo = 'removed'; }
else if (o.logo) {
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }[path.extname(o.logo).toLowerCase()];
  if (!mime) fail(`Unsupported logo format: ${path.extname(o.logo)}`);
  let data;
  try { data = fs.readFileSync(o.logo); } catch (e) { fail(e.message); }
  html = html.replace(logoRe, () => `const LOGO="data:${mime};base64,${data.toString('base64')}";`);
  logo = `${path.basename(o.logo)} (${data.length} bytes)`;
}
if (typeof o.title === 'string' || typeof o.title === 'number') {
  const t = String(o.title).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${t}</title>`).replace(/(<span class="t">)[^<]*(<\/span>)/, (_, a, b) => a + t + b);
}
if (o.lang) html = html.replace(/<html lang="[^"]*"/, () => `<html lang="${String(o.lang).replace(/[^a-zA-Z-]/g, '')}"`);

fs.writeFileSync(o.html, html);
console.log(`Theme: primary ${theme.primary} · secondary ${theme.secondary} · tertiary ${theme.tertiary} · logo: ${logo}`);
warnings.forEach(w => console.log('WARNING:', w));
console.log(JSON.stringify({ ok: true, html: path.resolve(o.html), theme, on, logo, warnings }));
