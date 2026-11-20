#!/usr/bin/env python3
"""Turn a transcript into a readable, word-indexed script we can edit by hand.

Usage:
    python3 scripts/script_read.py TRANSCRIPT.json --video CUT.mp4 \
                                  --output-dir video-output [--hints]

Why this exists
---------------
Judging whether a script "makes sense" is not a pattern-matching problem. A
speaker can repeat a phrase because the argument needs it, or stumble on the
same words twice because they lost the thread. No n-gram counter tells those
apart; reading the sentences does.

So this step does not decide anything. It produces the two artifacts needed to
decide:

1. `*.script.md` - the full transcript with a global index on every word, its
   timestamp, and the text grouped by segment. This is what gets read.
2. `*.cuts.json` - an empty, ready-to-fill cut list, referenced by word index
   so cuts can be marked as "from word 120 to word 137" instead of by
   hand-computed seconds.

`--hints` optionally appends mechanical defects (hesitation sounds, stutters,
recognizer mumbles) as *hints only*: they land in a separate section of the
report and are never applied on their own.

Filling the cut list is a judgement call made while reading, then
`script_cut.py` applies it.
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ffmpeg_lib import (  # noqa: E402
    ToolError,
    duration_of,
    format_time,
    probe,
    require_input,
    stream_of,
    write_json,
)

# Hesitation sounds and pure noise: never content, safe candidates.
HESITATIONS = {"eh", "ehh", "ehhh", "em", "emm", "mmm", "mm", "ahh", "uh", "uhh"}


def normalize(token: str) -> str:
    text = unicodedata.normalize("NFD", token)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return "".join(ch for ch in text.lower() if ch.isalnum())


def flatten_words(segments: list[dict]) -> list[dict]:
    """Every word in reading order, with a stable global index.

    The index is the editing handle: it survives timestamp rounding and is what
    a cut list refers to.
    """
    words: list[dict] = []
    for index, segment in enumerate(segments):
        for word in segment.get("words") or []:
            norm = normalize(word.get("word", ""))
            if not norm:
                continue
            words.append({
                "index": len(words),
                "text": word.get("word", "").strip(),
                "norm": norm,
                "start": round(float(word.get("start", segment.get("start", 0))), 3),
                "end": round(float(word.get("end", segment.get("end", 0))), 3),
                "probability": round(float(word.get("probability") or 0.0), 3),
                "segment": index,
            })
    return words


def mechanical_hints(words: list[dict]) -> list[dict]:
    """Cheap, defensible candidates: noise words, stutters, mumbles.

    Hints, not decisions. They are printed apart from the script so they never
    get confused with a considered cut.
    """
    hints: list[dict] = []
    for word in words:
        if word["norm"] in HESITATIONS:
            hints.append({
                "kind": "hesitation",
                "from_word": word["index"],
                "to_word": word["index"],
                "text": word["text"],
            })
    index = 0
    while index < len(words) - 1:
        if words[index + 1]["norm"] == words[index]["norm"]:
            hints.append({
                "kind": "stutter",
                "from_word": words[index + 1]["index"],
                "to_word": words[index + 1]["index"],
                "text": f"{words[index]['text']} {words[index + 1]['text']}",
            })
        index += 1
    for previous, current in zip(words, words[1:]):
        if previous["probability"] < 0.35 and current["probability"] < 0.35:
            hints.append({
                "kind": "unclear",
                "from_word": previous["index"],
                "to_word": current["index"],
                "text": f"{previous['text']} {current['text']}",
            })
    return hints


def render_script(
    transcript: dict, words: list[dict], source_name: str, hints: list[dict] | None
) -> str:
    """The reading artifact: every word indexed, grouped by segment."""
    segments = transcript.get("segments") or []
    speech = sum(
        max(0.0, float(item.get("end", 0)) - float(item.get("start", 0)))
        for item in segments
    )
    duration = float(transcript.get("duration") or 0.0)
    lines = [
        f"# Script: {source_name}",
        "",
        f"- language: {transcript.get('language')} "
        f"(p={transcript.get('language_probability')})",
        f"- duration: {format_time(duration)} ({duration}s)",
        f"- segments: {len(segments)}, words: {len(words)}",
        f"- speech: {format_time(speech)}, "
        f"pace: {(len(words) / speech * 60):.0f} words/min" if speech else "- speech: 0",
        "",
        "## How to read this",
        "",
        "Each segment is one line of speech. Word indices in `{}` are the handles",
        "the cut list uses, so a cut can be marked as `from_word`/`to_word`",
        "without computing seconds by hand. Read for sense: a sentence that",
        "restarts, repeats a clause, or loses the thread is a cut; a deliberate",
        "repetition that carries the argument is not.",
        "",
        "## Transcript",
        "",
    ]
    for index, segment in enumerate(segments):
        start = format_time(float(segment.get("start", 0)))
        end = format_time(float(segment.get("end", 0)))
        text = (segment.get("text") or "").strip()
        lines.append(f"[{index:03d}] {start} -> {end}  {text}")

    lines += ["", "## Word index", "", "```"]
    for word in words:
        lines.append(
            f"{word['index']:04d}  {format_time(word['start'])}  {word['text']}"
        )
    lines += ["```", ""]

    if hints is not None:
        lines += [
            "## Mechanical hints (not cuts)",
            "",
            "Noise words, stutters and unclear runs. They are candidates only:",
            "decide each one while reading, do not apply them blindly.",
            "",
        ]
        if not hints:
            lines.append("None found.")
        for hint in hints:
            lines.append(
                f"- {hint['kind']}: words {hint['from_word']}-{hint['to_word']} "
                f"\"{hint['text']}\""
            )
        lines.append("")

    lines += [
        "## Filling the cut list",
        "",
        "The cut list written next to this file starts empty. Add one entry per",
        "cut, by word index:",
        "",
        "```json",
        '{ "from_word": 120, "to_word": 137, "reason": "restarts the same clause" }',
        "```",
        "",
        "`start`/`end` in seconds also work when a boundary must fall between",
        "words. Then apply:",
        "",
        "```bash",
        "python3 scripts/script_cut.py CUTS.json --video INPUT.mp4 --plan-only",
        "python3 scripts/script_cut.py CUTS.json --video INPUT.mp4 --output final.mp4",
        "```",
        "",
    ]
    return "\n".join(lines)


def build_cut_template(
    transcript_path: Path, transcript: dict, video: Path | None, total: float
) -> dict:
    """An empty cut list with the context `script_cut.py` needs to resolve it."""
    return {
        "transcript_json": str(transcript_path),
        "transcript_total_seconds": round(total, 3),
        "video": str(video) if video else None,
        "notes": (
            "Add cuts as {from_word, to_word, reason} (indices from the .script.md "
            "word index) or {start, end, reason} in seconds. Empty cuts means no edit."
        ),
        "cuts": [],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Extract a word-indexed script from a transcript and prepare "
        "an empty cut list to fill in by hand."
    )
    parser.add_argument("transcript", help="Transcript JSON from transcribe.py")
    parser.add_argument("--video", help="The video that was transcribed")
    parser.add_argument("--output-dir", default="video-output")
    parser.add_argument("--base-name", help="Base name for the outputs")
    parser.add_argument(
        "--hints", action="store_true",
        help="Append mechanical hints (hesitations, stutters, unclear runs)",
    )
    args = parser.parse_args(argv)

    try:
        transcript_path = require_input(args.transcript)
        try:
            transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ToolError(
                f"Transcript is not valid JSON: {transcript_path}: {exc}"
            ) from exc
        segments = transcript.get("segments") or []
        if not segments:
            raise ToolError("Transcript has no segments: nothing to read.")

        words = flatten_words(segments)
        if not words:
            raise ToolError(
                "Transcript has no word timestamps, so cuts cannot be word-aligned. "
                "Re-run the transcription (word timestamps are on by default)."
            )

        total = float(transcript.get("duration") or words[-1]["end"])
        video_total = None
        if args.video:
            info = probe(require_input(args.video))
            if stream_of(info, "audio") is None:
                raise ToolError(f"No audio stream in {args.video}.")
            video_total = duration_of(info)
    except ToolError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    warnings: list[str] = []
    if video_total and abs(video_total - total) > 1.0:
        warnings.append(
            f"transcript duration {total:.2f}s does not match video {video_total:.2f}s; "
            "cuts would land on the wrong frames. Transcribe the exact file you will cut."
        )

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    base = args.base_name or transcript_path.stem
    script_path = output_dir / f"{base}.script.md"
    cuts_path = output_dir / f"{base}.cuts.json"

    hints = mechanical_hints(words) if args.hints else None
    script_path.write_text(
        render_script(transcript, words, transcript_path.stem, hints), encoding="utf-8"
    )
    template = build_cut_template(
        transcript_path, transcript, Path(args.video) if args.video else None, total
    )
    template["warnings"] = warnings
    write_json(template, cuts_path)

    print("Script extracted")
    print(f"  script:   {script_path}")
    print(f"  cuts:     {cuts_path}  (empty, fill it in)")
    print(f"  duration: {format_time(total)} ({total}s)")
    print(f"  segments: {len(segments)}, words: {len(words)}")
    if hints is not None:
        print(f"  hints:    {len(hints)} mechanical candidates (see the report)")
    for warning in warnings:
        print(f"  WARNING: {warning}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
