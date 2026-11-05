---
name: motion-presentations
description: Builds animated, self-contained HTML presentations from premade templates with configurable primary, secondary and tertiary colors, and optionally renders them to MP4. Use when a user wants a presentation, slide deck, explainer or video from a script, transcript or topic, especially to explain AI and technology in everyday language or to match a company's brand.
---

# Motion Presentations

Pick one premade template, recolor it, replace its slides and deliver one HTML file that runs offline. Every template shares one engine, so the controls never change.

## Use this skill when

- The user wants a presentation or video from a script, transcript, notes or topic.
- The deck must match a theme, a logo or a company's colors.
- A single offline HTML file is preferable to a PowerPoint file or a hosted tool.

Do not use it for editable `.pptx` files or for decks the user will edit in an office suite.

## Requirements

| Task | Needs |
|---|---|
| Edit and present the HTML | A current browser (`color-mix()` support) |
| `start_browser.js`, `check.js`, `close_browser.js`, `extract_palette.js`, `apply_brand.js`, `render.js` | Node 22+ |
| `start_browser.js`, `check.js`, `extract_palette.js`, `render.js` | Edge or Chrome |
| `render.js`, `qc_video.js` | ffmpeg and ffprobe on `PATH` |

No application npm packages. The browser-control scripts use Node's native `WebSocket` and `fetch`.

### Node 20 vs Node 22 troubleshooting

Check the runtime before starting the browser:

```bash
node --version
node -p "'WebSocket=' + typeof WebSocket + ' fetch=' + typeof fetch"
```

The browser-control scripts require **Node 22 or newer**. A sandbox may default to Node 20; for example, Node 20.19.3 has `fetch` but no global `WebSocket`, so scripts that load `scripts/lib.js` stop with `Node 22+ is required (native WebSocket and fetch). Found v20.19.3.` This is a Node runtime mismatch, not a presentation, animation or browser failure. `verify_engine.js` is a static file check and does not load `lib.js`, so its success does not confirm the runtime is suitable for `check.js` or rendering.

When `node --version` is below 22 or `WebSocket` is `undefined`, use an available Node 22+ binary. If `npx` and network access are available, `npx --yes node@22` provides a one-off Node 22 runner without adding an application dependency:

```bash
npx --yes node@22 --version
npx --yes node@22 scripts/start_browser.js
npx --yes node@22 scripts/check.js --html <output>/deck.html --sec 8
npx --yes node@22 scripts/close_browser.js
```

Use the same Node 22 runner for `apply_brand.js`, `extract_palette.js` and `render.js`. If `npx` is unavailable or the network is blocked, invoke an already-installed Node 22+ executable (or activate it through the environment's version manager) and recheck that `WebSocket` is defined. Do not edit the runtime guard or polyfill `WebSocket` to hide this mismatch.

If the runtime check passes but `start_browser.js` says no browser answered, that is a separate browser-discovery/launch issue: pass the actual executable with `--browser <path>` and confirm the debugging endpoint on the selected port (default `9333`) responds before running `check.js`.

## Templates

| File | Look | Best for | Slides | Default primary / secondary / tertiary |
|---|---|---|---|---|
| `templates/neon-tech.html` | Dark, glowing glass cards, particles, perspective grid | AI, technology, engineering, benchmarks, tutorials | 29 | `#2f7bff` / `#5cd8ff` / `#a9d4ff` |
| `templates/editorial-light.html` | Light paper, serif headlines, charts and tables | Business, education, reports, case studies, public sector | 15 | `#0f766e` / `#d97706` / `#1f2937` |
| `templates/bold-blocks.html` | Black canvas, solid color blocks, heavy uppercase type | Product launches, marketing, startups, pitches | 13 | `#6d28d9` / `#f43f5e` / `#fbbf24` |
| `templates/terminal-retro.html` | CRT console, monospace type, logs, diffs and code windows | Developers, cybersecurity, automation, how-things-work | 13 | `#22c55e` / `#f59e0b` / `#38bdf8` |
| `templates/friendly-pastel.html` | Warm light background, rounded cards, mascot, chat bubbles, quiz | Beginners, education, everyday explainers, onboarding | 13 | `#4f46e5` / `#f97316` / `#14b8a6` |
| `templates/cinematic-keynote.html` | Black letterbox, slow spotlight, large serif type, few words per slide | Keynotes, opinion pieces, narrated stories, vision talks | 13 | `#b91c1c` / `#e9c46a` / `#94a3b8` |

Choose by audience and tone, then tell the user which template you chose and why, in one line. If the request does not point to one, use `neon-tech` for technical topics and `editorial-light` for everything else. Slide text in the templates is sample content; its numbers are illustrative.

## Controls

The engine provides these controls in every template. Never remove or change them.

| Input | Action |
|---|---|
| On-screen ◀ ▶ buttons | Previous / next (disabled on the first / last slide) |
| `→`, `PageDown`, `Space`, `Enter` | Next |
| `←`, `PageUp`, `Backspace` | Previous |
| Click on the right 75% / left 25% of the screen | Next / previous |
| `Home`, `End` | First / last slide |
| `F` | Fullscreen |
| `H` | Hide or show the interface (logo, counter, progress, buttons) |
| `R` | Replay the current slide |
| `#N` in the URL | Open slide N |

## Workflow

### 1. Gather

Read the full script or brief. Ask the user only for what is missing:

- **Language** of the slides and whether a video is needed.
- **Brand:** ask whether they have a logo, brand colors, a style guide or a website. Any of these sets the theme. If they have nothing, choose a palette that suits the topic and say so.

### 2. Set the colors

Priority: colors the user states, then an official brand guide or website, then the logo, then the template defaults.

To extract them from a logo or brand image:

```bash
node scripts/start_browser.js
node scripts/extract_palette.js --image <logo.png>
```

The script prints a suggested primary, secondary and tertiary plus candidates with their share of the image. It ignores white, black and gray pixels, and reports `derived` when the image has fewer than three colors and it had to generate shades. Show the palette to the user when the choice is not obvious: the largest color is not always the brand's main color.

| Variable | Role |
|---|---|
| `--primary` | Main surfaces and fills; also tints the background |
| `--secondary` | Accent: highlights, progress bar, winning option |
| `--tertiary` | Support: soft text, tertiary blocks and rules |

### 3. Storyboard

Apply [data-storytelling](https://www.skills.sh/wshobson/agents/data-storytelling) before building. Write the slide list first:

- **Arc:** hook → context → tension → resolution → call to action.
- **One idea per slide.** The title is the conclusion, not the topic: "Invoices gave back half of the time", not "Invoices".
- **Every number has a comparison:** versus before, a rival or a reference. One large number per slide.
- **Highlight only what matters:** one accent word, one winning card, the rest muted.
- **Everyday language:** explain jargon with an analogy. "Experts called in depending on the question" instead of "sparse activation".
- **Honest data:** use only figures from the source. When the source gives no exact value, use proportional bars and a visible "approximate values" note. Never invent a number.
- **Numbered sections** with a section slide, and an agenda near the start.
- **Correction slide** when the speaker misspoke on camera: use the exact text the user gives, and show wrong → right (each template includes one).

### 4. Build

Copy the template into the working directory; never edit `templates/`. Then apply the brand:

```bash
cp templates/neon-tech.html <output>/deck.html
node scripts/apply_brand.js --html <output>/deck.html \
  --primary "#c2410c" --secondary "#fdba74" --tertiary "#fed7aa" \
  --logo <logo.png> --title "Deck title" --lang es
```

Use `--no-logo` when there is no logo. Without either flag, the deck shows a neutral placeholder mark. `--lang` also sets the number format. Fix any `WARNING` the script prints: it flags colors that would be unreadable as text on that template.

Then replace the slides:

| Block | May you edit it? |
|---|---|
| `SLIDES:BEGIN` … `SLIDES:END` | Yes: this is your content |
| `#chrome` text (`.hint`) | Translate only |
| `DESIGN-CSS` | Yes, to add a component. Use theme variables, never literal colors |
| `DESIGN-JS` (`neon-tech` only) | Yes, to adapt the diagrams or their labels |
| `THEME` and `BRAND` | Through `apply_brand.js` |
| `ENGINE-CSS`, `ENGINE-JS` | **No, never** |

Reuse the components already in the chosen template: open a sample slide with the layout you need, copy it and change its text. Remove the "sample data" labels, and keep slide text within the safe area (see below).

**Slide attributes**

| Markup | Effect |
|---|---|
| `<section class="slide" data-sec="01 · Name">` | Slide; `data-sec` appears in the header |
| `class="slide section"` | Plays the section wipe on entry |
| `class="r"` + `style="--d:.4s"` | Rises in after the delay |
| `r l`, `r rt`, `r dn`, `r s`, `r b`, `r w` | From left, right, top; pop; blur-in; wipe |
| `class="split"` (`--sd` delay) | Title animated letter by letter |
| `<span data-count="4.5" data-dec="1" data-prefix="$" data-delay=".5" data-dur="1.6">` | Animated counter |
| `<span data-type="text" data-speed="70" data-delay=".5">` | Typewriter text |
| `id="race"` with `.lane[data-secs]` (`.fast`) | Timed race bars (styled in `neon-tech`) |
| `class="logo-img"` on an `<img>` | Filled with the logo |

**Slide-specific components**

| Template | Components |
|---|---|
| `neon-tech` | `.hero`, `.vs`, `.rivals`, `.agenda`, `.models`, `.notice`, `.net` (expert diagram), `.versus`, `.bench`, `.specs`, `.chart`, `.search`, `.term`, `.memmap` (memory diagram), `.statline`, `.flow`, `.effort`, `.lane`, `.gauges`, `.outro` |
| `editorial-light` | `.cover`, `.toc`, `.statement`, `.compare`, `.ba`, `.hbars`, `.timeline`, `.pillars`, `.process`, `.table`, `.notice`, `.closing` |
| `bold-blocks` | `.cover`, `.tile` (`.b1` `.b2` `.b3`), `.g3`, `.g4`, `.panel`, `.donutwrap`, `.cols`, `.split2`, `.quote`, `.ticker`, `.notice`, `.outro` |
| `terminal-retro` | `.win`, `.ls`, `.ln` (log lines), `.diff`, `.split-num`, `.meter`, `.code`, `.ps` (table), `.badge`, `.todo`, `.closing` |
| `friendly-pastel` | `.cover`, `.bot` (mascot), `.road`, `.big-blob`, `.chat`, `.trio`, `.compare`, `.rb`, `.steps`, `.dd`, `.sticky`, `.opts` (quiz), `.outro` |
| `cinematic-keynote` | `.center`, `.rule`, `.chapters`, `.statement`, `.huge`, `.vsline`, `.thennow`, `.miles`, `.quote`, `.notice`, `.triad`, `.outro` |

Removing a `neon-tech` diagram slide is safe: its script skips missing elements. Timers in new code must use `setTimeout`, `setInterval`, `requestAnimationFrame` or `performance.now`, so the video render can control them; do not use Web Workers or `<video>`.

### 5. Verify

```bash
node scripts/verify_engine.js <output>/deck.html
node scripts/check.js --html <output>/deck.html --sec 15
```

| Script | Fails (exit 2) when |
|---|---|
| `verify_engine.js` | The engine differs from the templates, or a required element is missing |
| `check.js` | An animated element stays invisible, an element leaves the stage, text enters the header or footer area (safe area: y 100–958 on the 1920×1080 stage), or a JS error occurs |

`--sec` is the time on each slide. `check.js` measures each slide at the end of that time, so a slow animation fails with a short value. Then open the file and step through it with the buttons.

`check.js` cannot judge looks. Tell the user what to review by eye: overall appearance, text contrast with the chosen colors and logo legibility.

### 6. Render a video (only if requested)

```bash
node scripts/start_browser.js
node scripts/check.js  --html deck.html --sec 15
node scripts/render.js --html deck.html --out deck.mp4 --sec 15 > render.log 2>&1
node scripts/qc_video.js deck.mp4
node scripts/close_browser.js
```

| `render.js` flag | Default | Meaning |
|---|---|---|
| `--sec` | 15 | Seconds per slide |
| `--w`, `--h` | 2560, 1440 | Resolution |
| `--fps` | 30 | Frame rate |
| `--crf` | 17 | x264 quality (lower is better and larger) |
| `--clean` | off | Hides logo, counter and progress bar |
| `--frames N` | all | Stops after N frames, for test runs |
| `--port` | 9333 | Browser debugging port |

The ◀ ▶ buttons are hidden in every render; the rest of the interface stays unless you pass `--clean`. Slide changes happen at exactly `fps × sec` frames.

The render replaces timers, `requestAnimationFrame`, `performance.now`, `Date.now`, `Math.random` and CSS animation time with a virtual clock and captures each frame, so results are reproducible and no frame is dropped. Run it in the background with a log, because it can outlast a foreground command limit.

`qc_video.js` must report the expected resolution, `frames = slides × fps × sec`, `yuv420p`, `range=tv`, and no black or frozen stretches. A slide with no motion for over 4 s is reported as frozen: check whether that is expected before re-rendering.

### 7. Deliver

Give the HTML or MP4 path, the template chosen, the final palette, a table of slides, what was verified and what the user must review by eye (including any approximate data).

## Limitations

- Use one render per browser instance: background tabs in the same headless browser are throttled and stall.
- `start_browser.js` was tested on Windows with Edge. The macOS and Linux paths and Chrome are untested; pass `--browser <path>` if detection fails.
- Close the browser only with `close_browser.js`. Killing the process by name would also close the user's own windows.
- Some sandboxes block URLs or regular expressions in command lines; keep that logic inside `.js` files.
- `apply_brand.js` checks contrast only for colors used directly as text on the template background. It does not check every combination.
- Video has no audio; add narration in an editor.
- Fonts are system fonts (Segoe UI, Georgia, Cascadia Code, with fallbacks), so the look varies slightly by operating system. Embedded fonts are not included.

## Outputs and privacy

Write decks and videos outside the skill folder, such as `presentation-output/`, which is git-ignored along with `*.mp4` and the browser profile in `.cache/`. Never commit a user's logo, deck or script. Logos are embedded in the output HTML as base64, so that file carries the logo wherever it goes.

## Quick test

```bash
node scripts/verify_engine.js
node scripts/start_browser.js
node scripts/check.js --html templates/editorial-light.html --sec 8
node scripts/close_browser.js
```

Expected: `ok` for all six templates and `OK: 15 slides with no problems`.

## Measured runs

One run on Windows with Edge headless and ffmpeg 8.1:

| Input | Output | Time |
|---|---|---|
| `bold-blocks`, rebranded with a generated test logo, 13 slides × 3 s, 2560×1440 at 30 fps, `--crf 17` | 1170 frames, 39 s of video, 7.5 MB | 65.6 s (17.8 capture fps) |
| `friendly-pastel`, default colors, same settings | 1170 frames, 39 s of video, 7.5 MB | 69.3 s (16.9 capture fps) |

Capture speed and file size depend on the machine and on the template's effects. Run `--frames 300` first to estimate a long render.

| Template | `check.js --sec` that passes | Note |
|---|---|---|
| `neon-tech` | 8 | Fails at 2 s: its entrance delays reach 2.9 s and the race note appears at 6 s |
| `editorial-light` | 3 | |
| `bold-blocks` | 3 | |
| `terminal-retro` | 5 | Fails at 3 s: the last log line starts at 2.7 s |
| `friendly-pastel` | 5 | Fails at 3 s: the quiz answer appears at 3 s |
| `cinematic-keynote` | 3 | |
