# Theme presets

Themes live in `src/themes.mjs`. A theme styles every screen (and the accent of overlays and captions) and works in vertical and horizontal video: every effect is sized from the short side of the frame or in percentages.

```js
theme: {preset: "neon", primary: "#e11d48", secondary: "#facc15", tertiary: "#38bdf8"},
```

Set it once in `edit.js`; an item can override it with its own `theme` (for example one `breaking` screen in `hud`). Only `preset` and the three colors are usually needed.

## What each color drives

| Variable | Drives |
|---|---|
| `primary` (alias `accent`) | kickers, chapter numbers, list icons, timeline line and dots, panel glows, the main background tint in derived presets |
| `secondary` (alias `highlight`) | big figures (`stat`, `split`), highlighted words (`kinetic`), the active caption word, the VS circle, the chapter bar |
| `tertiary` | the left `compare` panel, and the third color of the effect (aurora cloud, bold block, blueprint grid and stamp, spotlight cone, brutalist sticker, beam) |

Readability is automatic. Text on a filled color uses `onPrimary` / `onSecondary` (dark or white). Accent text falls back to the next color that reaches 3:1 on the background (`accentText`), and figures are darkened or lightened toward the text color until they reach 3:1 (`highlightText`). If a light custom primary makes a derived background too light, the background darkens in 10 % steps (`comic` switches the text to dark instead). An explicit `background` or `text` is never changed; the validator warns below 4.5:1.

**Other overrides** (rarely needed): `background`, `background2` (gradient end), `card`, `surface` (list and compare panels), `surfaceText`, `line`, `text`, `muted`, `font`, `headingFont`, `quoteFont`, `radius` (corner multiplier), `border` (stroke in units of 1 % of the short side), `shadow` (`none` / `soft` / `glow` / `hard`), `uppercase` (headings), `effect` (any effect name, or `none` for a calm card).

## Presets

"Derived" means the background is mixed from `primary`, so changing `primary` re-tints the whole screen; "fixed" backgrounds keep their color and only accents change.

| `preset` | Look | Effect (motion) | Background | Good for |
|---|---|---|---|---|
| `default` — Night gradient | Navy gradient, soft shadows, Arial | `gradient`: glow from the top | derived | generic tech news, tutorials, anything without a strong mood |
| `neon` — Neon grid | Near-black blue, thin glowing borders | `grid`: perspective floor scrolling toward the viewer, floating particles | derived | AI, launches, gaming, futuristic tech |
| `aurora` — Aurora glass | Dark violet, glass panels, rounded | `aurora`: three color clouds drifting slowly | derived | AI and creative tools, product vision, inspirational |
| `editorial` — Editorial paper | Cream paper, serif headings, no shadows | `paper`: ruled lines and double rules that draw in | fixed (light) | analysis, essays, history, economics explained, opinion |
| `bold` — Bold blocks | Black, heavy uppercase type, sharp corners | `blocks`: color blocks slide in from the corners | fixed | hot takes, top-N lists, marketing, high-energy Shorts |
| `terminal` — Terminal CRT | Green on black, monospace, glow | `scanlines`: moving scan band, flicker, vignette | derived | programming, CLI, DevOps, security |
| `cinematic` — Cinematic spotlight | Black, serif headings, gold lines | `spotlight`: drifting light cone and letterbox bars | fixed | storytelling, documentaries, quotes, dramatic reveals |
| `blueprint` — Blueprint schematic | Blueprint blue grid, mono uppercase headings | `blueprint`: grid, dashed line drawing in, "REV A" stamp | derived | engineering, hardware, architecture, "how it works" |
| `pastel` — Friendly pastel | Cream, soft blobs, very round cards | `blobs`: four soft circles floating | fixed (light) | education, beginners, lifestyle, wellness, kids |
| `brutalist` — Neo-brutalist | Cream, thick black borders, hard offset shadows | `stickers`: dot grid and two stickers popping in | fixed (light) | startups, design, indie makers, humor |
| `luxe` — Executive luxe | Deep green, gold double frame, serif | `frame`: framed border with diamond corners and a light sheen sweep | derived | finance, business, premium products, legal, real estate |
| `hud` — Sci-fi HUD | Dark, mono uppercase, corner brackets | `hud`: rotating radar sweep, crosshair, blinking REC | fixed | space, defense, data monitoring, cybersecurity, gaming |
| `comic` — Pop comic | Solid primary background, condensed uppercase, white panels with black borders | `halftone`: rotating sunburst and halftone dots | derived (= primary) | entertainment, reactions, pop culture, fun explainers |
| `mono` — Midnight mono | Pure black, minimal, subtle glow | `beam`: dot grid, top glow, two light beams sliding | fixed | SaaS and developer tools, product demos, keynote style |

What to change per preset:

- **Derived** (`default`, `neon`, `aurora`, `terminal`, `blueprint`, `luxe`, `comic`): set `primary` to the brand color; the background follows. Use `secondary` for figures and the caption highlight, `tertiary` for the third element.
- **Fixed dark** (`bold`, `cinematic`, `hud`, `mono`): the three colors only change accents, blocks, beams and lines; set `background` only when the brand needs a different base.
- **Fixed light** (`editorial`, `pastel`, `brutalist`): pick medium or dark brand colors; very light ones are darkened toward the text automatically when used as text.

## Choosing a preset

1. **Preference first.** Look for a saved theme preference (memory, earlier messages, a previous `edit.js` of the same channel). If there is one, use it without asking.
2. **Otherwise suggest by topic.** Match the subject of the transcript to the "Good for" column and propose 2–3 presets with one line each on why, plus brand colors if the user, channel or company has them. Examples: a coding tutorial → `terminal`, `mono`, `neon`; a finance explainer → `luxe`, `editorial`; a kids' science short → `pastel`, `comic`; breaking AI news → `neon`, `hud`, `bold`.
3. **Show, then let the user decide.** Render the contact sheet (below) and show the image with the suggestions. With custom colors, render the sheet with them so the user sees their brand in every preset.
4. **Remember the choice.** After the user picks, save the preset and colors as a preference (memory), so the next video skips the question.

## Showing the styles to the user

**Contact sheet (one image, all presets).** From the project folder. A still normally copies all of `public/` (476 MB with the source video in the test project); the sheet needs no media, so point it at a copy of `public/` without media files. Keep the other files: a `fontFile` font is loaded on start, and an empty folder fails with `NetworkError`.

```powershell
robocopy public "<WORK_DIR>/sheet-public" /E /XF *.mp4 *.mov *.mkv *.webm *.wav *.m4a *.mp3 /NFL /NDL /NJH /NJS
npx.cmd remotion still src/index.jsx ThemeSheet "<WORK_DIR>/theme-sheet.png" --public-dir="<WORK_DIR>/sheet-public"
npx.cmd remotion still src/index.jsx ThemeSheetVertical "<WORK_DIR>/theme-sheet-vertical.png" --public-dir="<WORK_DIR>/sheet-public"
```

Each still took about 8.5 s here, bundling included. Render the orientation of the video being edited (or both). Each tile is a full preview scaled down: kicker, heading, a figure, two panels and the three colors with their hex values. With brand colors, add `--props="{\"overrides\":{\"primary\":\"#e11d48\",\"secondary\":\"#facc15\"}}"`; `--props="{\"themes\":[\"neon\",\"luxe\",\"mono\"]}"` limits the sheet to the suggested presets. Show the PNG to the user (attach it or open it in the integrated browser).

**Animated tour.** `http://localhost:3333/Themes` in Studio plays each preset full frame for 3 s at the project size, so the user can see the motion of each effect. The `Gallery` compositions then show every component in the chosen theme.

## Verified

- Every preset with default colors: text 5.2–20.1:1 and figures 3.4–13.0:1 on the background (WCAG; 4.5 for text, 3 for large text).
- All 11 screen types × 14 presets were rendered together in Studio at 1920×1080 and 1080×1920: no text outside the frame and no text below 3:1 against its nearest solid background (648 text elements measured in the horizontal sheet). The same check passed in both orientations with an extreme custom combination (`#ffe456` / `#3d8bff` / `#ef4444`); before the automatic adjustments, that combination left unreadable text in `editorial`, `blueprint`, `luxe` and `comic` (down to 1.19:1).
- `node --test skills/video-editor/tests/video-editor.test.cjs` covers every preset with default, light and dark custom colors, the aliases and the errors for unknown presets and effects.
