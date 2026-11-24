// Theme presets for screens and overlays. No imports: loaded by components.jsx (browser) and by
// scripts/validate-edit.cjs (Node). A preset value can be a function of {primary, secondary, tertiary},
// so dark backgrounds follow the primary color when the user changes it.

const SANS = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const ARIAL = "Arial, Helvetica, sans-serif";
const SERIF = 'Georgia, "Times New Roman", serif';
const MONO = 'Consolas, "Courier New", monospace';
const HEAVY = '"Arial Black", Impact, "Segoe UI", sans-serif';
const CONDENSED = 'Impact, "Arial Narrow", "Arial Black", sans-serif';

const hex = (value) => {
  const m = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(String(value).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
export const isHexColor = (value) => hex(value) !== null;
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
// mix(a, b, t): t = 0 gives a, t = 1 gives b.
export const mix = (a, b, t) => { const x = hex(a), y = hex(b); return x && y ? toHex(x.map((v, i) => v + (y[i] - v) * t)) : a; };
export const alpha = (color, a) => { const x = hex(color); return x ? `rgba(${x.join(",")},${a})` : color; };
const luminance = (color) => {
  const x = hex(color);
  if (!x) return 0;
  const [r, g, b] = x.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// WCAG contrast ratio, 1 to 21.
export const contrast = (a, b) => { const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
// Readable text on a filled color: dark text on light fills, white on dark ones.
export const onColor = (color) => (contrast(color, "#111111") > contrast(color, "#ffffff") ? "#111111" : "#ffffff");
// First of `colors` readable as large text (3:1) on `bg`, else `fallback`. Non-hex backgrounds keep the first color.
export const readable = (colors, bg, fallback) => (!isHexColor(bg) ? colors[0] : colors.find((c) => isHexColor(c) && contrast(c, bg) >= 3) ?? fallback);
// Moves `color` toward `toward` in 10 % steps until it reads as large text (3:1) on `bg`; keeps the hue.
const legible = (color, bg, toward) => {
  if (![color, bg, toward].every(isHexColor)) return color;
  for (let i = 0; i <= 9; i++) { const c = mix(color, toward, i / 10); if (contrast(c, bg) >= 3) return c; }
  return toward;
};
// A custom primary can make a background derived from it too light for the preset's text.
// "darken" (default) darkens background, background2 and card in 10 % steps; "flip" switches the text to dark.
const keepReadable = (theme, adapt) => {
  const ok = () => contrast(theme.text, theme.background) >= 4.5 && contrast(theme.muted, theme.background) >= 3;
  if (![theme.background, theme.text, theme.muted].every(isHexColor) || ok()) return;
  if (adapt === "flip") { theme.text = theme.muted = onColor(theme.background); return; }
  const original = {background: theme.background, background2: theme.background2, card: theme.card};
  for (let i = 1; i <= 9 && !ok(); i++) for (const [key, value] of Object.entries(original)) if (isHexColor(value)) theme[key] = mix(value, "#000000", i / 10);
};

// Shared shape of every preset: colors, surfaces, type and the animated background `effect`.
// radius multiplies the base corner radius; border is a stroke width in units (1 unit = 1% of the short side);
// shadow is "none" | "soft" | "glow" | "hard"; uppercase applies to headings; surfaceText (optional) is the
// text color on panels when they are lighter than the background.
export const THEMES = {
  default: {
    label: "Night gradient", effect: "gradient",
    primary: "#3d8bff", secondary: "#ffe456", tertiary: "#22c55e",
    background: (c) => mix(c.primary, "#060b18", 0.85), background2: (c) => mix(c.primary, "#060b18", 0.6),
    card: (c) => mix(c.primary, "#060b18", 0.75), surface: "rgba(255,255,255,.07)", line: "rgba(255,255,255,.18)",
    text: "#ffffff", muted: "#b9c6dd", font: ARIAL, headingFont: ARIAL, radius: 1, border: 0, shadow: "soft", uppercase: false,
  },
  neon: {
    label: "Neon grid", effect: "grid",
    primary: "#2f7bff", secondary: "#5cd8ff", tertiary: "#a9d4ff",
    background: (c) => mix(c.primary, "#02030a", 0.93), background2: (c) => mix(c.primary, "#02030a", 0.78),
    card: (c) => mix(c.primary, "#02030a", 0.82), surface: (c) => alpha(c.primary, 0.12), line: (c) => alpha(c.secondary, 0.45),
    text: "#eaf4ff", muted: "#9fb6d9", font: SANS, headingFont: SANS, radius: 1.2, border: 0.2, shadow: "glow", uppercase: false,
  },
  aurora: {
    label: "Aurora glass", effect: "aurora",
    primary: "#7c3aed", secondary: "#06b6d4", tertiary: "#f59e0b",
    background: (c) => mix(c.primary, "#05040f", 0.9), background2: (c) => mix(c.secondary, "#05040f", 0.85),
    card: (c) => mix(c.primary, "#05040f", 0.78), surface: "rgba(255,255,255,.09)", line: "rgba(255,255,255,.22)",
    text: "#ffffff", muted: "#c4c0e0", font: SANS, headingFont: SANS, radius: 1.6, border: 0.15, shadow: "soft", uppercase: false,
  },
  editorial: {
    label: "Editorial paper", effect: "paper",
    primary: "#0f766e", secondary: "#b45309", tertiary: "#1f2937",
    background: "#f7f3ea", background2: "#efe8d8", card: "#ffffff", surface: "#ffffff", line: "rgba(31,41,55,.18)",
    text: "#1f2937", muted: "#5b6472", font: SANS, headingFont: SERIF, radius: 0.4, border: 0.15, shadow: "none", uppercase: false,
  },
  bold: {
    label: "Bold blocks", effect: "blocks",
    primary: "#6d28d9", secondary: "#f43f5e", tertiary: "#fbbf24",
    background: "#0a0a0a", background2: "#141414", card: "#161616", surface: "#1c1c1c", line: "rgba(255,255,255,.14)",
    text: "#ffffff", muted: "#a3a3a3", font: SANS, headingFont: HEAVY, radius: 0, border: 0, shadow: "none", uppercase: true,
  },
  terminal: {
    label: "Terminal CRT", effect: "scanlines",
    primary: "#22c55e", secondary: "#f59e0b", tertiary: "#38bdf8",
    background: (c) => mix(c.primary, "#020403", 0.94), background2: (c) => mix(c.primary, "#020403", 0.86),
    card: (c) => mix(c.primary, "#020403", 0.88), surface: (c) => alpha(c.primary, 0.08), line: (c) => alpha(c.primary, 0.45),
    text: "#d7fbe3", muted: "#7fb894", font: MONO, headingFont: MONO, radius: 0.2, border: 0.2, shadow: "glow", uppercase: false,
  },
  cinematic: {
    label: "Cinematic spotlight", effect: "spotlight",
    primary: "#b91c1c", secondary: "#e9c46a", tertiary: "#94a3b8",
    background: "#050505", background2: "#121212", card: "#141414", surface: "rgba(255,255,255,.05)", line: "rgba(233,196,106,.35)",
    text: "#f5f1e8", muted: "#a8a29e", font: SANS, headingFont: SERIF, radius: 0.3, border: 0, shadow: "soft", uppercase: false,
  },
  blueprint: {
    label: "Blueprint schematic", effect: "blueprint",
    primary: "#1d4ed8", secondary: "#fbbf24", tertiary: "#93c5fd",
    background: (c) => mix(c.primary, "#03122e", 0.55), background2: (c) => mix(c.primary, "#03122e", 0.35),
    card: (c) => mix(c.primary, "#03122e", 0.6), surface: (c) => alpha(c.tertiary, 0.08), line: (c) => alpha(c.tertiary, 0.6),
    text: "#eef5ff", muted: "#a9c4ec", font: SANS, headingFont: MONO, radius: 0, border: 0.2, shadow: "none", uppercase: true,
  },
  pastel: {
    label: "Friendly pastel", effect: "blobs",
    primary: "#4f46e5", secondary: "#ea580c", tertiary: "#14b8a6",
    background: "#fff7ed", background2: (c) => mix(c.primary, "#fff7ed", 0.9), card: "#ffffff", surface: "#ffffff", line: (c) => alpha(c.primary, 0.18),
    text: "#1e1b4b", muted: "#5b5f86", font: SANS, headingFont: SANS, radius: 2.2, border: 0, shadow: "soft", uppercase: false,
  },
  brutalist: {
    label: "Neo-brutalist", effect: "stickers",
    primary: "#f2441d", secondary: "#2f5bff", tertiary: "#c6f432",
    background: "#fff4e0", background2: "#ffeccb", card: "#ffffff", surface: "#ffffff", line: "#111111",
    text: "#111111", muted: "#3f3f3f", font: SANS, headingFont: HEAVY, radius: 0.6, border: 0.6, shadow: "hard", uppercase: false,
  },
  luxe: {
    label: "Executive luxe", effect: "frame",
    primary: "#0f4c3a", secondary: "#c9a227", tertiary: "#e8dcc4",
    background: (c) => mix(c.primary, "#020806", 0.45), background2: (c) => mix(c.primary, "#020806", 0.2),
    card: (c) => mix(c.primary, "#020806", 0.35), surface: "rgba(255,255,255,.05)", line: (c) => alpha(c.secondary, 0.55),
    text: "#f6f0e1", muted: "#cbbf9f", font: SANS, headingFont: SERIF, radius: 0.2, border: 0.12, shadow: "none", uppercase: false,
  },
  hud: {
    label: "Sci-fi HUD", effect: "hud",
    primary: "#ff9f1c", secondary: "#2ee6d6", tertiary: "#ff4d6d",
    background: "#07090d", background2: "#0e131b", card: "#0e131b", surface: (c) => alpha(c.secondary, 0.07), line: (c) => alpha(c.primary, 0.6),
    text: "#f1f5f9", muted: "#93a4b8", font: SANS, headingFont: MONO, radius: 0, border: 0.2, shadow: "none", uppercase: true,
  },
  comic: {
    label: "Pop comic", effect: "halftone", adapt: "flip",
    primary: "#2563eb", secondary: "#facc15", tertiary: "#ef4444",
    background: (c) => c.primary, background2: (c) => mix(c.primary, "#000000", 0.25), card: "#ffffff", surface: "#ffffff", surfaceText: "#111111", line: "#111111",
    text: "#ffffff", muted: "#ffffff", font: SANS, headingFont: CONDENSED, radius: 0.8, border: 0.6, shadow: "hard", uppercase: true,
  },
  mono: {
    label: "Midnight mono", effect: "beam",
    primary: "#6e56cf", secondary: "#3ecf8e", tertiary: "#f5a524",
    background: "#000000", background2: "#0a0a0a", card: "#0d0d0d", surface: "rgba(255,255,255,.04)", line: "rgba(255,255,255,.12)",
    text: "#fafafa", muted: "#8f8f8f", font: SANS, headingFont: SANS, radius: 1.2, border: 0.12, shadow: "glow", uppercase: false,
  },
};
export const THEME_NAMES = Object.keys(THEMES);
export const EFFECTS = ["gradient", "grid", "aurora", "paper", "blocks", "scanlines", "spotlight", "blueprint", "blobs", "stickers", "frame", "hud", "halftone", "beam", "none"];

// Resolves {preset, primary, secondary, tertiary, ...overrides} into a full theme.
// `accent` and `highlight` (older plans) are aliases of primary and secondary.
export const resolveTheme = (input = {}) => {
  const name = input.preset ?? "default";
  const preset = THEMES[name];
  if (!preset) throw new Error(`Unknown theme preset "${name}". Available: ${THEME_NAMES.join(", ")}`);
  const colors = {
    primary: input.primary ?? input.accent ?? preset.primary,
    secondary: input.secondary ?? input.highlight ?? preset.secondary,
    tertiary: input.tertiary ?? preset.tertiary,
  };
  const base = {};
  for (const [key, value] of Object.entries(preset)) base[key] = typeof value === "function" ? value(colors) : value;
  const theme = {...base, ...input, ...colors, preset: name};
  theme.accent = input.accent ?? colors.primary;
  theme.highlight = input.highlight ?? colors.secondary;
  theme.onPrimary = input.onPrimary ?? onColor(colors.primary);
  theme.onSecondary = input.onSecondary ?? onColor(colors.secondary);
  // Explicit background or text colors are respected; the validator warns if they are hard to read.
  if (input.background === undefined && input.text === undefined) keepReadable(theme, preset.adapt);
  // Accent used as text on the screen background (kickers, numbers): primary, or the next readable color.
  theme.accentText = input.accentText ?? readable([theme.accent, colors.secondary, colors.tertiary], theme.background, theme.text);
  // Highlight used as text on the screen background (figures, marked words). Captions keep `highlight`.
  theme.highlightText = input.highlightText ?? legible(theme.highlight, theme.background, theme.text);
  theme.headingFont = input.headingFont ?? (input.font && !input.headingFont && base.headingFont === base.font ? input.font : base.headingFont);
  if (!EFFECTS.includes(theme.effect)) throw new Error(`Unknown theme effect "${theme.effect}". Available: ${EFFECTS.join(", ")}`);
  return theme;
};
