// Shared runtime for video-editor components.
// Params arrive as URL-encoded JSON in the hash: callout.html#{"title":"...","dur":4}
// Sizes use vmin, so the same component renders at 720x1280 or 3840x2160 without edits.
(() => {
  const ICONS = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    alert: '<path d="M12 3.5l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5v.5"/>',
    chat: '<path d="M4 5h16v11H10l-6 4.5z"/>',
    chart: '<path d="M4 20V11M10 20V5M16 20v-6M2 20h20"/>',
    shield: '<path d="M12 3l8 3v6c0 4.8-3.4 7.9-8 9-4.6-1.1-8-4.2-8-9V6z"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.8a3.3 3.3 0 010 6.4M18.5 14.8c1.6.9 2.6 2.6 3 5.2"/>',
    briefcase: '<rect x="3" y="7.5" width="18" height="12.5" rx="2"/><path d="M8.5 7.5V5h7v2.5M3 13h18"/>',
    vote: '<path d="M4 13h16v7H4z"/><path d="M8 13l2.5-8h6L19 13M10 9.5h6"/>',
    flag: '<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
  };
  const icon = (name) => ICONS[name]
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
    : '';

  let params = {};
  try {
    params = JSON.parse(decodeURIComponent(location.hash.slice(1) || '{}'));
  } catch (e) {
    console.error('Invalid component params: ' + e.message);
  }

  const css = document.documentElement.style;
  css.setProperty('--dur', (+params.dur || 4) + 's');
  // Theme first, then single colors, so {"theme": "light", "accent": "#e11d48"} works as expected.
  const THEMES = {
    dark: { ink: '#ffffff', muted: 'rgba(255,255,255,.78)', card: 'rgba(10,12,18,.86)' },
    light: { ink: '#10131c', muted: 'rgba(16,19,28,.7)', card: 'rgba(255,255,255,.94)' },
    glass: { ink: '#ffffff', muted: 'rgba(255,255,255,.85)', card: 'rgba(255,255,255,.16)' },
  };
  for (const [key, value] of Object.entries(THEMES[params.theme] || {})) css.setProperty('--' + key, value);
  for (const key of ['accent', 'ink', 'muted', 'card', 'bg', 'font']) if (params[key]) css.setProperty('--' + key, params[key]);
  // Position and size as shares of the frame (0-1), so one plan works at any resolution.
  for (const key of ['top', 'x', 'y', 'w']) if (params[key] !== undefined) css.setProperty('--' + key, params[key]);
  for (const [key, value] of Object.entries(params.vars || {})) css.setProperty('--' + key, value);

  // Text slots: a missing param removes the element, so optional lines leave no gap.
  document.querySelectorAll('[data-p]').forEach((el) => {
    const value = params[el.dataset.p];
    if (value === undefined || value === null || value === '') el.remove();
    else el.textContent = value;
  });
  document.querySelectorAll('[data-icon]').forEach((el) => {
    const svg = icon(params[el.dataset.icon]);
    if (svg) el.innerHTML = svg; else el.remove();
  });
  document.querySelectorAll('img[data-src]').forEach((el) => {
    const value = params[el.dataset.src];
    if (value) el.src = value; else console.error(`Missing image param "${el.dataset.src}"`);
  });

  window.OVERLAY = { params, icon };
})();
