---
name: video-editor
description: Edits video files locally with FFmpeg — inspect orientation, length and content type, remove silence with an adjustable tightness profile, clean the spoken script, transcribe with a sibling skill or cached local faster-whisper fallback, review and correct a transcript, burn duration-bounded subtitles, add HTML-rendered callouts, badges, screenshots and b-roll cutaways, punch-in zooms and split person/content layouts, trim, concatenate, extract or replace audio, transcode for delivery, and export still frames — without uploading media anywhere. Use when a user asks to cut, join, compress, resize, mute, re-voice, de-silence, caption, enhance or inspect a video, wants key points, images or graphics shown over a talking head, or needs frames or a contact sheet from one.
---

# Video Editor

> **Status: experimental.** Under active development. The pipeline is tested end-to-end on real recordings, but thresholds and heuristics still change between runs. Verify the output before delivering it.

Local, deterministic video editing with FFmpeg. Nothing is uploaded: the scripts call `ffmpeg` and `ffprobe` on the user's files.

## Requirements

| Task | Needs |
|---|---|
| All scripts | `ffmpeg` and `ffprobe` on `PATH`, Python 3.9+ |
| Encoding H.264 / H.265 | An FFmpeg build with `libx264` / `libx265` (the default Gyan, Homebrew and distro builds have them) |
| `enhance` (components) | Node 22+ (native `WebSocket` and `fetch`) and Edge or Chrome discoverable by the renderer |
| Local ASR fallback | `faster-whisper`; the default transcriber uses the sibling `video_transcription` skill when it is installed |

No Python packages are required for the FFmpeg-only operations: they use the standard library. The optional local ASR fallback needs `faster-whisper` and an already cached model unless `--download-model` is explicitly supplied. `ffmpeg_lib.tool_path` honors `FFMPEG_PATH` and `FFPROBE_PATH` when the binaries are not on `PATH`.

## Workflow: always recon before cutting

The first three questions about any new file are answered by `analyze`, not by guessing:

```bash
python3 scripts/analyze.py INPUT --sheet video-output/contact.jpg --json video-output/report.json
```

| Question | Where it comes from |
|---|---|
| Vertical or horizontal? | `orientation.kind`, computed from the **displayed** size after applying any rotation flag |
| How long is it? | `duration_seconds` plus a coarse `duration_class` |
| Full screen, animation, or filmed? | `content.segments`, a timeline of per-sample labels |

Add `--sheet` and the script also writes a contact sheet: a grid of the sampled frames. **Look at it.** The content labels are a heuristic over measured frame statistics, useful for narrowing the question, but the picture is what decides. A clip that starts as a slide deck and ends on a webcam is reported as `mixed` with both segments timed, which is the case that matters when planning an edit.

`analyze` also reports letterbox/pillarbox bars, so a 16:9 file with a 25% black bar on top is measured as its real content aspect instead of its container aspect.

## Operations

One CLI, one subcommand per operation. Every subcommand prints a readable report, accepts `--json PATH` to write the same data, and exits nonzero with FFmpeg's own stderr on failure.

| Command | What it does |
|---|---|
| `analyze` | Recon: orientation, length, framing bars, content segments, optional contact sheet. |
| `silence` | Detects silence and rebuilds the cut without it. `--plan-only` shows the cut plan first. |
| `transcribe` | Uses `video_transcription` when installed, otherwise can fall back to local faster-whisper and writes a timecoded script. |
| `audit` | Finds where the script stops making sense (swallowed speech, abandoned clauses, repeats) and can re-listen each window in isolation. |
| `script_read` | Turns a transcript into a word-indexed script plus an empty cut list to fill by hand. |
| `script_cut` | Applies a hand-written cut list (word indices or seconds) and rebuilds the video. |
| `subtitles` | Subtitle pass: `review` flags words to correct, `build` writes timed SRT + ASS with measured placement, `burn` renders them. |
| `enhance` | Enhancement pass: renders HTML components (callouts, badges, screenshots, b-roll) with alpha, adds punch-in zooms and split layouts, checks them against the face and the subtitle band, and composes everything plus the subtitles in one encode. |
| `trim` | Cuts a time range out of one file. `--copy` for speed, default re-encodes for frame-accurate cuts. |
| `concat` | Joins several files in order. `--copy` requires identical codec, size and frame rate. |
| `audio` | `--operation extract` writes the audio track; `--operation replace --replace FILE` swaps it and copies the video stream. |
| `transcode` | Re-encodes to H.264 or H.265 MP4 for delivery, with optional downscale, fps cap and audio normalization to stereo AAC. |
| `frame` | Exports one still frame as a thumbnail or as visual verification of an edit. |

### analyze

```bash
python3 scripts/analyze.py INPUT --samples 12 --sheet video-output/contact.jpg
```

| Flag | Default | Notes |
|---|---|---|
| `--samples` | `12` | Frames to sample. Capped at 12; lower it on very long files to trade coverage for speed. |
| `--sheet` | unset | Writes a contact sheet JPEG of the sampled frames |
| `--json` | unset | Writes the full report, including per-frame metrics |

Frames are grabbed by seeking to each timestamp, not by decoding the whole file, so a 4K file costs about the same as a 720p one.

The content labels are `screen-recording`, `animation`, `filmed` or `unclear`, decided per sample in two steps: texture (luma spread plus entropy) separates camera footage from synthetic frames, then saturation separates saturated animation from desaturated UI. Both thresholds are calibrated against measured samples, and the JSON keeps the `texture` and `saturation_signal` values so a wrong label can be traced to the number that caused it.

### silence

```bash
# 1. Look at the plan before touching the file
python3 scripts/silence.py INPUT --plan-only --json video-output/silence-plan.json

# 2. Write a tighter, but still editable, cut. Use this chunked form on short-lived runners.
python3 scripts/silence.py INPUT --min-silence 0.8 --pad 0.08 \
    --chunked --chunk-seconds 8 --chunk-timeout 30 \
    --output video-output/tight.mp4 --json video-output/tight.report.json
```

Two stages, deliberately separate: `silencedetect` reports silent runs, those become a list of ranges to **keep**, and only then are those ranges trimmed and concatenated in one filter graph. Nothing is written in `--plan-only` mode.

| Flag | Default | Notes |
|---|---|---|
| `--noise` | `-30dB` | Silence threshold. Use `-35dB` or lower for a noisy room, `-25dB` for a quiet one. |
| `--min-silence` | `0.8` | Minimum silent run to remove. On the 253 s sandbox video this removed 67.3 s (26.6%), 21.7 s more than the previous `2.0` s / `0.20` s-pad edit. Use `0.6` s to cut more short pauses (74.8 s removed, 29.6%); use `1.0-1.5` s to preserve more natural pauses (52.8-61.5 s removed). |
| `--pad` | `0.08` | Silence retained on each side of speech. This is tighter than the old `0.15` s default; use `0.12-0.20` s for gentler pacing. A reduced pad trims silence around speech, not the words themselves. |
| `--chunked` | off | Encode short, closed MP4 clips and concatenate by stream copy. Use for long renders on execution hosts with short per-process limits. |
| `--chunk-seconds` | `8` | Maximum source seconds per clip with `--chunked`. If any chunk approaches the execution limit, lower this (e.g. 4-6 s); raise only after measuring. |
| `--chunk-timeout` | `30` | Maximum wall seconds per FFmpeg chunk, below the measured ~40 s outer limit. Lower `--chunk-seconds` if the timeout is reached. |
| `--start` / `--end` | whole file | Process a window only |
| `--plan-only` | off | Detect and print the timeline, write nothing |
| `--crf` / `--preset` | `20` / `veryfast` | Re-encode settings for the rebuilt file |

The rebuild re-encodes video and audio so every cut lands on an exact frame and the two streams stay aligned. `--chunked` encodes each kept range in short chunks and stream-copy concatenates them; every chunk is independently closed before the next starts. It refuses an empty output and more than 400 keep-ranges. The plan JSON records cut settings and whether chunking was requested. A cut profile changes only detected silence: it never auto-removes repeated words or phrases. Verify output with `ffprobe` and a complete decode; a present/nonempty MP4 is not proof that its container was finalized.

### Script pass: transcribe, audit, read, cut

After silence is gone, the recording is a script that still has to make sense. The deciding step is **not** automated on purpose.

```bash
# 1. Transcribe the already-cut video with the video_transcription skill
python3 scripts/transcribe.py tight.mp4 --output-dir video-output

# 2. Audit it: find the places where the script stops making sense
python3 scripts/audit.py video-output/tight.json --video tight.mp4 \
    --listen --output-dir video-output

# 3. Extract a word-indexed script and an empty cut list
python3 scripts/script_read.py video-output/tight.json --video tight.mp4 \
    --output-dir video-output

# 4. Read the .script.md and the .audit.md, write the cuts, then apply them
python3 scripts/script_cut.py video-output/tight.cuts.json --video tight.mp4 --plan-only
python3 scripts/script_cut.py video-output/tight.cuts.json --video tight.mp4 \
    --chunked --output video-output/final.mp4
```

**Transcribe the file you are going to cut.** Word timestamps are absolute, so transcribing the original and cutting the de-silenced version puts every boundary in the wrong place. Both `script_read` and `script_cut` warn when the transcript length does not match the video.

`transcribe` prefers the `video_transcription` skill: it locates `transcribe_video.py`, runs it and reshapes the JSON into a timecoded script. Lookup order is `VIDEO_TRANSCRIPTION_DIR`, then `skills/` and `skill/` next to this skill, then the same names above the working directory. Its `.venv` is used when present. If the sibling skill or its Python is unavailable, the built-in `local_transcribe.py` fallback uses an installed `faster-whisper` package when available. It defaults to the cached model under `/workspace/.cache/whisper` in this sandbox, CPU `int8`, two threads, and offline cache-only mode; it does not install packages or download weights unless `--download-model` is supplied. If no cached model exists, it fails clearly rather than waiting on a model download. In this sandbox the fallback prefers a cached `base` model for speed; pass `--model small` when a more accurate second pass is worth the additional runtime. The public flow remains usable without `faster-whisper` when the sibling skill is installed.

### Finding the cuts: `audit`

Reading alone misses two defects that show up in every real recording, and both are measurable:

| Signal | What it catches | How it is measured |
|---|---|---|
| `truncated` | A word the speaker **abandoned** mid-way | The recognizer wrote the token with an ellipsis (`"se arco..."`). It only emits `...` when it heard a word it could not finish decoding. |
| `collapsed` | Speech the recognizer **swallowed** | One word far longer than the median *and* low confidence. A token stretched to 1.86 s against a 0.26 s median is several words crammed into one. |
| `restart` | An idea abandoned to open another | A segment left without terminal punctuation **and** the next segment starting with a marker ("primero que nada", "es importante"). |
| `repeat` | The same content n-gram coming back | Function words ignored, so "que hay una" does not count as content. |
| `stutter` / `filler` | Repeated words, hesitation sounds | Adjacent identical tokens, known noise words. |

The first one is the case that reading cannot catch. In one test recording the transcript omitted an aborted start and stretched a single token to 1.86 s. The aborted start is invisible in the text and obvious in the timings.

`truncated` covers the opposite failure. In another test recording the transcript retained an unfinished word as a token ending in `...`. That ellipsis is the recognizer admitting it could not finish the word, so the trace is in the text. Measured across five transcripts, tokens with `...` appeared **only** where the speaker actually stumbled, and never in a corrected script.

`--listen` turns a candidate into evidence: it cuts that window, transcribes it **in isolation**, and prints what was really said with real word boundaries. A short clip has no long-recording context to make the recognizer skip a false start, which is exactly why it recovers speech the full-file pass dropped. **When `heard` and the transcript disagree, trust `heard` and cut by seconds** — the word index of a swallowed stretch points at the wrong boundaries.

Every candidate is a measurement, not a verdict. A trailing comma alone is *not* a signal: whisper splits on pauses, not sentences, so checking that flagged 26 of 28 candidates on a clean recording. Only the comma **plus** a restart marker is worth reporting. Numbers are excluded from `collapsed` on purpose: "64GB" and "3090" are read slowly and come back with low confidence without being swallowed speech. The duration floor is 1.6 s for the same reason: measured across the test recordings, real swallowed speech stretches a token to 1.86 s, while a name read slowly (`SpaceX,` at 1.34 s, confidence 0.47) stays under it.

The restart marker list is deliberately narrow, and that matters. Bare connectives are not restarts: `entonces tendría sentido...` continues the same argument, and `quién llega primero` merely contains the word "primero". A loose list turns continuations into false positives — measured on the test recording, adding `entonces` and `primero` produced two spurious candidates on a script that reads correctly. Only openers that genuinely abandon the thread ("primero que nada", "antes que nada", "lo importante") are listed.

The pass is self-checking: audit the recording before cutting and after. On both test videos the pre-cut audit reports 2 candidates and the post-cut audit reports 0, so a remaining candidate means a cut was missed.

### Judgement is the step, not a regex

`script_read` writes two things: the script (every word with an index and a timestamp, grouped by segment) and an empty `cuts.json`. Deciding what to cut is done by reading the script — a sentence that restarts, repeats a clause or loses the thread is a cut; a deliberate repetition carrying the argument is not. A phrase repeated because the video is *about* that phrase is correct speech, and no n-gram counter can tell the two cases apart.

`--hints` appends mechanical candidates (hesitation sounds, stutters, recognizer mumbles) in a separate section. They are hints to weigh while reading, never applied automatically.

Cuts are written by word index, which is stable and does not require computing seconds:

```json
{ "cuts": [
  { "from_word": 103, "to_word": 107, "reason": "aborted start, restarts at 108" },
  { "start": 41.2, "end": 43.9, "reason": "loses the thread" }
] }
```

| Flag | Default | Notes |
|---|---|---|
| `--pad` | `0.05` | Seconds added on each side of a cut, so the join does not clip a phoneme |
| `--plan-only` | off | Resolve and print the cuts, write nothing |
| `--only-reasons` | unset | Apply only cuts whose `reason` contains one of these tags |
| `--chunked` / `--chunk-seconds` / `--chunk-timeout` | off / `8` / `30` | Encode short MP4 parts and concatenate by stream copy; use on execution hosts that interrupt one long FFmpeg process. Lower chunk length if any part reaches its timeout. |
| `--transcript` | from the cut list | Override the transcript used to resolve word indices |

The result is re-transcribed once to confirm the sentence now reads correctly. That check is the point of the pass: the measurement is the transcript, not an assumption.

### Subtitle pass: review, correct, build, burn

The transcript is evidence, not a delivery file. Brand names come back spelled phonetically (`Corsor`, `Groc`, `Miarnes`), numbers come back as loose tokens, and the recognizer sometimes splits a figure into pieces. Fixing that needs the sentence around the word and what the video is about, so the correction step is a reading task with a prepared artifact, not a script.

```bash
# 1. Flag the words worth checking, with context, and open a correction file
python3 scripts/subtitles.py review video-output/final.json --output-dir video-output

# 2. Read the .subs-review.md, fill the .corrections.json

# 3. Build timed SRT + ASS; placement is measured from the frame
python3 scripts/subtitles.py build video-output/final.json \
    --corrections video-output/final.corrections.json --video video-output/final.mp4 \
    --output-dir video-output

# 4. Burn the styled ASS. Use --chunked on short-lived execution hosts.
python3 scripts/subtitles.py burn video-output/final.mp4 \
    --ass video-output/final.subs.ass --chunked --chunk-seconds 8 --chunk-timeout 30 \
    --output video-output/final_subs.mp4
```

#### What `review` flags, and why the rules are narrow

| Signal | Flagged because | Measured behaviour |
|---|---|---|
| low probability | The recognizer hesitated over the token | `p < 0.6` |
| `...` in the token | It could not finish decoding the word | Same signal `audit` uses for `truncated` |
| contains a digit | Numbers arrive split (`$60` `.000` `.000`) | Always worth a look |
| capitalized mid-sentence | A brand name, not a sentence start | See below |

Capitalization is only meaningful **inside** a sentence. Flagging every capitalized word marked `Porque`, `Ahora` and `Este` on a clean transcript — 68 of 408 words on a test recording, most of them noise. Checking that the previous token does not end in `.`/`?`/`!` and that the word is not at a segment start cut it to 51, and every remaining hit was a real proper noun or a brand.

Corrections are written in two forms, both keeping the original timings so text edits never move a cue:

```json
{
  "replacements": [{"from": "Corsor", "to": "Cursor", "reason": "brand name"}],
  "words": {"203": "arco"},
  "glue": [{"from_word": 176, "to_word": 177, "text": "3090", "reason": "split figure"}]
}
```

`replacements` rewrites every occurrence of a token; `words` overrides one token by index. The build report lists every applied change with its reason, so a wrong correction is visible rather than silent. When `--video` is supplied, reading-speed holds are capped at the last representable ASS centisecond within that video's probed duration. A transcript word starting at or after the end, or a cue that cannot fit one positive centisecond, is rejected instead of silently producing an out-of-range subtitle.

`glue` merges a run of tokens into one. The recognizer splits figures and decimals across words: `una 30 -90` and `$60 .000 .000 .000` arrive as separate tokens, and rewriting either half alone leaves the other on screen. Merging drops the absorbed tokens and stretches the first one to the end time of the last, so the cue does not end early and shorten the read. Measured on the test recordings: `30 -90` → `3090`, `4 ,5` → `4,5` (twice), `$60 .000 .000 .000` → `$60.000.000.000`.

#### Placement is measured, not guessed

`build` samples 6 frames, measures a 6x6 grid per frame, and takes the **median** per cell across samples. The frame is measured at a capped 720 px long side: every metric is a *share* of a cell, so scaling does not change the answer, but the pixel loops run in pure Python and a 3840x2160 frame costs about nine times a 720p one — measured, that turned a 5 s build into one that did not finish in two minutes. The JSON keeps the real `frame` and the `measured_at` size separately.

Two signals:

| Signal | What it finds | Why the median |
|---|---|---|
| skin share per cell | where the person is | a hand waving through one frame does not move the result |
| edge density per cell | UI text, slides, chat panels | same reason |

The layout is then classified, and the anchor chosen from where the person actually ends:

| Layout | Rule | Example |
|---|---|---|
| `no-person` | no cell reaches the skin threshold | screen recording, slides |
| `person-in-region` | some skin, but under 20% of the grid | webcam inset in a screen recording |
| `full-frame-person` | skin covers 20%+ of the grid | talking head |

The anchor is spatial: find the lowest grid row that still holds the person, then check whether the space below it fits a two-line block (about 12% of the height). If it does, the text goes at the bottom. If it does not, the text moves above the person instead of being stacked on their chest.

Two thresholds were corrected against real measurements, and both matter:

- **Absence is a local test, not a global average.** On the 4K recording the webcam inset covers about 2% of the frame, so the *total* skin share is 1.5% and a whole-frame threshold reported `no-person` while the face sat in one cell with a 0.29 skin share. The test is now "does any cell reach the threshold".
- **Coverage, not a cell count.** Counting cells above a cut-off put a full-frame talking head and a corner webcam in the same bucket depending on the day. The share of the grid that is skin separates them: the vertical talking head measures 0.31 coverage, the 4K webcam inset 0.06.

Letterbox bars from `analyze` are folded in: when the frame has a bottom bar, the margin is pushed past it so the text stays on the picture instead of floating in black.

#### Free space is not clean space

Finding room for the text is not the same as finding a readable background. On a screen recording the band under the webcam inset holds no person but is full of UI text and window chrome, and white subtitles land straight on top of it.

The mean edge density of the band the text will occupy decides the style:

| Band edge density | Style |
|---|---|
| under 5.0 | per-glyph outline (`BorderStyle 1`) |
| 5.0 or more | opaque box (`BorderStyle 3`, near-opaque fill) |

Measured on the test recordings, a screen recording with a webcam inset reads **5.65** and a vertical talking head on a dark set reads **3.5**, so the threshold sits between them. A per-glyph outline is not enough over UI: the outline follows each letter, so the panel edges running through the gaps between letters stay visible.

Both are reported in the JSON as `placement.background_edge` and `placement.needs_box`, so a wrong style is traceable to the measurement instead of being a mystery.

#### Text sizing is derived from the frame

`build` computes the line budget and the font size from the real pixel size, and refuses to trust a fixed number:

| Quantity | Rule | Why |
|---|---|---|
| font size | `min(width, height) * 0.05` | on a vertical clip the height is twice the width, so sizing off the height made the text wider than the frame and libass clipped it at both edges |
| characters per line | `(width - margins) / (font_size * 0.55)` | 42 characters is right for 1920 px and overflows at 720 px |

The 0.55 glyph-advance factor is measured, not assumed: 42 characters at 58 px overflowed a 720 px frame, which puts the real average near 0.55 rather than the 0.45 a naive estimate uses.

`build` validates what it wrote and reports reading problems instead of assuming success: cues under 0.4 s, faster than 20 characters per second, wider than the line budget, taller than two lines, overlapping or out of order. A cue that reads too fast borrows the pause that follows it, because holding text on screen during silence adds no words and only gives the viewer time to read them.

Some cues stay too fast even after borrowing the pause, when the speaker genuinely talks faster than the limit and the next cue starts immediately. That is reported, not hidden.

#### Reading the result

`build` writes the style into an ASS file with `PlayResX`/`PlayResY` pinned to the frame size. Burning an SRT through libass leaves the style relative to an unknown script resolution, so font size and margins become guesses; pinning them makes `FontSize` and `MarginV` mean pixels.

Always look at one burned frame before delivering. The numbers say where the box is; the picture says whether it lands on the chin, the microphone or a caption already in the footage.

```bash
python3 scripts/edit.py frame output_subs.mp4 --at 6 --output video-output/check.jpg
```

Burn one short clip first, not the whole file. A 12 s clip takes about 20 s to burn and answers every question the numbers cannot: whether the text clears the microphone, whether the box is too heavy for the shot, whether a caption already baked into the footage sits under the subtitle. Burning the full file before checking costs minutes and still has to be redone.

This check caught a real defect that no measurement flagged: on the 4K recording the subtitle landed on a Windows settings panel. The placement was correct — free space below the webcam inset — but the space was full of UI text, which is exactly the case the band edge density now detects.

### Enhancement pass: information and images

The third stage, after the cut (silence + script) and the subtitles. It adds what a viewer sees on top of the speaker, and every visual is an HTML/CSS/JS component rendered to a clip with alpha, so the same component works at any resolution and is reused across videos.

| On screen | Plan `type` | Built with |
|---|---|---|
| Card that remarks a key point | `callout` | `components/callout.html` |
| Icon, logo, banner or button over the footage, transparent background | `badge` | `components/badge.html` (`variant`: `pill`, `banner`, `button`; `src` for a logo PNG with alpha) |
| Screenshot or image card that slides in | `screenshot` | `components/screenshot.html` |
| Screen changes to an example image with a very slow zoom | `broll` | `components/broll.html` (linear Ken Burns, default 1.0 → 1.12) |
| Zoom on the speaker at a key moment | `punch` | FFmpeg crop + scale, no component |
| Person on one half, explainer on the other | `split` | FFmpeg crop + `components/split-panel.html` |

```bash
# 1. Write the plan against the FINAL transcript (word timestamps), then validate it
python3 scripts/enhance.py video-output/final.enhance.json --video video-output/final.mp4 --plan-only

# 2. Render, check, compose; the subtitles are burned in the same encode
python3 scripts/enhance.py video-output/final.enhance.json --video video-output/final.mp4 \
    --ass video-output/final.subs.ass --output video-output/final_enhanced.mp4 \
    --json video-output/final_enhanced.report.json
```

Run it on the cut that the subtitles were built from, and pass that ASS with `--ass` instead of running `subtitles burn` first: the delivery file is then one lossy generation away from the cut, and the subtitles land on top of every overlay instead of under it.

#### The plan

```json
{
  "accent": "#ffb020",
  "events": [
    {"type": "callout", "start": 0.06, "end": 3.6,
     "params": {"kicker": "The question", "title": "Will AI replace us?", "icon": "alert", "top": 0.015}},
    {"type": "punch", "start": 4.04, "end": 5.8, "zoom": 1.2, "center": [0.49, 0.37]},
    {"type": "split", "start": 15.72, "end": 26.1, "person": "bottom", "person_y": 0.17,
     "panel": {"params": {"kicker": "What is alignment?", "title": "AI that follows our values",
       "items": [{"icon": "flag", "text": "Its goals", "at": 2.72}]}}},
    {"type": "broll", "start": 52.9, "end": 58.6,
     "params": {"src": "assets/race.png", "caption": "Nobody wants to stop", "zoom_to": 1.12}}
  ]
}
```

`components/examples/enhance.example.json` demonstrates the original event types; its two images come from `stills.example.json` (below). The [component catalog](components/README.md) provides examples and settings for all components. Relative image paths resolve against the plan's folder.

| Field | Meaning |
|---|---|
| `start` / `end` | Seconds on the final cut. Take them from the word timestamps in the final transcript, not from segment boundaries: a card that appears on the word reads as intentional, half a second early reads as a mistake. |
| `params` | Passed to the component. Positions and sizes are shares of the frame (`top`, `x`, `y`, `w` from 0 to 1), so a plan is not tied to a resolution. |
| `component` | Any HTML file following the contract below; replaces the built-in one for that event. |
| `zoom`, `center` | Punch-in factor (1.0-2.0) and the point to zoom on, as shares of the frame. |
| `person`, `person_y` / `person_x` | Split side (`top`/`bottom` on vertical, `left`/`right` on horizontal) and where the person crop starts. |
| `items[].at` | Seconds after the panel opens when a list item appears: sync it to the word that names it. |

Use `--chunked --chunk-seconds 8 --chunk-timeout 30` when an execution host limits the wall time of one FFmpeg process. The enhancement is composed per output chunk: overlapping events and ASS cues are clipped to the chunk timeline, only relevant rendered clips are passed to FFmpeg, then the MP4 chunks are concatenated by stream copy. `subtitles.py burn` exposes the same chunk options for standalone subtitle burns; `--max-width` is not supported in its chunked mode, so transcode first if downscaling is needed. Component HTML renders still run before encoding; cache them and avoid repeating changed/unnecessary renders. As for any edit, validate duration and fully decode the final file.

`--plan-only` rejects with exit code 2 and one line per problem: a missing image or component, an event outside the video, `end` before `start`, a split side that does not exist for the orientation, an unknown type, and a punch or split overlapping another punch or split. Both rewrite the base picture, so two of them at the same moment are refused instead of composed in an undefined order. Overlays (cards, badges, b-roll) may sit on top of a split.

#### Layouts

- **Punch-in is a jump zoom.** A constant crop scaled back to the frame, cut in and out on the word. A smooth ramp would need a per-frame crop size, and FFmpeg's `crop` evaluates its size once per stream, so it is not implemented. Measured on the test recording at `zoom 1.2, center [0.49, 0.37]`: the top of the head moves from 240 px to about 320 px and the face fills more of the frame.
- **Split crops the person, it does not shrink them.** On a vertical frame the person keeps full width and a half-height window starting at `person_y`; the panel takes the other half. `person_y` comes from where the head starts: on the test recording skin begins at row 240 px (0.19 of the height), so `0.17` keeps the head with some air above it. Measured on the result: the top half has no skin, the person starts at about 650 px.
- **The panel is opaque from its first frame.** The person crop switches on a hard cut, so a panel that faded in would show the uncropped head behind it for the length of the fade. Only the panel content animates.
- The horizontal split (person `left`/`right`, panel on the other side) is implemented with the same code path but has not been run on a real horizontal recording yet.

#### Components and how to add one

```
components/
  overlay.css           shared base: transparent page, .life enter/leave, keyframes
  overlay.js            shared runtime: params from the URL hash, text slots, icons, positions
  callout.html  badge.html  screenshot.html  broll.html  split-panel.html
  scenes/race.html      illustration for a b-roll (render it as a still first)
  scenes/trend.html     labeled trend chart for a screenshot card, tagged as an illustration
  examples/enhance.example.json   a plan with every event type
  examples/stills.example.json    renders the two images that plan uses into examples/assets/ (git-ignored)
```

The contract a new component follows, so `enhance` can render it:

- The page **is** the frame: the renderer sets the viewport to the video size (the panel size for a split) and captures it with a transparent background. Whatever the component does not paint stays alpha 0.
- Include `overlay.css` and `overlay.js`. Params arrive as JSON in the URL hash; `data-p="title"` fills a text slot and removes it when the param is missing, `data-icon` inlines one of the built-in SVG icons, `img[data-src]` loads an image.
- Wrap the content in `.life`: it enters at 0 and leaves at the end of `--dur`, which the renderer sets to the event length.
- Size with `vmin` and position with shares of the frame. Pixel sizes break the moment the same plan runs on a 4K file.
- Animate with CSS animations, `setTimeout`, `requestAnimationFrame` or `performance.now`: the renderer replaces all of them with a virtual clock and steps it per frame, so a slow machine renders the same frames as a fast one. No Web Workers, no `<video>`.
- A `console.error`, an exception or an image that does not load fails the render with the message. An empty card is never reported as success.

Illustrations for `broll` and `screenshot` (`scenes/`) are rendered as stills with the same renderer, then passed as `src`:

```bash
# From the skill folder: render the example images, then validate the example plan against a cut
node scripts/overlay_render.js --jobs components/examples/stills.example.json
python3 scripts/enhance.py components/examples/enhance.example.json --video final.mp4 --plan-only
```

A job is `{"html", "params", "w", "h", "still": true, "at", "out"}` for a PNG, or `{"html", "params", "w", "h", "fps", "dur", "out"}` for a MOV clip; paths resolve against the working directory.

An illustration must not pass as evidence: `scenes/trend.html` tags itself `ILLUSTRATION` and says "not real data" unless told otherwise. Quote the speaker in captions instead of inventing a headline the video never showed.

#### Rendering

`overlay_render.js` starts one headless Edge or Chrome for all jobs, renders each component frame by frame on the virtual clock, pipes PNG frames to FFmpeg and writes a MOV with the PNG codec (`rgba`). `enhance` caches every clip under `<output>_renders/` with a key made from the component, the params, the size, the duration and the modification time of the component, the shared runtime and every local image. A second run re-renders only what changed.

Three defects found while rendering the test recording, all fixed and worth knowing because they look like success:

| Symptom | Cause | Fix |
|---|---|---|
| Render slowed from 4.5 s to 26.9 s per 105-frame clip, then one b-roll clip produced nothing for over 5 minutes | A fresh profile still opened extension welcome tabs, and headless Chromium throttles a tab it considers hidden | `--disable-extensions`, the throwaway profile is wiped on every launch (a reused one restored the old tabs), the render tab is brought to front with focus emulation, and every CDP call fails after 60 s with its method name instead of hanging |
| A 0-byte MOV at the final path after the hung render was killed | FFmpeg had created the file before any frame arrived | Clips are written to `.part` and renamed only after FFmpeg exits 0, so the cache never reuses a broken clip |
| A redrawn image kept its old render | The cache key used the image path, not its content | The image's modification time is part of the key |

Throughput depends on how much of the frame is painted, because each frame is a PNG screenshot:

| Clip | Frames | Time |
|---|---|---|
| Callout over transparent frame, 720x1280 | 106 | 4.5 s |
| Badge, 720x1280 | 155 | 6.5 s |
| Split panel, opaque, 720x640 | 311 | 28.5 s |
| B-roll, opaque full frame, 720x1280 | 171 | 23.0 s |

Opaque clips are also the large ones: the 10.4 s split panel is 73 MB as PNG-in-MOV. That is intermediate cache, not delivery, and it is deleted with the renders folder.

#### Checks: the render can succeed and still cover the face

After rendering, the middle frame of every overlay is compared with the footage in the same window, on a 9x16 cell grid (16x9 on horizontal):

| Check | Measured as | Warns above |
|---|---|---|
| Head overlap | Painted cells over the upper half of the skin rows | 10% |
| Subtitle band overlap | Painted cells over the two-line block computed from the ASS style (`Fontsize`, `Alignment`, `MarginV`) | 5% |
| Person overlap | Painted cells over all skin, including neck and hands | reported only |

The head is the upper half of the skin rows, not all of it, because skin includes the neck and the hands. A screenshot card over the chest and hands is fine, a card over the eyes is not, and one number for both warned about a card that covered only the chest. B-roll is skipped: covering the person is its purpose.

The checks caught six real problems on the first test run before anyone watched the video:

| Event | First run | Cause | After the fix |
|---|---|---|---|
| Callouts (5 of 6) | covered 12-26% of the person; the figure card reached the eyes | 6.6vmin titles, a 17vmin figure and a 6vmin shadow made the cards reach 320-400 px; the head starts at 240 px | Compact sizes: two title lines end at 214 px, a figure card at 237 px, shadow included. 0% head overlap on all six |
| Screenshot | covered 39% of the subtitle band | At `w 0.66, top 0.565` the card painted down into the 1120-1200 px row; the subtitle block starts at 1123 px | `w 0.5, top 0.585`: the card spans 743-1107 px. 0% subtitles, 0% head, 23% person (chest and hands) |

Shadows count as painted pixels, deliberately: a dark shadow over the forehead dims it as much as the card would.

Limits of the check, stated as facts: it samples the footage before zooms, so an overlay during a punch-in is measured against the unzoomed face; and it samples one overlay frame (the middle), so a component that moves across the frame is measured at one position.

#### What worked and what did not on the test recording

| | Result |
|---|---|
| Worked | 17 events (6 callouts, 3 badges, 1 screenshot, 1 b-roll, 4 punch-ins, 2 splits) over a 177.2 s cut; output duration exactly 177.2 s; subtitles burned over the splits, the b-roll and next to the screenshot (white pixels present in the subtitle band at 22 s, 55 s, 92 s and 120 s, absent in the unburned cut) |
| Worked | Split list items timed to the word that names them (`at` = word time − panel start) read as the speaker building the list |
| Worked | Caching: the corrected run re-rendered 7 clips and reused 6; render 42.8 s, encode 21.4 s, total 69.8 s |
| Did not | First-version cards sized for "readable", not for the free band: they covered the head. Size components against the measured free space, then let the check confirm |
| Did not | An opaque full-frame b-roll is the slowest and heaviest clip to render; keep cutaways short (5-6 s) |
| Open | Layout changes are hard cuts; there are no transitions, no smooth zoom ramps and no sound effects yet |

### Low-resolution previews

When a client wants to see whether an edit worked before paying for a full-quality render, produce a small preview:

```bash
python3 scripts/edit.py transcode final.mp4 --max-width 720 --crf 26 --preset veryfast \
    --output video-output/final_preview.mp4
```

**Cap by the long side, not the width.** `--max-width 720` does nothing to a vertical clip: a 2160x3840 phone video is already narrower than 720 px, so the "preview" keeps full resolution and only loses quality to CRF. Use `--max-height` for vertical footage:

```bash
python3 scripts/edit.py transcode vertical.mp4 --max-height 720 --crf 28 --preset veryfast \
    --output video-output/vertical_preview.mp4
```

**Do this when someone needs to watch the result, not as a routine step.** Intermediate passes should stay at full quality: re-encoding a preview and then cutting it again stacks two lossy generations on the final file. Use previews for review and delivery checks, and keep the full-quality master as the input for the next editing pass.


### trim

```bash
python3 scripts/edit.py trim INPUT --start 00:01:12 --duration 00:00:30 --output clip.mp4
python3 scripts/edit.py trim INPUT --start 90 --end 120 --copy --output fast.mp4
```

Times accept seconds (`90`), `MM:SS` or `HH:MM:SS.mmm`. `--end` and `--duration` are alternatives. The script refuses a start at or past the end of the file and clamps an end beyond it, reporting `clipped_to_input_end` in the JSON.

`--copy` remuxes without decoding (0.28 s for a 5 s cut in the measured run) but can only cut on keyframes, so the real start may drift from the requested one; the output duration in the report shows the result. Use the default re-encode when the cut must be exact.

### concat

```bash
python3 scripts/edit.py concat part1.mp4 part2.mp4 part3.mp4 --output final.mp4
```

Before joining, the script compares codec and pixel size across inputs and refuses `--copy` with a concrete list of mismatches. Without `--copy` it re-encodes, which still requires identical pixel size and frame rate — normalize first:

```bash
for f in part*.mp4; do python3 scripts/edit.py transcode "$f" --max-width 1920 --fps 30 --output "norm_$f"; done
```

### audio

```bash
python3 scripts/edit.py audio INPUT --operation extract --format wav --output audio.wav
python3 scripts/edit.py audio INPUT --operation replace --replace voiceover.wav --output voiced.mp4
```

Extraction supports `mp3`, `wav`, `aac`, `opus` and `flac`. Replacement copies the video stream untouched and cuts to the shorter of the two tracks (`-shortest`), so a short voiceover does not leave silent video trailing.

### transcode

```bash
python3 scripts/edit.py transcode INPUT --max-width 1920 --fps 30 --crf 23 --output web.mp4
```

| Flag | Default | Notes |
|---|---|---|
| `--codec h264\|h265` | `h264` | `h265` is tagged `hvc1` for Apple playback |
| `--crf` | `20` | Lower is better quality and bigger file; 18–23 is the useful delivery range |
| `--preset` | `medium` | `veryfast` cuts encode time sharply with a modest size penalty |
| `--max-width` | unset | Downscales only, keeps aspect ratio, forces even dimensions |
| `--width` / `--height` | unset | Exact size; one side alone keeps the aspect ratio |
| `--fps` | unset | Caps or converts the frame rate |
| `--no-audio` | off | Strips audio |

Output is always `yuv420p` H.264/H.265 with `+faststart`, which is what browsers, phones and most editors expect.

### frame

```bash
python3 scripts/edit.py frame INPUT --at 00:00:05 --output thumb.jpg
```

Useful to check a cut visually before delivering, and to produce thumbnails.

## Output layout

By default every operation writes into `./video-output/` next to the working directory; `--output` sets an exact path and `--output-dir` only the folder. Input files are never modified. Generated media is git-ignored and must not be committed.

## Measured runtimes

Single machine, FFmpeg 8.1.2 (Gyan build), Windows, local SSD. Use these as orders of magnitude, not promises.

| Operation | Input | Result | Time |
|---|---|---|---|
| `probe` | 253 s, 720x1280 HEVC, 185 MiB | metadata report | instant |
| `analyze` (12 samples) | same file | orientation, 1 segment, contact sheet | 1.8 s |
| `analyze` (12 samples) | 146 s, 3840x2160 H.264 | 2 segments, contact sheet | 7.6 s |
| `silence` ground-truth check | 11 s synthetic clip, silences at 2-5 s and 7-9 s | 6.6 s output, ranges cut exactly | 0.8 s |
| `silence --plan-only` | 253 s file | 44 silences, 43 keep-ranges | 1.5 s |
| Sandbox plan, previous edit `--min-silence 2.0 --pad 0.20` | 253 s, 480x854 H.264/AAC | 11 runs, 45.5 s removed (18%) | 2.1 s |
| Sandbox plan, `--min-silence 0.8 --pad 0.08` | same file | 30 runs, 67.3 s removed (27%) | 2.2 s |
| Sandbox plan, `--min-silence 0.6 --pad 0.08` | same file | 44 runs, 74.8 s removed (30%) | 2.4 s |
| Sandbox chunked enhancement | 24 s, 480x854, 2 overlays + 3 subtitle cues | 2 chunks; 24.056 s output | 47.4 s (components 38.0 s, encode 6.7 s) |
| Sandbox chunked split layout | same source, one split panel | 2 chunks; 24.056 s output | 6.0 s after panel render cache hit |
| Sandbox local transcript fallback | 24 s, Spanish, cached base, CPU int8 | 4 segments, 53 word timestamps | 6.3 s |
| Sandbox chunked silence edit | 24 s, 480x854, 4 silent runs | 18.356 s output; full decode passed | 5.2 s |
| `silence` full rebuild | same file | 184.3 s output, 68.8 s removed (27%) | 34 s |
| `silence` 60 s window | same file | 48.1 s output, 11.9 s removed | 3.5 s |
| `trim --copy` 5 s | same file | 3.8 MiB clip | 0.28 s |
| `transcode` `--max-width 720 --crf 26 --preset veryfast` | same file | 33.8 MiB MP4 | 20.7 s |
| `audio --operation extract --format wav` | same file | 42.5 MiB WAV | 0.44 s |
| `audio --operation replace` | 146 s, 3840x2160 H.264, 689 MiB | video copied, new audio | 5.3 s |
| `concat --copy` of two 5 s clips | same codec and size | 10.1 s clip | 0.35 s |
| `trim` 6 s re-encode `--preset veryfast --crf 24` | 146 s, 3840x2160 H.264 | 6.0 s clip | 3.4 s |
| `transcode` `--max-width 1920 --fps 30 --preset veryfast --crf 24` | that 6 s 4K clip | 1080p30 clip | 1.4 s |

Encode time scales with pixel count and frame rate: the 720p file re-encoded 253 s in 21 s, while the 4K clip needed 3.4 s for 6 s. Cap `--max-width` and use `--preset veryfast` before encoding long 4K files.

Subtitle timings, same machine and inputs:

| Operation | Input | Result | Time |
|---|---|---|---|
| `subtitles build` | 177 s, 720x1280, 549 words | 39 cues, placement measured | 6.5 s |
| `subtitles build` | 116 s, 3840x2160, 301 words | 21 cues, boxed style | 5.3 s |
| `subtitles build` | 142 s, 2160x3840, 405 words | 30 cues, placement measured | 6.6 s |
| `subtitles burn` | 12 s, 2160x3840 vertical | hard-burned MP4 | 21.7 s |
| `subtitles burn` | 20 s, 3840x2160 | hard-burned MP4 | 12.2 s |

Measurement is capped at a 720 px long side, which is what keeps a 4K build at 5 s instead of a run that does not finish in two minutes. Burning is the expensive step: it re-encodes every frame it decorates.

Enhancement timings, same machine, Edge headless, 177.2 s 720x1280 cut with 17 events:

| Operation | Result | Time |
|---|---|---|
| `enhance --plan-only` | 17 events validated, timeline printed | 0.15 s |
| `enhance`, first complete run | 8 clips rendered (5 more cached by an interrupted run), checks, one encode with subtitles | render 141.9 s, encode 21.2 s, total 174.8 s |
| `enhance`, after editing 6 callouts and the screenshot | 7 clips re-rendered, 6 reused | render 42.8 s, encode 21.4 s, total 69.8 s |

## Sandbox execution notes

The following behavior was measured in an Ubuntu sandbox with Python 3.12.3, Node 22.23.4, FFmpeg/ffprobe 6.1.1, libx264/libass and Chrome. These are environment-specific observations, not requirements for all users:

- A per-command outer executor interrupted long FFmpeg invocations around 40 s, leaving invalid MP4s. A 253 s, 480x854 H.264/AAC source with 13 sections was rebuilt by independently encoding short MP4 parts and concat-demuxing them. Use `--chunked --chunk-seconds 8 --chunk-timeout 30`; do not launch FFmpeg in a detached background process, because the caller can be interrupted while the detached process survives unpredictably. The `~40 s` observation is an outer limit, not a guaranteed process timeout. Chunk timeouts bound each FFmpeg invocation, not the full sequential Python operation; a single `exec_command` call is limited to 300 s here. If measured total work is likely to exceed the caller's limit, split work into separate bounded invocations and validate the final concat rather than assuming chunking bounds the whole job.
- The chunked enhancement path was verified on a 24 s synthetic 480x854 source with callouts, a badge, ASS cues spanning a chunk boundary, and a split-panel layout. Full FFmpeg decode passed; container duration was 24.056 s against a 24.033 s source. Video starts at 0.023 s from MP4 frame timing; audio starts at zero and remains within the 0.25 s acceptance tolerance.
- The chunked enhancement path was rerun with 8 s chunks, cache hits and full decode: both an overlays+subtitles render and a split-panel render completed in about 9-12 s. Video is stream-copied at concat; AAC audio is re-encoded once at concat to handle independent encoder priming. Check per-stream timing and full decode, not container duration alone.
- `ffmpeg -nostats -loglevel error` limits progress output in constrained command runners. `ffmpeg_lib.run_ffmpeg` writes to a same-directory, uniquely named temporary whose filename still ends in the output container suffix, renaming it to the requested path only after FFmpeg returns zero and the temporary is nonempty. Failed renders do not publish a partial at the final path; an externally killed process may leave a `.part-...` file.
- `python3` resolves to `/opt/aki-python/bin/python3` (Python 3.12.3) and imports `faster-whisper 1.2.1`; use that interpreter explicitly if another Python is placed first on `PATH`. The model cache is `/workspace/.cache/whisper`, with cached `base`/`small` snapshots; CPU `int8` works. The sibling `video_transcription` skill was absent. `transcribe.py` discovers these snapshots and runs cache-only by default; avoid downloading a new model during routine edits. A 20 s Spanish smoke test with cached `base` yielded 44 word timestamps in 5.25 s; previous 253 s and 212 s passes took 45.8 s and 40.9 s.
- Chrome is at `/opt/google/chrome/chrome`; set `VIDEO_EDITOR_BROWSER=/opt/google/chrome/chrome` if auto-discovery fails. Node modules are under `/opt/aki-node/node_modules`; reuse cached component MOVs and render changed events only. `/usr/bin/time` is absent; use Python `time.monotonic()` or shell timestamps for runtime measurements.
- The connected Drive tool accepted text operations but had no binary MP4 upload operation in this session. Keep delivery separate from editing and only claim an upload after a supported binary upload succeeds.

## Honest failure behavior

- FFmpeg's exit code and the last lines of its stderr are printed verbatim. The scripts never report a success they did not verify.
- A failed encode writes only a temporary file, which is removed on a handled failure. A process killed externally can leave a uniquely named `.part-<pid>-<random>.<ext>`; it is not the requested output and may be deleted after confirming no matching process still uses it. The final path is published only after a zero exit code and nonempty temporary.
- Verify the final path with `ffprobe`, compare expected and actual duration, and run a full decode such as `ffmpeg -v error -i OUTPUT -f null -` before delivery. A file's presence and nonzero size alone do not prove a complete MP4.
- Missing `ffmpeg`/`ffprobe` produce an install hint, not a stack trace.
- `concat --copy` and `audio --operation replace` copy streams; if the output looks broken, re-run without `--copy` or re-encode the source.
- `silence` reports both the measured duration and the expected one, so a rebuild that dropped or duplicated a segment is visible instead of silent.
- The content guess in `analyze` can be wrong on unusual footage. It is a heuristic with the evidence attached, not a classification oracle.

## Not covered yet

Kept out on purpose, to be added incrementally: sound effects and music ducking, transitions between layouts, smooth zoom ramps, speed ramps, and vertical/reframe conversion. Say so plainly if a user asks for one of them instead of improvising a half-working command.

Overlays, punch-in zooms and split layouts **are** covered by `enhance`; the horizontal split is implemented but not yet run on a real horizontal recording.

Subtitles **are** covered, end to end: `subtitles review` flags the words, `subtitles build` writes timed SRT + ASS with measured placement, and `subtitles burn` renders them onto the frame. The output is a hard burn; a muxed soft subtitle track is not implemented.
