---
name: video-editor
description: Edit local videos with Remotion Studio in Aki Desktop, showing a headed preview while the user reviews requested cuts, captions, overlays, screens, and zooms.
---

# Video editing with Remotion

Run locally in Aki Desktop. Keep the video project in the agent workspace, outside this skill and other repositories. Keep the original media unchanged. Do not commit generated videos, transcripts, or project data. Do not commit or push skill changes unless the user asks.

## Always show the result in Remotion Studio

Every edit step must be visible to the user in Remotion Studio, in a headed, visible browser tab (Aki Desktop's integrated browser, tab activated). Open Studio right after creating the project and keep it open. After each change (cuts, captions, overlays, screens, zooms, silence plan), reload or let hot-reload update the composition, then confirm the new duration and playback in that tab before reporting. Do not report results only as files or a rendered MP4: the Studio preview is the primary deliverable and the render is produced afterwards for approved edits.

## 1. Create and open the project

Requirements: Node.js, npx, FFmpeg and ffprobe on PATH. The project generator uses the video's actual dimensions, frame rate and duration. It copies the source to the new project and optionally imports a transcript with word timestamps.

```powershell
node <SKILL_DIR>/scripts/create-project.cjs "<VIDEO>" "<NEW_PROJECT_DIR>" "<TRANSCRIPT_JSON>"
cd "<NEW_PROJECT_DIR>"
npm install
```

Omit the transcript argument if it is not available. The target directory must not already exist. The optional transcript must correspond to the exact source video, and contain `segments[].words[]` with `word`, `start`, and `end` in seconds; `probability` is optional. A transcript for an earlier cut is not synchronized with the original. The generator reports project metadata and word count as JSON and fails on missing timed words.

Use the local `video_transcription` skill for a new transcript if available: read its instructions and request word timestamps. Otherwise obtain an equivalent word-timed transcript locally. Remotion displays captions; it does not itself guarantee recognition accuracy.

Start Studio in a **visible, independent console**, not in a tool-owned background command that ends with the turn. On Windows, from a PowerShell session use:

```powershell
Start-Process -FilePath "powershell" -WorkingDirectory "<NEW_PROJECT_DIR>" -ArgumentList '-NoExit','-Command','npx.cmd remotion studio src/index.jsx --port 3333 --no-open' -WindowStyle Normal
```

`npx.cmd` avoids PowerShell's script-execution-policy problem with `npx.ps1`. Keep that console open; check its output and the actual port. Do not start a duplicate server when the project is already running. The console process should outlive the agent turn; closing the console stops Studio.

Open `http://localhost:3333/EditedVideo` in Aki Desktop's integrated browser and **activate/show the tab**. Any browser used to show the user the work must be headed and visible; headless rendering does not count as a user preview. Verify the video image and playback. Studio in this environment listened on all network interfaces; do not assume the project or source media is private from other network clients.

If npm/Corepack cannot validate the registry certificate, use the system's trusted certificate configuration; do not disable TLS verification. If npm is a broken Corepack shim, this alternative was verified with an available npx: `npx.cmd --yes npm@10.9.2 install --no-audit --no-fund`. Report the real error if installation fails.

## 2. Review, cut and caption

Show the unedited source first. Obtain the user's requested edits and preserve the original project. The generated `src/edit.js` is the edit plan. It starts with one clip, no visual effects, and captions only if a transcript was provided.

```js
// Example fields within the exported object; seconds refer to the source video for clips.
clips: [{start: 0, end: 5.9}, {start: 6.8, end: 12}],
// All following times refer to the edited output timeline.
zooms: [{start: 1, end: 3, scale: 1.12, ramp: 0.4}],
overlays: [{start: 0.5, end: 3, type: "callout", text: "Key point"}],
screens: [{start: 8, end: 10, type: "title", text: "New screen"}]
// Optional: theme: {accent: "#3d8bff"}. Types and props: see "Component library".
```

Each clip has an inclusive start and exclusive end, converted to frames. Their order defines the result; the interval between clips is removed. `Sequence` and `Video trimBefore` implement the cuts. Studio hot-reloads edits; show the user each requested change and inspect the join with audio. Word timestamps are estimates and frame rounding affects boundaries: listen around both sides of each cut and adjust. Do not assume a transcript or successful render proves a syllable was cut correctly.

The generator converts timed words to Remotion's `Caption` fields. `@remotion/captions` groups them into short pages and highlights the currently timed word. Captions use each clip's source time, so the second clip remains synchronized after a cut. The full-screen screen replaces the picture and captions for its duration while audio continues. Review transcription spelling, timing and contrast in the preview. `@remotion/captions` can also import SRT/VTT; phrase-level timestamps cannot provide exact word highlights. See [captions](https://www.remotion.dev/docs/captions) and [timing](https://www.remotion.dev/docs/timing).

### Silence cutting (be aggressive by default)

Unless the user asks to keep pauses, remove silences systematically with the bundled planner; do not hand-pick a few long pauses.

```powershell
node <SKILL_DIR>/scripts/plan-silence.cjs "<VIDEO>" "<TRANSCRIPT_JSON>" "<NEW_PLAN.json>"
```

It runs FFmpeg `silencedetect` (`-35dB`, minimum 0.5 s), trims 0.08 s of each silence boundary (this leaves a short natural pause), and removes any part within 0.08 s of a transcript word. Cuts shorter than 0.2 s are dropped. It outputs `cuts`, `clips` (source seconds, ready for `edit.js`) and the resulting duration; the output file must not exist. Then remap every `zooms`, `overlays` and `screens` time from source time to output time with the clips; those fields are on the output timeline.

Lesson from `clip-a.mp4` (237.6 s, one speaker): a conservative first pass (silences of at least 1.2 s, a 0.23 s margin, discarding any cut that touched a word guard) removed only 14 pauses and left 194.1 s. The user rejected it as leaving many silences. The 0.5 s threshold with the word-guard split produced 45 cuts and 149.8 s from 50 detected silences. **Confirmed default sensitivity (approved by the user on `clip-a.mp4`):** `-35dB`, minimum silence 0.5 s, 0.08 s kept at each silence edge, 0.08 s word guard, minimum cut 0.2 s. Use these values unless the user asks otherwise. Tune upward only if the speech sounds clipped when listening to the joins. Silence detection depends on the recording's noise floor; re-check `-35dB` on noisy audio.

### When the word guard fights the cut (measured on `clip-b.mp4`)

`clip-b.mp4` (252.9 s, 720×1280, 30 fps) exposed a failure mode that the planner alone does not show. With the approved parameters the plan cut 40 pauses and left 194.3 s, but the rendered audio still had **40+ pauses of 0.45–0.9 s**. Two causes, both measured:

1. **`silencedetect` needs one unbroken silence.** A pause broken by a noise spike into 0.2 s fragments never reaches the 0.5 s minimum, so it is never proposed. Detecting with `d=0.25` found 85 pauses instead of 57.
2. **Word spans are stretched into the pauses.** faster-whisper places word starts earlier and ends later than the audio. A 0.08 s guard around those spans re-extends every cut back into the silence, so the pause survives the cut. Diagnosed with a counter: 49 of 49 detected pauses were "blocked by a word", and every blocked word sat entirely inside silence. Do not treat the transcript as ground truth for boundaries; the audio is.

Verified fix (final: **175.2 s, 30.7 % removed, 0 pauses over 0.40 s, no word cut**):

1. Detect silences on the original audio with `-35dB`, `d=0.25`, keep 0.07 s at each edge.
2. Build clips as the complement of the silences — do not extend a clip to a word span.
3. Clamp a cut to a word boundary only when the word boundary is inside the pause, and never let the clamp grow the clip past the silence edge.
4. Run a second pass on the joined audio: re-detect, subtract what is still silent, repeat until a pass removes nothing (2 passes were enough here).
5. Audit before trusting the plan: for each word whose span overlaps a removed region, measure the audio of the removed slice only (not the whole span, which contains real speech). It must sit below the gate. A word span that reads −34 dB over 0.8 s can be mostly silence with speech only at the start; confirm with 0.1 s windows before touching the threshold.
6. Verify the result, not the plan: render the joined audio with the same clips and run `silencedetect` on it. Target **zero pauses over 0.40 s** and report the longest remaining pause. A plan that looks aggressive can still leave audible dead air.

Noise floor matters: measure it before trusting `-35dB`. On `clip-b.mp4` the pauses peaked at −33 dB (breath and room tone) while speech averaged −25 dB, which is why the −35 dB gate fragmented the pauses. Raise the threshold toward the floor only if the audit in step 5 stays empty.

## 3. Visual effects

`zooms` animates scale in and out with Remotion interpolation and easing. `ramp` is seconds at each end and is shortened for short events. `overlays` draw a component over the video; `screens` display a full-frame component while retaining the speech audio. Text, timing, content, and additional effects must reflect the user's request.

### Component library (`src/components.jsx`)

Every project includes ready-to-use components. Choose one with `type` in each `overlays`/`screens` item; the remaining fields are its props. Items without `type` use `callout` (overlay) or `title` (screen), so older plans with only `text` still work. An unknown `type` or icon name throws an error listing the valid names, which Studio shows on screen. Sizes scale with the shorter side of the video, so the same item works for vertical and horizontal videos. Each item has a spring entrance and fades out during its last 0.3 s; screens fade in and out over 0.2 s. Overlays are drawn above screens, and captions are hidden while a screen is shown.

To preview them, open the `Gallery` composition in Studio (`http://localhost:3333/Gallery`). It shows every general component and alert variant for 3 s each, at the project's size, and labels each one with its `type`. `GalleryHorizontal` (`http://localhost:3333/GalleryHorizontal`, always 1920×1080) shows the horizontal components first and then all general components in landscape. Use them to let the user pick styles before placing them on the edit.

Large titles (`title`, `chapter`, `breaking`, `stat`, `split` and `kinetic`) shrink their font automatically so the longest word fits the frame. This was added after "DESARROLLADORES" in `kinetic` overflowed a 720 px vertical frame. Normal text wraps on its own. Still check very long titles in the preview.

**Overlays** (`overlays[]`, output timeline). `position` accepts `top-left`, `top-center`, `top-right`, `center-left`, `center`, `center-right`, `bottom-left`, `bottom-center` or `bottom-right`. `bottom-*` stays above the captions (26% from the bottom).

| `type` | Use | Props (default) |
|---|---|---|
| `callout` | Short key-point box | `text`, `color`, `position` (`top-left`) |
| `lowerThird` | Name/title bar that wipes in | `title`, `subtitle`, `color`, `position` (`bottom-left`) |
| `alert` | Info/success/warning/error card; warning and error shake once | `variant` (`info`), `title`, `text`, `icon`, `position` (`top-center`) |
| `notification` | Phone-style push notification | `app`, `title`, `text`, `icon` (`bell`), `time` (`now`), `position` (`top-center`) |
| `icon` | Large icon that pops and floats | `icon` (`star`), `label`, `color`, `size` (18), `position` (`center`) |
| `badge` | Pulsing pill such as "NEW" | `text`, `icon`, `color` (red), `position` (`top-right`) |
| `counter` | Number counting up | `value`, `prefix`, `suffix`, `decimals` (0), `locale` (`es-ES`), `label`, `seconds` (1.2), `position` (`top-center`) |
| `cta` | Subscribe button that is "clicked" | `text` (`Suscribite`), `doneText` (`Suscripto`), `icon` (`bell`), `clickAt` (1 s), `color`, `position` (`bottom-center`) |

**Screens** (`screens[]`, output timeline):

| `type` | Use | Props |
|---|---|---|
| `title` | Title card | `text`, `kicker`, `subtitle` |
| `chapter` | Numbered chapter | `number`, `title`, `subtitle` |
| `quote` | Quotation | `quote`, `author` |
| `list` | Items revealed one by one | `title`, `items[]`, `icon` (`check`), `color` |
| `stat` | Big counting figure | `value`, `prefix`, `suffix`, `decimals`, `locale`, `label`, `note`, `seconds` (1.4) |
| `compare` | Two panels with "VS"; stacked in vertical videos, side by side in horizontal | `title`, `left`/`right`: `{label, text, items[], color}` |
| `kinetic` | Words pop in one by one | `text`, `highlight[]` (words shown in the highlight color) |
| `breaking` | "Breaking news" card | `label` (`Breaking`), `title`, `text`, `ticker` (scrolling text), `color` |

**Horizontal video components** (16:9; prefer them for horizontal projects). They also render in vertical video, but they are designed for landscape:

| Kind / `type` | Use | Props (default) |
|---|---|---|
| overlay `sidePanel` | Panel covering a third of the frame next to the speaker, with items revealed one by one | `title`, `items[]`, `icon` (`check`), `side` (`right`), `color` |
| overlay `ticker` | News bar with a red label and scrolling text | `label` (`En vivo`), `text`, `color`, `speed` (1), `position` (`bottom` or `top`) |
| screen `split` | Text on one half and a large icon or counting figure on the other; stacked in vertical video | `kicker`, `title`, `text`, `icon` (`bulb`) or `value` + `prefix`/`suffix`/`decimals`/`locale`, `label`, `side` (`left` = text on the left), `color` |
| screen `timeline` | Numbered steps connected by a line that grows; vertical column in vertical video | `title`, `steps[]` (strings or `{label, text}`), `color` |

In horizontal video, place `sidePanel` on the side opposite the speaker, and keep `ticker` short (5–10 s); the ticker sits below the captions.

**Icons** (`icon` prop; also `<Icon name size color/>` for custom components): `check`, `x`, `alert`, `info`, `question`, `star`, `bolt`, `heart`, `fire`, `arrowRight`, `arrowLeft`, `arrowUp`, `arrowDown`, `trendUp`, `trendDown`, `clock`, `bulb`, `cpu`, `money`, `bell`, `play`, `thumbsUp`, `lock`, `search`. They are inline SVG, so no packages or network are needed.

**Theme.** Add an optional `theme` object to `edit.js` to change all components, or set `theme` on a single item. Keys and defaults: `accent` `#3d8bff`, `highlight` `#ffe456`, `background` `#0c1831`, `background2` `#1d3b73`, `card` `#112b52`, `text` `#fff`, `muted` `#b9c6dd`, `font` `Arial, Helvetica, sans-serif`.

```js
theme: {accent: "#ff5a1f"},
overlays: [
  {start: 1, end: 4, type: "lowerThird", title: "Jane Doe", subtitle: "AI engineer"},
  {start: 6, end: 9, type: "alert", variant: "warning", title: "Careful", text: "This uses a lot of memory"},
  {start: 12, end: 15, type: "counter", value: 1250000, prefix: "$", label: "Announced investment"},
  {start: 20, end: 23, type: "icon", icon: "bulb", label: "Idea", position: "center-right"}
],
screens: [
  {start: 30, end: 34, type: "list", title: "Three keys", items: ["Data", "Model", "Evaluation"]},
  {start: 40, end: 43, type: "stat", value: 93.5, decimals: 1, suffix: "%", label: "accuracy"}
]
```

Layout check in Studio (verified): the frame is `.remotion-studio-composition-container`. Pause playback first, then `Shift+ArrowRight` and `Shift+ArrowLeft` move 1 s. Studio keeps neighboring sequences mounted, so only measure elements where `checkVisibility({visibilityProperty:true})` is true. Measure inside each item, not on its first frame, because entrance animations start off-screen. Compare the text rectangles with the container to detect overflow without relying on screenshots.

Placement guidelines: give an overlay at least 2.5 s so it can be read, and a list or kinetic screen about 0.5 s per item or word plus 1.5 s. Avoid overlapping two overlays in the same position. Place screens where the speaker is not showing something important on camera, and only use figures that the speaker actually says. To add a new component, write it in `components.jsx`, register it in `OVERLAYS` or `SCREENS`, add a sample to `galleryItems` (or `horizontalItems` if it is horizontal-first), and document it here. For richer visuals or images, extend the composition with Remotion components and keep the user-facing preview current; do not claim unsupported controls are automatic. Studio edits are backed by React source rather than a separate conventional editor project. See [interactivity](https://www.remotion.dev/docs/studio/interactivity) and [effects](https://www.remotion.dev/docs/effects).

## 4. Render and verify

Only render when the requested edit is ready. Use the output location requested by the user; for this development session test results go into the designated Result folder. Example:

```powershell
npx.cmd remotion render src/index.jsx EditedVideo "<OUTPUT.mp4>" --scale=0.5 --concurrency=2
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of json "<OUTPUT.mp4>"
ffmpeg -v error -i "<OUTPUT.mp4>" -f null -
```

If a render fails with `unable to verify the first certificate` while downloading Chrome Headless Shell, do not disable TLS. Reuse an already installed one with `--browser-executable="<PROJECT_OR_SIBLING>/node_modules/.remotion/chrome-headless-shell/<version>/win64/chrome-headless-shell-win64/chrome-headless-shell.exe"` (verified for a sibling project; `--concurrency=4` rendered a 149.9 s 720×1280 preview in about 3 minutes).

`--scale=0.5` is a lower-resolution preview, not the final-quality default. Remotion may download its headless render browser on the first export; the user-facing Studio remains headed. Confirm the file has audio/video and expected duration, fully decodes, and visually inspect captions, overlays, the zoom and each cut. Listen to the cut joins; decoding alone cannot validate speech. Report unverified checks and do not call an incomplete render successful.

## Large sources (4K / 60 fps)

For `clip-a.mp4` (2160×3840, 60 fps, 237.6 s) keep two projects: a `preview` one using a 720×1280, 30 fps proxy of the same duration for fast Studio review, and a `final` one pointing at the original. Apply the same `edit.js`/captions to both. A 2 s test export of the 4K/60 fps project took about 46 s including preparation, and Remotion estimated about 36 minutes for the full video; run full-quality exports only when the user approves the preview, in a visible console, and stop duplicate exports that compete for CPU.

## Verified development sample

Using the previously prepared 1119 tight video and its matching word-timed transcript, a Remotion 4.0.546 project showed two clips separated by a removed interval, grouped word captions, a text overlay, a full-screen card and an animated zoom. Studio preview displayed the composition. A 25.6 s preview was rendered at 360×640 with audio and video, and fully decoded without FFmpeg errors. A separately generated project using the reusable template also exported an 11.115 s preview with both streams and passed a full decode. The visual result and cut audio still require user review. This measurement is one sample, not a performance guarantee.
