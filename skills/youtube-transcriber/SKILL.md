---
name: youtube-transcriber
description: Downloads a YouTube video's audio and produces its full transcript with timestamps. Use when the user asks to transcribe, subtitle, extract the text of, summarize or analyze the spoken content of a YouTube video (or a list of videos), even when no subtitles are available.
---

# YouTube Transcriber

Turns a YouTube video into usable text: timestamped transcript, SRT and Markdown.

Follows the `SKILL.md` + `scripts/` layout (Aki Agent Studio / Claude). No API keys or paid services: it uses local `yt-dlp` and `faster-whisper`.

## When to use this skill

- "transcribe this video", "give me the text of this video"
- "summarize this talk / this YouTube podcast"
- "I need the subtitles as `.srt`"
- Content analysis: finding quotes, claims, exact minute marks.

Do not use it for: high-quality video download (this extracts audio only), or for platforms other than YouTube without adapting `yt-dlp`.

## Strategy (important)

1. **Subtitles first** (`--subs`): if the video has manual or automatic subtitles, they come back in seconds with correct punctuation. This is the preferred path.
2. **Local Whisper fallback** (`faster-whisper`, CPU): when there are no subtitles, when they are blocked (HTTP 429), or when the user needs the actual audio.
3. An `HTTP 429` from YouTube is usually transient: retry once before falling back to Whisper.

## Usage

```bash
python3 scripts/yt_transcribe.py "<url or id>" --subs --lang es
```

Outputs in `/workspace/yt-transcripts/`: `.txt` (paragraphs with `[hh:mm]`), `.md` (metadata + chapters + transcript), `.json` (segments with start/end), and `.srt` with `--srt`.

### Quick test

```bash
python3 scripts/yt_transcribe.py "https://www.youtube.com/watch?v=<VIDEO_ID>" --subs --lang es --srt
```

It should end with `DONE -> .../file.txt (N segments, source: ...)`.

### Flags

| Flag | Purpose |
|---|---|
| `--subs` | try YouTube subtitles first (highly recommended) |
| `--model base\|small\|medium` | Whisper quality. `base` = fast (~0.26x real time), `small` = better, `medium` = best (slow on CPU) |
| `--lang es` | pin the language and avoid wrong auto-detection. Omit it to auto-detect |
| `--range 0-600` | transcribe only a slice (seconds). Useful for long videos |
| `--srt` | also generate `.srt` subtitles |
| `-o path/without_extension` | output name |
| `--outdir DIR` | output directory |

### Long videos

Whisper on CPU runs at ~4x faster than real time with `base`: 1 hour of video ≈ 15 min of processing. For videos over ~20 min:

1. Run it in slices with `--range` and concatenate, or
2. Prefer `--subs` (instant), or
3. Tell the user the estimated time before starting.

## Setup (idempotent)

The script bootstraps itself. If you need to do it manually:

```bash
pip install --break-system-packages yt-dlp faster-whisper "av==12.3.0"
```

- `av==12.3.0` is required: `av>=13` breaks `faster-whisper` (`metadata_errors`).
- The sandbox can be recreated and lose the `pip install`s; running the script again fixes it.
- The Whisper model is cached in `/workspace/.cache/whisper` (persistent). The first `base` download is ~140 MB.

## After transcribing

1. Read the generated `.txt` or `.md` (never invent content).
2. If the user asked for a summary or analysis: work from that text and cite timestamps (`[12:34]`).
3. Deliver the file with the download tool if requested; otherwise show the summary in chat.

## Notes and limits

- Public or unlisted content only. Private, age-restricted or DRM-protected videos may fail: report the real `yt-dlp` error.
- Respect copyright: transcribe for personal analysis, not to redistribute the full content.
- If `faster-whisper` cannot download the model due to environment limits, use `--subs` or `--model tiny`.
