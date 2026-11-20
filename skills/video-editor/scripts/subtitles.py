#!/usr/bin/env python3
"""Subtitle pass: review the transcript, correct it, build timed cues, burn them.

Usage:
    # 1. List the words worth checking, with context, and open a correction file
    python3 scripts/subtitles.py review TRANSCRIPT.json --video CUT.mp4 \
        --output-dir video-output

    # 2. Fill corrections.json, then build SRT + ASS with placement from the frame
    python3 scripts/subtitles.py build TRANSCRIPT.json --corrections corrections.json \
        --video CUT.mp4 --output-dir video-output

    # 3. Burn the styled ASS into the video
    python3 scripts/subtitles.py burn CUT.mp4 --ass video-output/CUT.subs.ass \
        --output video-output/CUT_subs.mp4

Why a separate pass
-------------------
The transcription is evidence, not a delivery file. It contains brand names the
recognizer guessed phonetically, numbers written as words, and the occasional
token it could not decode. Fixing those needs the *context* of the sentence and
what the video is about, which is a reading task — so `review` prints each
flagged word inside its sentence and writes a correction file to fill in.

Placement is measured, not guessed
----------------------------------
`build` samples frames, measures a 6x6 grid of skin share (where the person is)
and edge density (where the UI is), and picks the subtitle anchor from that plus
the letterbox bars from `analyze`. A talking head that fills the frame, a webcam
in the corner of a screen recording and a letterboxed 16:9 clip each need a
different margin, and those are different measurements.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ffmpeg_lib import (  # noqa: E402
    ToolError,
    duration_of,
    ensure_output_dir,
    format_time,
    probe,
    require_input,
    run_ffmpeg,
    stream_of,
    write_json,
)
from subs import (  # noqa: E402
    MAX_CHARS_PER_LINE,
    MAX_CPS,
    ass_style,
    build_cues,
    cue_lines,
    flagged_words,
    flatten_words,
    measure_composition,
    recommend_placement,
    validate_cues,
    write_ass,
    write_srt,
)

SAMPLE_COUNT = 6


# --------------------------------------------------------------- review


def _context(segments: list[dict], word_index: int, window: int = 6) -> str:
    """The sentence-ish neighbourhood of one word, with only that word marked.

    Marking by text equality would bracket every repeated token (three `.000` in
    a row), so the marker is driven by the global index.
    """
    flat: list[tuple[int, str]] = []
    for segment in segments:
        for word in segment.get("words") or []:
            text = (word.get("word") or "").strip()
            if text:
                flat.append((len(flat), text))
    for position, (index, _) in enumerate(flat):
        if index != word_index:
            continue
        start = max(0, position - window)
        end = min(len(flat), position + window + 1)
        parts = [
            f"[{text}]" if index == word_index else text
            for index, text in flat[start:end]
        ]
        return " ".join(parts)
    return ""


def cmd_review(args: argparse.Namespace) -> int:
    transcript_path = require_input(args.transcript)
    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    segments = transcript.get("segments") or []
    if not segments:
        raise ToolError("Transcript has no segments.")
    words = flatten_words(segments)
    if not words:
        raise ToolError("Transcript has no word timestamps.")

    flags = flagged_words(words)
    output_dir = ensure_output_dir(args.output_dir)
    base = args.base_name or transcript_path.stem
    report_path = output_dir / f"{base}.subs-review.md"
    corrections_path = output_dir / f"{base}.corrections.json"

    by_index = {word["index"]: word for word in words}
    lines = [
        f"# Subtitle review: {base}",
        "",
        f"{len(words)} words, {len(flags)} flagged for checking.",
        "",
        "Read each line and decide whether the word is wrong. The recognizer guesses",
        "brand names phonetically, so `Corsor`, `Grock` and `Miarnes` are almost",
        "certainly Cursor, Grok and Miernes/Miercoles - but only the surrounding",
        "sentence and what the video is about can confirm it.",
        "",
        "| word | time | why | context |",
        "|---|---|---|---|",
    ]
    for flag in flags:
        context = _context(segments, flag["index"]).replace("|", "\\|")
        lines.append(
            f"| `{flag['text']}` | {format_time(flag['start'])} | "
            f"{', '.join(flag['reasons'])} | {context} |"
        )
    lines += [
        "",
        "## Writing the corrections",
        "",
        f"Fill `{corrections_path.name}` and re-run `build`:",
        "",
        "```json",
        "{",
        '  "replacements": [',
        '    {"from": "Corsor", "to": "Cursor", "reason": "brand name"}',
        "  ],",
        '  "words": {',
        '    "203": "arco"',
        "  }",
        "}",
        "```",
        "",
        "`replacements` rewrites every occurrence of a token; `words` overrides one",
        "token by its index. Both keep the original timings, so correcting the text",
        "never moves a cue.",
        "",
    ]
    report_path.write_text("\n".join(lines), encoding="utf-8")

    if not corrections_path.exists() or args.force:
        template = {
            "transcript_json": str(transcript_path),
            "notes": (
                "replacements rewrite every occurrence of a token; words overrides "
                "one token by index. Timings are preserved."
            ),
            "replacements": [],
            "words": {},
            "glue": [],
        }
        write_json(template, corrections_path)

    print(f"Subtitle review: {len(flags)} of {len(words)} words flagged")
    print(f"  report:      {report_path}")
    print(f"  corrections: {corrections_path}")
    print("Next: read the report, fill the corrections, then run `build`.")
    return 0


# ---------------------------------------------------------------- build


def _apply_corrections(words: list[dict], corrections: dict) -> tuple[list[dict], list[dict]]:
    """Rewrite text in place, keeping every timestamp untouched.

    Matching ignores surrounding punctuation, because a token arrives as
    `Antropiq.` or `billions,` and the correction is written as a bare word.
    The original punctuation is then re-attached to the replacement: dropping it
    silently turned `Antropiq.` into `Anthropic` and lost the sentence break.
    """
    replacements = []
    for item in corrections.get("replacements") or []:
        source = (item.get("from") or "").strip()
        target = item.get("to")
        if not source or target is None:
            continue
        replacements.append((source, str(target), item.get("reason") or ""))

    overrides = {int(key): value for key, value in (corrections.get("words") or {}).items()}

    # A recognizer splits figures across tokens: "4 ,5" and "una 30 -90" are one
    # number written as two words. Replacing either half alone leaves the other
    # on screen, so a run of tokens is merged into the first one and the rest are
    # dropped. The merged token inherits the end time of the last absorbed word,
    # otherwise the cue would end early and shorten the read.
    glued: dict[int, str] = {}
    absorbed_until: dict[int, float] = {}
    dropped: set[int] = set()
    for item in corrections.get("glue") or []:
        start, end = item.get("from_word"), item.get("to_word")
        text = item.get("text")
        if start is None or end is None or text is None:
            continue
        start, end = int(start), int(end)
        if end < start:
            start, end = end, start
        glued[start] = str(text)
        for index in range(start + 1, end + 1):
            dropped.add(index)
        for word in words:
            if word["index"] == end:
                absorbed_until[start] = word["end"]
                break

    words = [word for word in words if word["index"] not in dropped]

    applied: list[dict] = []
    result: list[dict] = []
    for word in words:
        if word["index"] in glued:
            applied.append({
                "index": word["index"], "from": word["text"],
                "to": glued[word["index"]], "reason": "merged tokens",
            })
            word = {
                **word,
                "text": glued[word["index"]],
                "end": absorbed_until.get(word["index"], word["end"]),
            }
        text = word["text"]
        if word["index"] in overrides:
            applied.append({
                "index": word["index"], "from": text,
                "to": overrides[word["index"]], "reason": "index override",
            })
            text = overrides[word["index"]]
        else:
            for source, target, reason in replacements:
                if text.strip(".,;:!?¿¡\"'") == source:
                    # Keep the trailing punctuation the token arrived with.
                    trailing = text[len(text.rstrip(".,;:!?¿¡\"'")):] if text else ""
                    if trailing and target.rstrip().endswith(tuple(".,;:!?")):
                        trailing = ""
                    replacement = target + trailing
                    applied.append({
                        "index": word["index"], "from": text, "to": replacement, "reason": reason,
                    })
                    text = replacement
                    break
        result.append({**word, "text": text})
    return result, applied


def cmd_build(args: argparse.Namespace) -> int:
    started = time.time()
    transcript_path = require_input(args.transcript)
    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    segments = transcript.get("segments") or []
    if not segments:
        raise ToolError("Transcript has no segments.")

    words = flatten_words(segments)
    if not words:
        raise ToolError("Transcript has no word timestamps.")

    corrections: dict = {}
    if args.corrections:
        corrections_path = require_input(args.corrections)
        corrections = json.loads(corrections_path.read_text(encoding="utf-8"))
    words, applied = _apply_corrections(words, corrections)

    output_dir = ensure_output_dir(args.output_dir)
    base = args.base_name or transcript_path.stem

    # The frame comes first: the line budget depends on it. A fixed 42-character
    # line is correct for a 1920 px frame and clips on a 720 px vertical one, so
    # the limit is derived from the width and the font size instead.
    placement = None
    composition = None
    width = height = None
    if args.video:
        video = require_input(args.video)
        info = probe(video)
        stream = stream_of(info, "video")
        if not stream:
            raise ToolError(f"No video stream in {video}")
        rotation = 0
        for side in stream.get("side_data_list") or []:
            if "rotation" in side:
                try:
                    rotation = int(float(side["rotation"]))
                except (TypeError, ValueError):
                    rotation = 0
        width, height = int(stream.get("width") or 0), int(stream.get("height") or 0)
        if abs(rotation) in (90, 270):
            width, height = height, width
        total = duration_of(info)
        stamps = [round((index + 0.5) * total / SAMPLE_COUNT, 3) for index in range(SAMPLE_COUNT)]
        composition = measure_composition(
            video, width, height, stamps, bars={"top": 0.0, "bottom": 0.0}
        )
        placement = recommend_placement(composition)
    else:
        width = args.width or 1920
        height = args.height or 1080
        placement = {
            "alignment": 2, "anchor": "bottom", "margin_v": round(height * 0.06),
            "margin_v_ratio": 0.06, "reason": "no video supplied, using the default safe area",
            "layout": "unknown", "person_band": None,
        }

    if args.position in ("top", "bottom"):
        placement = {
            **placement,
            "alignment": 8 if args.position == "top" else 2,
            "anchor": args.position,
            "margin_v": round(height * (0.08 if args.position == "top" else 0.06)),
            "reason": f"forced by --position {args.position}",
        }

    style = ass_style(
        width,
        height,
        alignment=placement["alignment"],
        margin_v=placement["margin_v"],
        size_ratio=args.size_ratio,
        box=bool(placement.get("needs_box")),
    )
    max_chars = args.max_chars or fit_chars(width, style["size"])

    cues = build_cues(
        words,
        max_chars=max_chars,
        min_seconds=args.min_seconds,
        max_seconds=args.max_seconds,
        max_cps=args.max_cps,
    )
    if not cues:
        raise ToolError("No cues were produced; the transcript has no words to time.")

    validation = validate_cues(cues, max_chars, args.max_cps)

    ass_path = output_dir / f"{base}.subs.ass"
    srt_path = output_dir / f"{base}.subs.srt"
    write_ass(cues, ass_path, width, height, style, max_chars)
    write_srt(cues, srt_path, max_chars)

    report = {
        "transcript": str(transcript_path),
        "video": str(args.video) if args.video else None,
        "frame": {"width": width, "height": height},
        "cue_count": len(cues),
        "word_count": len(words),
        "corrections_applied": applied,
        "placement": placement,
        "composition": composition,
        "style": style,
        "validation": validation,
        "files": {"ass": str(ass_path), "srt": str(srt_path)},
        "elapsed_seconds": round(time.time() - started, 2),
        "cues": [{k: v for k, v in cue.items() if k != "words"} for cue in cues],
    }
    if args.json:
        write_json(report, args.json)

    print(f"Subtitles built: {len(cues)} cues from {len(words)} words")
    print(f"  ass:      {ass_path}")
    print(f"  srt:      {srt_path}")
    if applied:
        print(f"  corrected: {len(applied)} words")
        for item in applied[:10]:
            print(f"    {item['from']} -> {item['to']}  ({item['reason']})")
    print(f"  placement: {placement['anchor']} (layout {placement['layout']}, "
          f"margin {placement['margin_v']}px) - {placement['reason']}")
    print(f"  style:    {style['font']} {style['size']}px, alignment {style['alignment']}")
    if validation["count"]:
        print(f"  WARNING: {validation['count']} reading problems (see the JSON)")
        for problem in validation["problems"][:8]:
            print(f"    cue {problem['cue']}: {problem['kind']} - {problem['detail']}")
    else:
        print("  reading checks: clean")
    return 0


# ----------------------------------------------------------------- burn


def _ass_filter_path(path: Path) -> str:
    """Escape a path for the `ass` filter, which parses `:` as an option."""
    text = path.resolve().as_posix()
    text = text.replace("\\", "/").replace(":", "\\:")
    return text.replace("'", "\\'")


def cmd_burn(args: argparse.Namespace) -> int:
    started = time.time()
    source = require_input(args.input)
    subtitle = require_input(args.ass)
    info = probe(source)
    if not stream_of(info, "video"):
        raise ToolError(f"No video stream in {source}")

    suffix = ".mp4"
    if args.output:
        out = Path(args.output)
    else:
        out = ensure_output_dir(args.output_dir) / f"{source.stem}_subs{suffix}"
    out.parent.mkdir(parents=True, exist_ok=True)

    filters = [f"ass='{_ass_filter_path(subtitle)}'"]
    if args.max_width:
        filters.append(f"scale='min({args.max_width},iw)':-2")

    cmd = [
        "-i", str(source),
        "-vf", ",".join(filters),
        "-c:v", "libx264", "-crf", str(args.crf), "-preset", args.preset,
        "-pix_fmt", "yuv420p",
    ]
    audio = stream_of(info, "audio")
    if audio:
        cmd += ["-c:a", "aac", "-b:a", "192k"]
    else:
        cmd += ["-an"]
    cmd += ["-movflags", "+faststart", str(out)]

    run_ffmpeg(cmd)
    if not out.is_file():
        raise ToolError(f"ffmpeg reported success but {out} does not exist.")

    report = {
        "output": str(out),
        "source": str(source),
        "subtitles": str(subtitle),
        "size_bytes": out.stat().st_size,
        "elapsed_seconds": round(time.time() - started, 2),
    }
    if args.json:
        write_json(report, args.json)
    print("Subtitles burned")
    print(f"  output:  {out}")
    print(f"  size:    {report['size_bytes'] / (1024 * 1024):.1f} MiB")
    print(f"  elapsed: {report['elapsed_seconds']}s")
    return 0


# ------------------------------------------------------------------ main


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Review, correct and burn subtitles from a transcript."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    review = sub.add_parser("review", help="Flag words to check and open a correction file")
    review.add_argument("transcript")
    review.add_argument("--video")
    review.add_argument("--output-dir", default="video-output")
    review.add_argument("--base-name")
    review.add_argument("--force", action="store_true", help="Overwrite an existing corrections file")
    review.set_defaults(func=cmd_review)

    build = sub.add_parser("build", help="Apply corrections and write timed SRT + ASS")
    build.add_argument("transcript")
    build.add_argument("--corrections", help="corrections.json written by `review`")
    build.add_argument("--video", help="Video the subtitles belong to; enables measured placement")
    build.add_argument("--output-dir", default="video-output")
    build.add_argument("--base-name")
    build.add_argument("--max-chars", type=int, default=MAX_CHARS_PER_LINE)
    build.add_argument("--min-seconds", type=float, default=1.0)
    build.add_argument("--max-seconds", type=float, default=7.0)
    build.add_argument("--max-cps", type=float, default=MAX_CPS)
    build.add_argument("--size-ratio", type=float, default=0.045, help="Font size as a share of frame height")
    build.add_argument("--position", choices=["auto", "top", "bottom"], default="auto")
    build.add_argument("--width", type=int, help="Frame width when no video is given")
    build.add_argument("--height", type=int, help="Frame height when no video is given")
    build.add_argument("--json")
    build.set_defaults(func=cmd_build)

    burn = sub.add_parser("burn", help="Burn an ASS or SRT file into the video")
    burn.add_argument("input")
    burn.add_argument("--ass", required=True, help="Subtitle file to burn (.ass or .srt)")
    burn.add_argument("--crf", type=int, default=20)
    burn.add_argument("--preset", default="medium")
    burn.add_argument("--max-width", type=int, help="Downscale while burning")
    burn.add_argument("--output")
    burn.add_argument("--output-dir", default="video-output")
    burn.add_argument("--json")
    burn.set_defaults(func=cmd_burn)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except ToolError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
