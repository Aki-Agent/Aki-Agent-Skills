---
name: video-editor
description: Edits video files locally with FFmpeg — inspect orientation, length and content type, remove silence, clean the spoken script, review and correct a transcript, burn subtitles in a measured position, trim, concatenate, extract or replace audio, transcode for delivery, and export still frames — without uploading media anywhere. Use when a user asks to cut, join, compress, resize, mute, re-voice, de-silence, caption or inspect a video, or needs frames or a contact sheet from one.
---

# Video Editor

> **Status: experimental.** Under active development. The pipeline is tested end-to-end on real recordings, but thresholds and heuristics still change between runs. Verify the output before delivering it.

Local, deterministic video editing with FFmpeg. Nothing is uploaded: the scripts call `ffmpeg` and `ffprobe` on the user's files.

## Requirements

| Task | Needs |
|---|---|
| All scripts | `ffmpeg` and `ffprobe` on `PATH`, Python 3.9+ |
| Encoding H.264 / H.265 | An FFmpeg build with `libx264` / `libx265` (the default Gyan, Homebrew and distro builds have them) |

No Python packages are installed: the scripts use the standard library only. `ffmpeg_lib.tool_path` honors `FFMPEG_PATH` and `FFPROBE_PATH` when the binaries are not on `PATH`.

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
| `transcribe` | Transcribes with the `video_transcription` skill and writes a timecoded script. |
| `audit` | Finds where the script stops making sense (swallowed speech, abandoned clauses, repeats) and can re-listen each window in isolation. |
| `script_read` | Turns a transcript into a word-indexed script plus an empty cut list to fill by hand. |
| `script_cut` | Applies a hand-written cut list (word indices or seconds) and rebuilds the video. |
| `subtitles` | Subtitle pass: `review` flags words to correct, `build` writes timed SRT + ASS with measured placement, `burn` renders them. |
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
python3 scripts/silence.py INPUT --plan-only

# 2. Then write the cut
python3 scripts/silence.py INPUT --output video-output/tight.mp4
```

Two stages, deliberately separate: `silencedetect` reports silent runs, those become a list of ranges to **keep**, and only then are those ranges trimmed and concatenated in one filter graph. Nothing is written in `--plan-only` mode.

| Flag | Default | Notes |
|---|---|---|
| `--noise` | `-30dB` | Silence threshold. Use `-35dB` or lower for a noisy room, `-25dB` for a quiet one. |
| `--min-silence` | `0.6` | Only cut pauses at least this long. Raise it to keep breathing room. |
| `--pad` | `0.15` | Silence kept on each side of speech, so cuts do not clip consonants |
| `--start` / `--end` | whole file | Process a window only |
| `--plan-only` | off | Detect and print the timeline, write nothing |
| `--crf` / `--preset` | `20` / `veryfast` | Re-encode settings for the rebuilt file |

The rebuild re-encodes video and audio so every cut lands on an exact frame and the two streams stay aligned. It refuses a file with no audio track, a range that would produce an empty output, and more than 400 keep-ranges (raise `--min-silence` to merge short pauses).

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
    --output video-output/final.mp4
```

**Transcribe the file you are going to cut.** Word timestamps are absolute, so transcribing the original and cutting the de-silenced version puts every boundary in the wrong place. Both `script_read` and `script_cut` warn when the transcript length does not match the video.

`transcribe` does not reimplement speech recognition: it locates the `video_transcription` skill, runs its `transcribe_video.py`, and reshapes the JSON into a timecoded script. Lookup order is `VIDEO_TRANSCRIPTION_DIR`, then `skills/` and `skill/` next to this skill, then the same names above the working directory. Its `.venv` is used when present.

### Finding the cuts: `audit`

Reading alone misses two defects that show up in every real recording, and both are measurable:

| Signal | What it catches | How it is measured |
|---|---|---|
| `truncated` | A word the speaker **abandoned** mid-way | The recognizer wrote the token with an ellipsis (`"se arco..."`). It only emits `...` when it heard a word it could not finish decoding. |
| `collapsed` | Speech the recognizer **swallowed** | One word far longer than the median *and* low confidence. A token stretched to 1.86 s against a 0.26 s median is several words crammed into one. |
| `restart` | An idea abandoned to open another | A segment left without terminal punctuation **and** the next segment starting with a marker ("primero que nada", "es importante"). |
| `repeat` | The same content n-gram coming back | Function words ignored, so "que hay una" does not count as content. |
| `stutter` / `filler` | Repeated words, hesitation sounds | Adjacent identical tokens, known noise words. |

The first one is the case that reading cannot catch. In the 1119 test recording the audio says *"saben que hay **un altísimo** que hay una altísima probabilidad"*; the transcript renders it as *"saben que hay una altísima probabilidad"* with `una` stretched to 1.86 s. The aborted start is invisible in the text and obvious in the timings.

`truncated` covers the opposite failure. In the sample_3 test recording the audio says *"se arco..."* and then restarts as *"que largó XAI"*; the transcript keeps the stumble as the token `arco...`. That ellipsis is the recognizer admitting it could not finish the word, so the trace is in the text. Measured across five transcripts, tokens with `...` appeared **only** where the speaker actually stumbled, and never in a corrected script.

`--listen` turns a candidate into evidence: it cuts that window, transcribes it **in isolation**, and prints what was really said with real word boundaries. A short clip has no long-recording context to make the recognizer skip a false start, which is exactly why it recovers speech the full-file pass dropped. **When `heard` and the transcript disagree, trust `heard` and cut by seconds** — the word index of a swallowed stretch points at the wrong boundaries.

Every candidate is a measurement, not a verdict. A trailing comma alone is *not* a signal: whisper splits on pauses, not sentences, so checking that flagged 26 of 28 candidates on a clean recording. Only the comma **plus** a restart marker is worth reporting. Numbers are excluded from `collapsed` on purpose: "64GB" and "3090" are read slowly and come back with low confidence without being swallowed speech. The duration floor is 1.6 s for the same reason: measured across the test recordings, real swallowed speech stretches a token to 1.86 s, while a name read slowly (`SpaceX,` at 1.34 s, confidence 0.47) stays under it.

The restart marker list is deliberately narrow, and that matters. Bare connectives are not restarts: `entonces tendría sentido...` continues the same argument, and `quién llega primero` merely contains the word "primero". A loose list turns continuations into false positives — measured on the 1119 recording, adding `entonces` and `primero` produced two spurious candidates on a script that reads correctly. Only openers that genuinely abandon the thread ("primero que nada", "antes que nada", "lo importante") are listed.

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

# 4. Burn the styled ASS
python3 scripts/subtitles.py burn video-output/final.mp4 \
    --ass video-output/final.subs.ass --output video-output/final_subs.mp4
```

#### What `review` flags, and why the rules are narrow

| Signal | Flagged because | Measured behaviour |
|---|---|---|
| low probability | The recognizer hesitated over the token | `p < 0.6` |
| `...` in the token | It could not finish decoding the word | Same signal `audit` uses for `truncated` |
| contains a digit | Numbers arrive split (`$60` `.000` `.000`) | Always worth a look |
| capitalized mid-sentence | A brand name, not a sentence start | See below |

Capitalization is only meaningful **inside** a sentence. Flagging every capitalized word marked `Porque`, `Ahora` and `Este` on a clean transcript — 68 of 408 words on the sample_3 recording, most of them noise. Checking that the previous token does not end in `.`/`?`/`!` and that the word is not at a segment start cut it to 51, and every remaining hit was a real proper noun or a brand.

Corrections are written in two forms, both keeping the original timings so text edits never move a cue:

```json
{
  "replacements": [{"from": "Corsor", "to": "Cursor", "reason": "brand name"}],
  "words": {"203": "arco"},
  "glue": [{"from_word": 176, "to_word": 177, "text": "3090", "reason": "split figure"}]
}
```

`replacements` rewrites every occurrence of a token; `words` overrides one token by index. The build report lists every applied change with its reason, so a wrong correction is visible rather than silent.

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

## Honest failure behavior

- FFmpeg's exit code and the last lines of its stderr are printed verbatim. The scripts never report a success they did not verify.
- A failed encode can still leave a partial file. Check the report's `exists`, `duration_seconds` and the exit code together before delivering.
- Missing `ffmpeg`/`ffprobe` produce an install hint, not a stack trace.
- `concat --copy` and `audio --operation replace` copy streams; if the output looks broken, re-run without `--copy` or re-encode the source.
- `silence` reports both the measured duration and the expected one, so a rebuild that dropped or duplicated a segment is visible instead of silent.
- The content guess in `analyze` can be wrong on unusual footage. It is a heuristic with the evidence attached, not a classification oracle.

## Not covered yet

Kept out on purpose, to be added incrementally: crop/zoom, overlays and watermarks, transitions, speed ramps, vertical/reframe conversion, and music ducking. Say so plainly if a user asks for one of them instead of improvising a half-working command.

Subtitles **are** covered, end to end: `subtitles review` flags the words, `subtitles build` writes timed SRT + ASS with measured placement, and `subtitles burn` renders them onto the frame. The output is a hard burn; a muxed soft subtitle track is not implemented.
