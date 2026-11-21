// Shared runtime for full-frame screens. Load it AFTER overlay.js.
// Adds what screens need on top of the overlay settings: an opaque background that follows the
// theme, the orientation class, the background pattern and small helpers for the screen scripts.
(() => {
  const { params, icon } = window.OVERLAY;
  const css = document.documentElement.style;
  const light = params.theme === 'light';
  // A screen must never be transparent: it replaces the footage. "bg" still wins when it is set.
  if (!params.bg) css.setProperty('--bg', light ? '#f3f4f8' : '#0b0e15');
  css.setProperty('--panel', params.panel || (light ? 'rgba(16,19,28,.06)' : 'rgba(255,255,255,.07)'));
  if (params.safe_bottom !== undefined) css.setProperty('--safe-bottom', params.safe_bottom);

  const landscape = innerWidth > innerHeight;
  document.body.classList.add(landscape ? 'landscape' : 'portrait', 'p-' + (params.pattern || 'glow'));

  // Element with text set through textContent, so a param can never inject markup.
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };
  // Appearance time of item i: its own "at" (seconds after the screen opens) or a stagger.
  const at = (item, i, first = 0.5, step = 0.35) => (item && item.at !== undefined ? +item.at : first + i * step);
  const fmt = (value, decimals) => new Intl.NumberFormat(params.locale || 'es-AR',
    { minimumFractionDigits: +decimals || 0, maximumFractionDigits: +decimals || 0 }).format(value);

  window.SCREEN = { params, icon, landscape, el, at, fmt };
})();
