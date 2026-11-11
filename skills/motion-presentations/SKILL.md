---
name: motion-presentations
description: Builds animated, self-contained HTML presentations from premade templates with configurable primary, secondary and tertiary colors, and optionally renders them to MP4 or exports them to PDF and PPTX. Use when a user wants a presentation, slide deck, explainer or video from a script, transcript or topic, especially to explain AI and technology in everyday language or to match a company's brand, or when they ask to download the deck as PDF or PowerPoint.
---

# Motion Presentations

Pick one premade template, recolor it, replace its slides and deliver one HTML file that runs offline. Every template shares one engine, so the controls never change.

## Use this skill when

- The user wants a presentation or video from a script, transcript, notes or topic.
- The deck must match a theme, a logo or a company's colors.
- A single offline HTML file is preferable to a PowerPoint file or a hosted tool.

Do not use it for editable `.pptx` files or for decks the user will edit in an office suite. The PDF and PPTX export below is a visual capture, not an editable-by-text deck: state that when delivering.

## Requirements

| Task | Needs |
|---|---|
| Edit and present the HTML | A current browser (`color-mix()` support) |
| `start_browser.js`, `check.js`, `close_browser.js`, `extract_palette.js`, `apply_brand.js`, `render.js` | Node 22+ |
| `start_browser.js`, `check.js`, `extract_palette.js`, `render.js` | Edge or Chrome |
| `render.js`, `qc_video.js` | ffmpeg and ffprobe on `PATH` |
| `export_slides.mjs` | Chrome (`/usr/bin/google-chrome`) + `puppeteer-core`, Node 18+; `puppeteer-core` is bootstrapped on every run |
| `export_pack.py` | `pillow`, `img2pdf`, `python-pptx`; bootstrapped on every run, global pip needs the venv (PEP 668) |

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
| `templates/blueprint-schematic.html` | Engineering drawing: grid, line art, annotated diagrams, title blocks | How something works, architecture, processes, products | 13 | `#1d4ed8` / `#fbbf24` / `#93c5fd` |
| `templates/newspaper-front.html` | Broadsheet: masthead, columns, pull quotes, classifieds | News, case studies, announcements, community stories | 13 | `#991b1b` / `#1f2937` / `#b45309` |
| `templates/data-dashboard.html` | App-style dark panels: KPIs, charts, heatmap, funnel, kanban | Metric reviews, quarterly reports, data-heavy talks | 14 | `#6366f1` / `#22d3ee` / `#f472b6` |
| `templates/pop-comic.html` | Comic book: panels, speech bubbles, bursts, trading cards | Young audiences, social media, playful explainers | 12 | `#2563eb` / `#facc15` / `#ef4444` |
| `templates/consulting-boardroom.html` | Consulting report: white pages, action titles, structured charts | Board meetings, strategy, business cases, recommendations | 11 | `#0b2e59` / `#00857c` / `#c8102e` |
| `templates/swiss-minimal.html` | Swiss typographic style: huge type, grid, one strong color | Design-minded talks, principles, thought leadership | 12 | `#e30613` / `#111111` / `#8a8a8a` |
| `templates/executive-luxe.html` | Deep tone with gold, framed pages, refined serif type | Premium proposals, finance, law, private clients | 12 | `#0f4c3a` / `#c9a227` / `#e8dcc4` |
| `templates/saas-aurora.html` | Modern product page: aurora background, glass cards, app mockups | Product demos, sales decks, startups, pricing | 12 | `#7c3aed` / `#06b6d4` / `#f59e0b` |
| `templates/neo-brutalist.html` | Cream paper, thick black outlines, hard offset shadows, stickers | Product tips, internal tools, creative teams, social clips | 12 | `#f2441d` / `#2f5bff` / `#c6f432` |
| `templates/bauhaus-geometric.html` | Primary shapes, modular grid, geometric compositions | How systems decide, design talks, education | 12 | `#d62828` / `#1d4e89` / `#f2b705` |
| `templates/risograph-zine.html` | Print zine: grain, misregistered ink, halftones, taped notes | Media literacy, community talks, culture, NGOs | 12 | `#f0368f` / `#0068b4` / `#ffd800` |
| `templates/zen-ink.html` | Washi paper, brush strokes, vertical text, wide empty space | Wellbeing, focus, calm technology, reflective talks | 12 | `#b8322a` / `#2d4a63` / `#7d8f69` |
| `templates/retro-desktop.html` | 90s desktop: bevelled windows, dialogs, wizard, blue screen | Security awareness, tech nostalgia, IT onboarding | 12 | `#008080` / `#000080` / `#1084d0` |
| `templates/isometric-blocks.html` | Light isometric grid, 3D blocks, exploded layers, moving packets | Infrastructure, how data travels, architecture, cost | 12 | `#4263eb` / `#12b886` / `#fab005` |
| `templates/kinetic-type.html` | Black screen, huge condensed words that slam, roll and glitch | Glossaries, short videos, openers, social media | 12 | `#ffe14d` / `#ff3d7f` / `#7df9ff` |
| `templates/chalkboard-class.html` | Green chalkboard, handwriting, self-drawing chalk diagrams | Classes, beginners, step-by-step explanations | 12 | `#ffd166` / `#ef8fa0` / `#8fd3f4` |
| `templates/sports-broadcast.html` | TV sports studio: scorebug, lower thirds, replays, league table | Comparisons, head-to-head tests, team results | 12 | `#e10600` / `#ffd400` / `#00a3e0` |
| `templates/academic-paper.html` | Research paper: serif type, highlighter, margin notes, figures | Explaining studies, research summaries, evidence reviews | 12 | `#8c1515` / `#1f5aa6` / `#f7e463` |
| `templates/art-deco-gala.html` | Black and gold Art Deco: sunburst, stepped frames, marquee bulbs | Events, galas, launches, hospitality | 12 | `#d4af37` / `#1f6f78` / `#f2e6c9` |
| `templates/clay-soft.html` | Claymorphism: soft 3D cards, inflated buttons, floating clay shapes | Consumer apps, smart home, friendly product explainers | 12 | `#6c5ce7` / `#ff8a65` / `#4cd4b0` |
| `templates/paper-cutout.html` | Layered paper craft: torn notes, tape, paper hills and strips | Photo and image tools, crafts, school and family audiences | 12 | `#e4572e` / `#29335c` / `#f3a712` |
| `templates/y2k-chrome.html` | Y2K: chrome type, holographic borders, sparkles, glossy windows | Phones and gadgets, youth audiences, social clips | 12 | `#ff4fd8` / `#3df2ff` / `#b8ff3d` |
| `templates/museum-gallery.html` | Gallery wall: gilt frames, wall labels, vitrine, floor plan | Images and recognition, culture, history, guided tours | 12 | `#8b1e3f` / `#1d3557` / `#b08d57` |
| `templates/travel-passport.html` | Travel: boarding pass, stamps, route map, split-flap board | Translation, travel, step-by-step journeys | 12 | `#0b6e4f` / `#e63946` / `#f4a261` |
| `templates/transit-map.html` | Metro map: colored lines, stations, roundels, platform display | Routing, logistics, how a system chooses, networks | 12 | `#e3242b` / `#0072ce` / `#00a650` |
| `templates/pixel-arcade.html` | 8-bit game: pixel sprites, HUD, dialogue box, high scores | Learning by trial and error, gamified training, young audiences | 12 | `#ff3366` / `#ffd23f` / `#3ee0cf` |
| `templates/social-stories.html` | Social app UI: phone stories, highlights, feed, notifications, poll | Social media, recommendations, digital habits | 12 | `#ff2e63` / `#7b2ff7` / `#ffb800` |
| `templates/watercolor-storybook.html` | Children's storybook: watercolor washes, chapters, open book, story map | Narrated explainers, beginners, families, gentle introductions | 12 | `#3a7ca5` / `#d1495b` / `#edae49` |

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
| `blueprint-schematic` | `.ink` (self-drawing SVG lines), `.titleblock`, `.index`, `.annot` (annotated diagram), `.exploded` (layers), `.pipe`, `.dim` (dimension lines), `.fault`, `.rev`, `.approval`, `.stamp`, `.closing` |
| `newspaper-front` | `.mast`, `.front`, `.ticker`, `.inside`, `.article` (columns with drop cap), `.facts`, `.pull`, `.chartbox`, `.wbar`, `.oped`, `.errata`, `.stamp`, `.ads` (classifieds), `.closing` |
| `data-dashboard` | `.panel`, `.kpi`, `.delta`, `.spark`, `.bars`, `.tabs`, `.sec-ring`, `.linec` (line chart), `.stack100`, `.heat`, `.fnl` (funnel), `.lead-row` (ranking), `.alert`, `.kanban`, `.goalring` |
| `pop-comic` | `.pnl`, `.bub` (speech and thought), `.rob`, `.hum`, `.burst`, `.band`, `.ep`, `.fight` (versus bars), `.tc` (trading cards), `.ednote`, `.act`, `.outro` |
| `consulting-boardroom` | `.brief`, `.exec` (executive summary), `.tree` (issue tree), `.matrix` (2×2), `.wf` (waterfall), `.gantt` (roadmap), `.risk`, `.rag`, `.errnote`, `.ask` |
| `swiss-minimal` | `.biglist`, `.blk`, `.state`, `.prop` (proportional circles), `.anat` (sentence anatomy), `.twocol`, `.ratio`, `.fix`, `.closing` |
| `executive-luxe` | `.seal` (rotating), `.ledger`, `.orn`, `.pillars3`, `.versus`, `.vt` (vertical timeline), `.tiers`, `.q`, `.note-card`, `.invite`, `.outro` |
| `saas-aurora` | `.glass`, `.browser` (app mockup), `.stepper`, `.bento`, `.wave`, `.hub` (connections), `.tgl` (before/after switch), `.strip`, `.wall` (reviews), `.plans`, `.toast`, `.btn` |
| `neo-brutalist` | `.sticker`, `.cards`, `.big` (section block), `.duel`, `.app` (inbox with `.tag`), `.check` (ticking checklist), `.poll`, `.dd` with `.stars`, `.cta` |
| `bauhaus-geometric` | `.comp` (shape composition), `.shapelist`, `.geo` (sweeping disc), `.grid9`, `.seesaw`, `.units` (unit squares), `.rose` (quarter-circle chart, area = value), `.knob` |
| `risograph-zine` | `.mis` (misregistered ink), `.ransom` (cut-out letters), `.spread`, `.ht` (halftone), `.tally`, `.venn` (overprint), `.tapes`, `.markup` (photo with `.scrib` circles), `.osteps` |
| `zen-ink` | `.enso` (self-drawing brush circle), `.vtext` (vertical text), `.inklist` with `.stroke`, `.ripple`, `.stones`, `.day` (brush timeline), `.twin`, `.haiku`, `.hanko` (logo seal) |
| `retro-desktop` | `.win` (bevelled window), `.ico`, `.task` (taskbar), `.cur` (moving cursor), `.splash` with `.prog` (segmented bar), `.mailx`, `.cascade` (dialogs), `.reveal` (status bar), `.wiz`, `.bsod`, `.safe` |
| `isometric-blocks` | `.iso` (SVG scene) with `.cube` (`.rise`, `.drop`, `.lit`), `.tile`, `.layer` (exploded stack), `.wire` and `.pkt` (travelling packet), `.steps`, `.legend`, `.groups` |
| `kinetic-type` | `.slam`, `.rot` (word carousel), `.lines` (masked lines), `.huge`, `.wordhd`, `.tokens`, `.probs` (word area = chance), `.giant`, `.vsline`, `.glitch`, `.ticker` (marquee) |
| `chalkboard-class` | `.dr` (self-drawing chalk lines), `.st` (chalk SVG text), `.lesson`, `.today`, `.circ`, `.cmp2`, `.eq`, `.exam`, `.erase-line` with `.eraser` |
| `sports-broadcast` | `.scorebug`, `.lower3`, `.sched`, `.shield`, `.player` with `.attr`, `.drow` (mirrored bars), `.pitch` with `.tel` (telestrator), `.bigstat`, `.league`, `.var`, `.ticker` |
| `academic-paper` | `.sheet` (paper specimen), `.page` with `.badge`, `.para` (§ marker), `.hl` (highlighter), `.absbox` with `.mn` (margin notes), `.fig` (error bars), `.bt` (booktabs table), `.eqn`, `.cite` and `.refcard`, `.erratum`, `.refs` |
| `art-deco-gala` | `.deco` (frame with diamond corners), `.arches`, `.diamond` (section), `.marquee` with `.bulbs`, `.fan` (half fan, angle = share), `.tables` with `.seat`, `.ticket` (tearing stub), `.telegram`, `.stairs` (before/after bars) |
| `clay-soft` | `.puff` (clay card), `.orb`, `.dial` (two-ring gauge), `.routine` with `.sw` (switches), `.sliders` (autonomy), `.stacks` with `.coin`, `.bubbles` (area = share), `.pill` |
| `paper-cutout` | `.card.torn` with `.tape`, `.cutout`, `.layn` (layered numeral), `.duo`, `.peel` (separating layers), `.fold` (accordion steps), `.strips` (torn bars), `.tags` (swinging tags) |
| `y2k-chrome` | `.chrome` (metal text), `.holo` (holographic card), `.bubble` with `.loader`, `.duel`, `.phone` with `.voice` and `.typed`, `.cd` (spinning disc ring), `.meters` with `.eq`, `.aqua` (glossy window), `.gel` |
| `museum-gallery` | `.frame` with `.art` and `.plaque`, `.hangw` (spotlight), `.plan` (floor plan route), `.sign` (room sign), `.bigp`, `.vitrine` with `.call` (callouts), `.salon` (frame area = share), `.guide` (audio guide), `.notices` |
| `travel-passport` | `.pass` (boarding pass), `.map` with `.plane` (moves along the path), `.stamp`, `.book`, `.board` with `.fl` (split-flap), `.belt` with `.bag`, `.stamps` with `.ink`, `.postcard`, `.checks` |
| `transit-map` | `.metro` (self-drawing lines), `.strip` with `.train`, `.roundel`, `.trips` with `.segs` (walk/wait/ride), `.plat` (platform display), `.network` (chosen route), `.train5` with `.seats` (crowding), `.notice`, `.signs` |
| `pixel-arcade` | `.hud` with `.heart`, `.bot` (pixel sprite), `.coin`, `.lvl` (level map with `.walker`), `.screens` (`.cab`), `.rpg` (dialogue box), `.hs` (high scores), `.run` (step chart), `.patch`, `.hpbar` with `.fixes` |
| `social-stories` | `.phone` with `.sbars` (story bars) and `.hearts`, `.hls` (highlights), `.bigring`, `.dots` (dot matrix), `.posts` (scrolling feed) with `.chip`, `.sig` (weights), `.notifs`, `.cmt`, `.poll`, `.prof` |
| `watercolor-storybook` | `.wash`, `.titlepg`, `.ribbons`, `.cap` (watercolor drop cap), `.book` with `.leaf` (page turn), `.jars` (level = chance), `.mapb` with `.flag`, `.pots` (growing plants), `.anote`, `.moral` |

Removing a `neon-tech` diagram slide is safe: its script skips missing elements. Timers in new code must use `setTimeout`, `setInterval`, `requestAnimationFrame` or `performance.now`, so the video render can control them; do not use Web Workers or `<video>`.

When you add CSS for a new component:

- Never put `transform`, `filter` or an `animation` of your own on an element with class `r`: the entrance animation ends at `transform:none` and `filter:none` and replaces them, so the tilt, offset or drop shadow disappears, or the element stays invisible. Use `rotate`, `translate` or `scale` and `box-shadow`, or animate an inner element.
- Do not name custom properties `--a`, `--d`, `--sd` or `--i`: the engine reads them. Registering `@property --a` hid every `.r` element in a real run.
- Do not name your own `@keyframes` `up`, `down`, `fromL`, `fromR`, `pop`, `blurIn`, `wipeIn`, `chIn` or `wipe`: DESIGN-CSS comes after the engine and replaces them. A `@keyframes pop{to{scale:1}}` left every `class="r s"` element at opacity 0 in a real run, and `check.js` reported it as `hidden`.

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

### 7. Export to PDF and PPTX (only if requested)

Capture each slide as an image and mount it page by page. Do not rebuild the layout with native PowerPoint shapes: fidelity wins over editability. Generate only the format the user asked for, and say in the delivery that the PPTX keeps the design but its text is not editable.

```bash
node scripts/export_slides.mjs --html /workspace/deck.html \
  --out /workspace/.cache/motion-presentations/export --sec 4
python3 scripts/export_pack.py \
  --manifest /workspace/.cache/motion-presentations/export/manifest.json --name Deck-Title
```

Both scripts bootstrap their dependencies on every run (idempotent), so a recreated sandbox needs no manual setup: `export_slides.mjs` installs `puppeteer-core` under `/workspace/.cache/motion-presentations/node` when missing; `export_pack.py` builds `/workspace/.venv` and re-execs itself under it when an import fails (global pip is blocked by PEP 668).

Why these choices:

- **Serve over HTTP on 127.0.0.1**, not `file://` (fonts and same-origin assets are unreliable there).
- **Drive navigation with the deck's own engine** (`window.go(i, true)`, detected by the script). A copy that only toggles `display` freezes every JS-rendered value at its start: in a real run a `data-count` slide captured `0` until the engine ran. Counters, typewriter text and canvas charts need the engine plus a full animation window.
- `--sec` must be at least the `--sec` value `check.js` passes for that template, so animations finish before the shot.
- Chrome flags `--no-sandbox --disable-gpu --disable-dev-shm-usage --font-render-hinting=none`; viewport 1920x1080 with `deviceScaleFactor: 2` -> 3840x2160 PNG. Wait `document.fonts.ready` plus 400 ms before the first capture, and screenshot with `clip: {x:0, y:0, width:1920, height:1080}` so no bar or margin leaks in.
- Before exporting, force the stage scale to 1 and align it to the clip origin: `#stage{left:0!important;top:0!important;transform:none!important}`, `html,body` 1920x1080. Resetting only the transform is not enough: the shared engine has `#stage{left:50%;top:50%}` and `fit()` centers it with `translate(-50%,-50%)`; without resetting `left/top`, the stage lands at (960,540) and the clip captures only part of the slide over background. The script verifies the stage bounding box is exactly (0,0) 1920x1080 after injecting the styles and exits 2 otherwise, so a misaligned run cannot pass silently. Also hide `#chrome` (brand, counter, progress, hint), nav buttons, dots and fullscreen.
- Use `await new Promise(r => setTimeout(r, n))` between slides; `page.waitForTimeout` is not available.
- Put sources and captures under `/workspace`, not `/tmp`: a sandbox recreated mid-export loses the capture HTML and the whole run must be rebuilt.

Verification (`export_pack.py` exits 2 on any of these): file count different from the `slides` the manifest declares (a truncated or stale manifest must not be delivered as a partial export), a file size other than 3840x2160, a file under 50 KB, or a blank capture (pixel stddev under 1.5, which means the JS state never ran). Then confirm the PDF has N pages of 13.333" x 7.5" and the PPTX has N slides plus one note each. Read slide titles from `data-sec`, falling back to the slide heading; a parser that only looked at `h1` wrote wrong notes for slides that carry only `data-sec`.

Delivery: `expose_sandbox_file` per file. Never `publish_generated_file` for a file that lives in the sandbox, and never `create_file`/`override_full_file` for binaries. Share the download URL, the slide count and the 16:9 page size. Use `.pptx`, not legacy `.ppt`.

Causes seen in real runs:

| Symptom | Real cause |
|---|---|
| `Permission denied` opening `index.html` | Project files are 600 and owned by uid 999: `ls` shows them, the sandbox user cannot read them, `chmod` is not allowed |
| `Waiting for selector .slide` timeout | The HTTP server returned 404 (unreadable or wrong path), not a slow page |
| `Cannot find package puppeteer-core` | Clean sandbox without the package; the script now bootstraps it on every run (it also failed when the `.mjs` ran outside any `node_modules` ancestor) |
| `externally-managed-environment` | Global pip is blocked (PEP 668); use the venv |
| Captures or source HTML vanish mid-run | Sandbox recreated; only rebuild the missing part |
| Counter captured as `0` | Engine not run, so `data-count` never executed |
| Partial PDF/PPTX delivered with exit 0 | Manifest count not verified against `files`; `export_pack.py` now rejects the mismatch before building anything |
| PDF stretched or margined | Page built as A4/letter instead of 13.333" x 7.5" |
| Nav bar or black strip in captures | The interactive deck was captured without the chrome overlay |
| Capture is mostly background with content in one corner | Only the transform was cleared; `#stage` keeps `left:50%/top:50%` (the exit looked fine: 3840x2160 PNGs, exit 0) | Reset `left/top` alongside the transform and check the stage rect before capturing; `export_slides.mjs` now exits 2 if the stage is not at (0,0) 1920x1080 |
| Node 22 error on this path | Not this path's requirement: `export_slides.mjs` ran on Node 20.19.3 with `puppeteer-core`. The Node 22 rule applies to the `lib.js` browser-control scripts, which need native `WebSocket` |

Measured run (Linux sandbox, Node 20.19.3, system Chrome, `neon-tech` deck with 15 slides, `--sec 4`):

| Step | Result | Time |
|---|---|---|
| `export_slides.mjs` | 15 PNG at 3840x2160 plus `manifest.json` | 125.9 s |
| `export_pack.py` | PDF 15 pages 16:9 (37.4 MB), PPTX 15 slides + 15 notes (37.5 MB), every capture > 2.3 MB | 8.4 s |
| Failure paths | Missing `--html` exits 2 in 42 ms, before Chrome starts (`path.resolve('')` would resolve to the CWD, so the flag is validated before resolving); a truncated manifest (`slides: 15`, 1 file entry) exits 2 before building any output | - |
| Clean-sandbox bootstrap (`node_modules` and venv removed) | Export bootstrapped `puppeteer-core` (12 s npm) and captured; pack bootstrapped the venv and built both outputs | export 41.8 s; pack 9.9 s cold, 2.0 s warm |

Bootstrap run detail (clean sandbox, `editorial-light.html`, 15 slides, `--sec 1`): stage verified at (0,0) 1920x1080 before capture, 15 PNG 3840x2160, stddev 22.1-55, PDF 15 pages, PPTX 15 slides + notes.

### 8. Deliver

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

Expected: `ok` for all thirty-four templates and `OK: 15 slides with no problems`.

## Measured runs

One run on Windows with Edge headless and ffmpeg 8.1:

| Input | Output | Time |
|---|---|---|
| `bold-blocks`, rebranded with a generated test logo, 13 slides × 3 s, 2560×1440 at 30 fps, `--crf 17` | 1170 frames, 39 s of video, 7.5 MB | 65.6 s (17.8 capture fps) |
| `friendly-pastel`, default colors, same settings | 1170 frames, 39 s of video, 7.5 MB | 69.3 s (16.9 capture fps) |
| `data-dashboard`, default colors, 14 slides × 3 s, same settings | 1260 frames, 42 s of video, 21.1 MB | 88.3 s (14.3 capture fps) |
| `swiss-minimal`, default colors, 12 slides × 3 s, same settings | 1080 frames, 36 s of video, 5.2 MB | 71.5 s (15.1 capture fps) |
| `isometric-blocks`, default colors, 12 slides × 3 s, same settings | 1080 frames, 36 s of video, 21.5 MB | 84 s (12.9 capture fps) |
| `watercolor-storybook`, default colors, 12 slides × 3 s, same settings | 1080 frames, 36 s of video, 14.0 MB | 81 s (13.3 capture fps) |

Capture speed and file size depend on the machine and on the template's effects. Run `--frames 300` first to estimate a long render.

| Template | `check.js --sec` that passes | Note |
|---|---|---|
| `neon-tech` | 8 | Fails at 2 s: its entrance delays reach 2.9 s and the race note appears at 6 s |
| `editorial-light` | 3 | |
| `bold-blocks` | 3 | |
| `terminal-retro` | 5 | Fails at 3 s: the last log line starts at 2.7 s |
| `friendly-pastel` | 5 | Fails at 3 s: the quiz answer appears at 3 s |
| `cinematic-keynote` | 3 | |
| `blueprint-schematic` | 3 | |
| `newspaper-front` | 3 | |
| `data-dashboard` | 5 | Fails at 3 s: the last chart label appears at 2.4 s |
| `pop-comic` | 3 | |
| `consulting-boardroom` | 5 | Fails at 3 s: the waterfall's last labels appear at 2.5 s |
| `swiss-minimal` | 5 | Fails at 3 s: the ratio note appears at 2.4 s |
| `executive-luxe` | 3 | |
| `saas-aurora` | 5 | Fails at 3 s: the mockup's last lines appear at 2.4–2.8 s |
| `neo-brutalist` | 3 | |
| `bauhaus-geometric` | 3 | |
| `risograph-zine` | 3 | |
| `zen-ink` | 3 | |
| `retro-desktop` | 3 | |
| `isometric-blocks` | 3 | |
| `kinetic-type` | 3 | Also passes at 4, 6, 7 and 10 s: its word carousel loops, so it was checked at several phases |
| `chalkboard-class` | 3 | |
| `sports-broadcast` | 3 | |
| `academic-paper` | 3 | |
| `art-deco-gala` | 3 | |
| `clay-soft` | 3 | |
| `paper-cutout` | 3 | |
| `y2k-chrome` | 3 | |
| `museum-gallery` | 3 | |
| `travel-passport` | 3 | |
| `transit-map` | 3 | |
| `pixel-arcade` | 3 | |
| `social-stories` | 3 | |
| `watercolor-storybook` | 3 | |
