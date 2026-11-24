---
name: video-editor
description: Edit local videos with Remotion Studio in the agent harness you are working in: transcribe, cut silences and stumbles, and add captions, zooms, full-screen cards and overlays while the user reviews a headed preview. Use when the user asks to edit, cut, caption or decorate a local video file.
---

# Video editing with Remotion

Run locally, in the harness you are working in. Keep the video project in the agent workspace, outside this skill and other repositories. Keep the original media unchanged. Do not commit generated videos, transcripts, or project data. Do not commit or push skill changes unless the user asks. Measured case notes behind every default are in [references/lessons.md](references/lessons.md).

## Pipeline

| Step | Command | Measured on a 42.4 s, 2160×3840, 60 fps talking head |
|---|---|---|
| 1. Transcribe | `python scripts/transcribe.py` | 8.2–8.7 s, 110 words (`small`, CPU int8, model cached) |
| 2. Plan silences | `node scripts/plan-silence.cjs` | 3.1 s, 13 cuts, 42.42 → 33.53 s, longest pause 0.289 s |
| 3. Create project | `node scripts/create-project.cjs` | 480 px proxy 17.7 s (3.8 MB; the earlier 720 px proxy took 15.2 s, 12.7 MB), source hardlinked, dependencies reused |
| 4. Edit `src/edit.js` | anchors to words or source time | — |
| 5. Validate | `node scripts/validate-edit.cjs` | under 1 s |
| 6. Review in Studio | headed browser tab | proxy only (3.8 MB instead of 463 MB); preview clock ran at real time (0.99–1.00×) |
| — Stills before approval | `npx.cmd remotion still --scale=0.25` | about 11 s per frame from the 4K original |
| 7. Render after approval | `npx.cmd remotion render` | 61 frames at `--scale=0.25`: 21.6 s from the 720 px proxy, 56.8 s from the original |

Requirements: Node.js, npx, FFmpeg 7+ and ffprobe on PATH; Python with `faster-whisper` for step 1. Tests: `node --test skills/video-editor/tests/video-editor.test.cjs` (7 tests, 3.9 s on an idle machine, synthetic audio). Every still or render copies `public/` into the bundle (475.7 MB on the sample), so keep unused media out of `public/`.

## Always show the result in Remotion Studio

Every edit step must be visible to the user in Remotion Studio, in a headed, visible browser tab (the harness's integrated browser, tab activated). Open Studio right after creating the project and keep it open. After each change, let hot-reload update the composition, then confirm the new duration and playback in that tab before reporting. Do not report results only as files or a rendered MP4: the Studio preview is the primary deliverable.

### Never render the full video before the user approves

Do **not** run `remotion render` on the whole composition until the user has reviewed the edit in Studio and approved it. A full render of a long or 4K video takes many minutes of CPU, and any later change invalidates it. Iterate in Studio and render only after approval.

Allowed before approval, because each one takes seconds:

- single stills with `remotion still ... --frame=<N> --scale=0.25` to inspect a screen, an overlay or a caption;
- very short clip exports (`--frames=0-30`) when motion itself must be checked;
- measurements taken inside Studio through the browser.

Ask for approval explicitly ("does this edit look right?") and wait. Report the expected render cost before starting one, and never leave a render running while editing, since both compete for CPU.

## 1. Transcribe locally

```powershell
python -m venv "<WORK_DIR>/venv"
"<WORK_DIR>/venv/Scripts/python.exe" -m pip install faster-whisper==1.2.1
"<WORK_DIR>/venv/Scripts/python.exe" <SKILL_DIR>/scripts/transcribe.py "<VIDEO>" "<WORK_DIR>/transcript.json" --language es --cache-dir "<WORK_DIR>/.cache/huggingface"
```

- Verified with `faster-whisper 1.2.1` and `av 18.1.0` on Python 3.11.9. The script extracts mono 16 kHz audio itself and uses `small`, CPU int8, `beam_size=5`, `temperature=0`, `condition_on_previous_text=False`, VAD with 250 ms minimum silence, word timestamps.
- Weights are not downloaded unless `--allow-download` is passed; ask the user first (a few hundred MB). Without it, a missing model fails with faster-whisper's own error.
- Words with `end <= start` are dropped and counted in `discarded_words` instead of aborting the transcript.
- `low_confidence_words` lists words with probability below 0.5 (3 of 110 on the sample; median 0.98). Segment scores are not useful for this: faster-whisper repeats them per 30 s window.
- Re-check a doubtful window with a bigger model without re-transcribing everything: `--model medium --clip 12.0,15.0 --allow-download`.
- Trust the audio over the transcript. A segment over digital silence is a hallucination even when it has text.
- Fix spelling of proper nouns by editing the tokens in `src/captions.js`; keep `transcript.json` as evidence.

## 2. Plan silence cuts (aggressive by default)

Unless the user asks to keep pauses, remove them with the planner; do not hand-pick pauses.

```powershell
node <SKILL_DIR>/scripts/plan-silence.cjs "<VIDEO>" "<WORK_DIR>/transcript.json" "<WORK_DIR>/silence-plan.json"
```

What it does, in one run:

1. `silencedetect` at `-35 dB`, `d=0.25`; a silence open at the end of the file is closed at the duration.
2. Cuts are the silences minus 0.07 s at each edge (a short natural pause), at least 0.2 s long. Clips are their complement; transcript word spans never extend a clip.
3. Joins the audio with the clips, re-detects, and adds what is still silent, until a pass adds nothing (`--max-passes=4`).
4. Audits every word whose span overlaps a cut: the removed slice must read below `--gate=-40` dB on the source. Suspicious words are listed and the exit code is 2.
5. Verifies the joined result: reports `longestPause` and `pausesOverTarget` (target 0.40 s).

Flags: `--noise`, `--min-silence`, `--edge`, `--min-cut`, `--max-passes`, `--target-pause`, `--gate`. Pass `-` instead of the transcript to skip the audit. The output file must not exist; text goes to stderr, a JSON summary to stdout, and the full plan (`clips` in source seconds) to the file. Copy `clips` into `edit.js`.

Silence detection depends on the noise floor. If the audit flags words or pauses survive, measure the floor before moving `--noise` (see lessons).

### Cutting false starts and stumbles

Speakers restart sentences; silence detection never proposes this cut because the words are continuous. Find two similar openings a few seconds apart in the transcript, then split the clip that spans the stumble: exit at a local energy minimum right after the last kept word and re-enter just before the first word of the second take, both below −40 dB in a 20 ms energy profile. Captions need no manual work: the template drops every word that the kept clips do not cover (see "Captions"). Run `validate-edit.cjs` and check that the caption count fell by the stumble's words only (110 → 103 for a 7-word stumble on the sample).

## 3. Create and open the project

```powershell
node <SKILL_DIR>/scripts/create-project.cjs "<VIDEO>" "<WORK_DIR>/project" "<WORK_DIR>/transcript.json"
```

| Behavior | Default | Override |
|---|---|---|
| Source in `public/` | hardlink (instant, no extra disk; the file is not modified) | `--copy`; falls back to a copy across drives |
| Proxy `public/proxy.mp4` | created when the short side is above 1080 px or fps above 30: short side 480 px, 30 fps, CRF 28, `-tune fastdecode`, keyframe every second, AAC 128k | `--proxy`, `--no-proxy`, `--proxy-size=<even px>` (for example 720 for a sharper preview) |
| Dependencies | `node_modules` is a junction to one shared install in `<WORK_DIR parent>/.cache/video-editor/remotion-4.0.546`, installed on first use | `--deps=<DIR with node_modules>`, `--no-install`, `--install-timeout=<min>` |

The target directory must not exist. The transcript must belong to this exact source and contain `segments[].words[]` with `word`, `start`, `end` in seconds. Dependencies are resolved before the project folder is created, so a failed install leaves nothing behind. The first shared install uses `npm`; if npm is a broken Corepack shim it retries with `npx --yes npm@10.9.2`; each attempt stops after `--install-timeout` minutes (10) and both real errors are reported. Measured here: the Corepack shim failed with `unable to verify the first certificate` and the fallback did not reach the registry in 5 minutes either, so the first install was not verified end to end; reuse (`--deps` pointing at an installed project) was. If npm cannot validate the registry certificate, use the system's trusted certificates; never disable TLS verification.

Start Studio in a **visible, independent console**, not in a tool-owned background command that ends with the turn:

```powershell
Start-Process -FilePath "powershell" -WorkingDirectory "<WORK_DIR>/project" -ArgumentList '-NoExit','-Command','npx.cmd remotion studio src/index.jsx --port 3333 --no-open' -WindowStyle Normal
```

`npx.cmd` avoids PowerShell's execution-policy problem with `npx.ps1`. Do not start a duplicate server for a running project; pick a free port for a second one. Open `http://localhost:3333/EditedVideo` in the harness's integrated browser and **activate the tab**. Studio plays `proxy.mp4` (check the network entries: only the proxy is requested); renders use the original. Studio listened on all network interfaces here; do not assume the media is private from other network clients.

**Choppy audio in Studio only** (renders are not affected, they wait for every frame): each clip is its own `<Video>` player, and a player that is not premounted starts decoding on the frame of its cut, so chunks near the join are dropped. Clip sequences use `premountFor` (1 s). Measured by hooking `AudioBufferSourceNode.start` while playing the 11-clip sample: without premount, a fresh page (720 px proxy) dropped 4 × 21 ms at joins and a warm run (480 px) lost the whole last clip (6.5 s silent from its join); with premount, a warm run had no holes at joins. The first play after a cache-bypassing reload still dropped 1 s in 11 holes, so play once before judging the audio. Also keep the Studio tab in the foreground (background tabs are throttled), check that the network entries show `proxy.mp4` and not the source, and for a project created before the 480 px default rebuild the proxy in place:

```powershell
ffmpeg -y -i public/source.mp4 -vf "scale=480:-2" -r 30 -c:v libx264 -preset veryfast -tune fastdecode -crf 28 -g 30 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart public/proxy.mp4
```

Use `scale=-2:480` for horizontal video, and add `proxy: "proxy.mp4"` to `edit.js` if the project had no proxy.

## 4. The edit plan (`src/edit.js`)

```js
clips: [{start: 0.366, end: 2.708}, {start: 3.022, end: 5.715}],   // source seconds; order defines the result
zooms: [{word: "documentation", duration: 1.8, scale: 1.2}],
overlays: [{word: "subscribe", duration: 3, type: "cta"}],
screens: [
  {at: "source", start: 1.97, end: 7.2, type: "quote", quote: "…"},
  {word: "create", endWord: "index", type: "list", transition: "slide", title: "…", items: ["…"]},
  {start: 21.3, end: 24.5, type: "split", transition: "wipe", title: "…"},             // output seconds
],
theme: {preset: "neon", primary: "#22d3ee", secondary: "#facc15"}, showSafeZones: true,
```

**Timing anchors.** Items use output seconds by default. Two anchors survive any re-cut without remapping:

| Anchor | Fields | Resolves to |
|---|---|---|
| Source time | `at: "source"`, `start`, `end` | the same moment after the cuts; a time inside a removed part snaps to the nearest kept edge |
| Spoken word | `word` (word or short phrase), `occurrence` (1), `offset` (0 s), and `duration` (3 s) or `endWord`/`endOccurrence` | the start of that word in the kept captions; matching ignores case, accents and punctuation |

A missing word throws in Studio and is an error in the validator.

**Other fields:** `captionsPosition` (`"center"` / `"bottom"`), `captionsMaxWords` (4 vertical, 6 horizontal), `fontFile` (font in `public/`, loaded locally), `joinFadeFrames` (1), `screenSettle` (true), `showSafeZones` (false), `theme`, `proxy`.

### Validate before showing

```powershell
node <SKILL_DIR>/scripts/validate-edit.cjs "<WORK_DIR>/project"
```

It resolves the anchors with the project's own `timeline.mjs` and reports errors (exit 1) and warnings:

- errors: clips with `end <= start` or outside the source, items with zero or negative frames, items outside the edit, unknown `type`, missing anchor word, missing proxy, unknown theme `preset` or `effect`, theme colors that are not `#rgb`/`#rrggbb`;
- warnings: more than 2 zooms in a 30 s window, more than 2 overlays, overlapping screens, overlapping overlays in one position, overlays under 2.5 s, overlapping clips, theme text below 4.5:1 on its background.

Report its summary line (duration, clips, captions kept, zooms per 30 s, overlays, screens) with each preview.

## 5. Visual strategy (default, approved by the user)

The edit is driven by **zooms and full-screen cards**; small overlays are the exception.

| Element | Budget | Purpose |
|---|---|---|
| `zooms` | at most **2 per 30 s** window of output time | keep a talking head alive |
| `screens` | as many as the content supports | data, definitions, steps, comparisons, the news or person being discussed |
| `overlays` | **1–2 per video** | one truly important highlight; keep a slot free for later requests |

Prefer a screen whenever the speaker names data, a comparison, a definition, a list of steps or a person/company. Use only figures the speaker actually says. Give an overlay at least 2.5 s, and a list or kinetic screen about 0.5 s per item or word plus 1.5 s. Place screens where the speaker is not showing something on camera.

### Zooms

| `mode` | Motion | Default `ramp` |
|---|---|---|
| `punch` (default) | jumps in over 2 frames with an ease-out, eases out at the end | 2 frames |
| `push` | slow push-in with an expo ease-out (`bezier(0.16, 1, 0.3, 1)`) | 0.4 s |

`ramp` (seconds) overrides either. `origin` is the CSS transform-origin: vertical videos default to `"50% 35%"` so the face stays in frame; horizontal to the center. After a full-screen card ends, the picture settles from 1.04 to 1 over 0.35 s (`screenSettle: false` disables it).

### Captions

- Drawn **outside** the zoomed layer, so a punch-in never scales the text. Keep `CaptionLayer` a sibling of the zoomed layer.
- Filtered at runtime by the kept clips: a word stays when a kept clip covers at least `min(0.05 s, word length)` of it. Cutting a stumble removes its words; short words inside a clip stay.
- Pages are grouped by `@remotion/captions` (1.2 s) and split to `captionsMaxWords`.
- Style: `theme.font`, weight 800, black stroke at 7 % of the font size plus shadow, active word in `theme.highlight` with a small spring pop (scale 1.08).

| Video | Position | Size |
|---|---|---|
| Vertical | `top: 56%`, centered on that line, 4 % side margins | `width × 0.0625` |
| Horizontal | `bottom: 7%` | `width × 0.032` |

Captions are hidden while a screen is on. Verify placement by measuring the caption rectangle against `.remotion-studio-composition-container`.

### Audio joins

`joinFadeFrames` (default 1) lowers the volume on the frame on each side of an internal join (0.5 with 1 frame) to soften a residual click. Remotion applies volume per frame, so this is a one-frame dip, not a sample-accurate crossfade; joins must still sit in silence. Measured on a render: the two join frames read exactly 6 dB lower than with `joinFadeFrames: 0` (−54.0 vs −48.0 dB and −75.3 vs −69.1 dB) and every other frame is identical. For platform loudness, normalize the approved render (YouTube and Shorts target about −14 LUFS):

```powershell
ffmpeg -i "<OUTPUT.mp4>" -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:v copy -c:a aac -b:a 192k "<OUTPUT-norm.mp4>"
```

On a 1 s test render this measured −14.2 LUFS integrated afterwards (`ebur128`), with both streams kept.

### Safe zones

`showSafeZones: true` draws a Studio-only guide; it never appears in stills or renders. Vertical: top 10 %, bottom 20 % and a right column (16 % wide, 40–80 % of the height) where Shorts/Reels/TikTok draw their interface; these are approximations, not measured per platform. Horizontal: a 2.5 % action-safe border. Keep text and badges out of the marked areas.

## 6. Component library (`src/components.jsx`)

Choose a component with `type`; the remaining fields are its props. Items without `type` use `callout` (overlay) or `title` (screen). An unknown `type`, icon or transition throws an error listing the valid names. Sizes scale with the shorter side of the video. Each item has a spring entrance and fades out during its last 0.3 s. Overlays are drawn above screens.

Preview everything in the `Gallery` composition (`/Gallery`, project size) and `GalleryHorizontal` (`/GalleryHorizontal`, 1920×1080), 3 s per item, labelled with its `type`. Let the user pick styles there.

**Overlays** (`position`: `top-left`, `top-center`, `top-right`, `center-left`, `center`, `center-right`, `bottom-left`, `bottom-center`, `bottom-right`). `bottom-*` ends 26 % of the frame height above the bottom (above the captions and the platform UI band). With centered captions (vertical default), the `center-*` row sits just above the caption band instead of on top of it. Measured on 2160×3840: a `center` icon at 28.7–49.2 % of the height and the captions at 54–58 %; a `bottom-center` CTA ending at 73.8 %.

| `type` | Use | Props (default) |
|---|---|---|
| `callout` | Short key-point box | `text`, `color`, `position` (`top-left`) |
| `lowerThird` | Name/title bar that wipes in | `title`, `subtitle`, `color`, `position` (`bottom-left`) |
| `alert` | Info/success/warning/error card; warning and error shake once | `variant` (`info`), `title`, `text`, `icon`, `position` (`top-center`) |
| `notification` | Phone-style push notification | `app` (`Messages`), `title`, `text`, `icon` (`bell`), `time` (`now`), `position` (`top-center`) |
| `icon` | Large icon that pops and floats | `icon` (`star`), `label`, `color`, `size` (18), `position` (`center`) |
| `badge` | Pulsing pill such as "NEW" | `text`, `icon`, `color` (red), `position` (`top-right`) |
| `counter` | Number counting up | `value`, `prefix`, `suffix`, `decimals` (0), `locale` (`es-ES`), `label`, `seconds` (1.2), `position` (`top-center`) |
| `cta` | Subscribe button that is "clicked" | `text` (`Subscribe`), `doneText` (`Subscribed`), `icon` (`bell`), `clickAt` (1 s), `color`, `position` (`bottom-center`) |
| `sidePanel` | Horizontal-first: panel next to the speaker, items revealed one by one | `title`, `items[]`, `icon` (`check`), `side` (`right`), `color` |
| `ticker` | Horizontal-first: news bar with a looping scroll | `label` (`Live`), `text`, `color`, `speed` (1), `position` (`bottom` or `top`) |

**Screens** (full frame; speech audio continues). `transition`: `fade` (default, 0.2 s), `slide` (from below), `wipe` (left to right), `zoom` (scales into place); motion transitions take 0.3 s and mirror on exit.

| `type` | Use | Props |
|---|---|---|
| `title` | Title card | `text`, `kicker`, `subtitle` |
| `chapter` | Numbered chapter | `number`, `title`, `subtitle` |
| `quote` | Quotation | `quote`, `author` |
| `list` | Items revealed one by one | `title`, `items[]`, `icon` (`check`), `color` |
| `stat` | Big counting figure | `value`, `prefix`, `suffix`, `decimals`, `locale`, `label`, `note`, `seconds` (1.4) |
| `compare` | Two panels with "VS"; stacked in vertical video | `title`, `left`/`right`: `{label, text, items[], color}` |
| `kinetic` | Words pop in one by one | `text`, `highlight[]` |
| `breaking` | "Breaking news" card with a looping ticker | `label` (`Breaking`), `title`, `text`, `ticker`, `color` |
| `image` | Photo of the news/person or a screenshot, slow Ken Burns push | `src` (file in `public/` or URL), `fit` (`cover`; `contain` adds a blurred fill), `title`, `caption`, `credit`, `kenBurns` (true) |
| `split` | Horizontal-first: text on one half, icon or counting figure on the other | `kicker`, `title`, `text`, `icon` (`bulb`) or `value` + `prefix`/`suffix`/`decimals`/`locale`, `label`, `side` (`left`), `color` |
| `timeline` | Horizontal-first: numbered steps on a growing line | `title`, `steps[]` (strings or `{label, text}`), `color` |

In horizontal video, place `sidePanel` opposite the speaker and keep `ticker` to 5–10 s. Large titles (`title`, `chapter`, `breaking`, `stat`, `split`, `kinetic`) shrink so the longest word fits the frame; still check very long titles.

**Icons** (`icon` prop; `<Icon name size color/>` in custom components): `check`, `x`, `alert`, `info`, `question`, `star`, `bolt`, `heart`, `fire`, `arrowRight`, `arrowLeft`, `arrowUp`, `arrowDown`, `trendUp`, `trendDown`, `clock`, `bulb`, `cpu`, `money`, `bell`, `play`, `thumbsUp`, `lock`, `search`. Inline SVG; no packages or network.

**Theme** (`theme` in `edit.js`, or per item to override): `{preset, primary, secondary, tertiary}`. 14 presets, each with its own animated background, type and panel style, all working in vertical and horizontal video: `default`, `neon`, `aurora`, `editorial`, `bold`, `terminal`, `cinematic`, `blueprint`, `pastel`, `brutalist`, `luxe`, `hud`, `comic`, `mono`. `primary` drives kickers, icons and lines (and the background tint in derived presets), `secondary` drives figures, highlighted words and the active caption word, `tertiary` drives the third element. `accent`/`highlight` are aliases of primary/secondary. Text stays readable with any colors (automatic fallbacks; explicit `background`/`text` are kept and the validator warns below 4.5:1). Descriptions, use cases, every variable and how to show the presets: [references/themes.md](references/themes.md). `fontFile` in `edit.js` loads a local font and puts it first in `theme.font` for captions and components.

**Pick the theme before planning screens.** Use a saved or stated preference if there is one. Otherwise suggest 2–3 presets that fit the topic, render the `ThemeSheet` (or `ThemeSheetVertical`) still and show it to the user, and save the choice as a preference afterwards.

To add a component, write it in `components.jsx`, register it in `OVERLAYS` or `SCREENS`, add a sample to `galleryItems` (or `horizontalItems`), and document it here. The validator reads the registries, so new types are recognized automatically.

**Layout check in Studio** (verified): the frame is `.remotion-studio-composition-container`. Pause first; `Shift+ArrowRight`/`Shift+ArrowLeft` move 1 s. Studio keeps neighboring sequences mounted, so only measure elements where `checkVisibility({visibilityProperty:true})` is true, and not on an item's first frame (entrances start off-screen). `@remotion/media` draws video to a canvas, so there is no `<video>` element to inspect; use `performance.getEntriesByType("resource")` to see which file is loaded.

## 7. Render and verify

Only render when the edit is ready **and the user has approved the Studio preview**. Use the output location the user requests.

```powershell
npx.cmd remotion render src/index.jsx EditedVideo "<OUTPUT.mp4>" --concurrency=4
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of json "<OUTPUT.mp4>"
ffmpeg -v error -i "<OUTPUT.mp4>" -f null -
```

- Renders use the original source. `--props="{\"proxy\":true}"` renders from the proxy for a fast low-resolution preview; add `--scale=0.5` or similar to shrink the frame.
- If downloading Chrome Headless Shell fails with `unable to verify the first certificate`, do not disable TLS. Reuse an installed one: `--browser-executable="<PROJECT_OR_SIBLING>/node_modules/.remotion/chrome-headless-shell/<version>/win64/chrome-headless-shell-win64/chrome-headless-shell.exe"`. With shared dependencies, one browser download serves every project.
- Confirm audio and video streams, the expected duration and a full decode. Visually inspect captions, overlays, zooms and each cut, and listen to the joins: decoding alone cannot validate speech. Report unverified checks; do not call an incomplete render successful.
- Full-quality 4K renders take many minutes (see lessons); run them only after approval, in a visible console, and stop duplicate renders that compete for CPU.
