#!/usr/bin/env python3
"""Apply a hand-reviewed cut list to a video.

Usage:
    python3 scripts/script_cut.py CUTS.json --video INPUT.mp4 --plan-only
    python3 scripts/script_cut.py CUTS.json --video INPUT.mp4 --output final.mp4

The cut list is written by hand after reading `*.script.md`. Each entry names
either a word range or a time range:

    {"from_word": 120, "to_word": 137, "reason": "restarts the same clause"}
    {"start": 41.2, "end": 43.9, "reason": "loses the thread"}

Word ranges are resolved against the transcript, so a cut lands exactly on word
boundaries instead of on hand-computed seconds. This script does not judge the
list: it applies what it is given and reports what it removed.

Cuts are expanded by a few milliseconds on each side (`--pad`) so the join does
not clip the neighbouring phoneme.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cuts import complement_ranges, merge_ranges, rebuild  # noqa: E402
from ffmpeg_lib import (  # noqa: E402
    ToolError,
    duration_of,
    ensure_output_dir,
    format_bytes,
    format_time,
    probe,
    require_input,
    stream_of,
    write_json,
)


def load_json(path: Path, label: str) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ToolError(f"{label} is not valid JSON: {path}: {exc}") from exc


def word_timeline(transcript: dict) -> list[dict]:
    """Flat word list matching the indices printed by `script_read.py`."""
    words: list[dict] = []
    for segment in transcript.get("segments") or []:
        for word in segment.get("words") or []:
            token = "".join(
                ch for ch in str(word.get("word", "")).lower() if ch.isalnum()
            )
            if not token:
                continue
            words.append({
                "start": float(word.get("start", segment.get("start", 0))),
                "end": float(word.get("end", segment.get("end", 0))),
                "text": str(word.get("word", "")).strip(),
            })
    return words


def resolve_cut(cut: dict, words: list[dict], index: int) -> dict:
    """Turn one cut entry into a {start, end} pair in seconds."""
    has_words = "from_word" in cut or "to_word" in cut
    has_times = "start" in cut or "end" in cut
    if has_words and has_times:
        raise ToolError(
            f"cut #{index} mixes word indices and seconds; use one or the other: {cut}"
        )
    if has_words:
        if not words:
            raise ToolError(
                f"cut #{index} uses word indices but no transcript was resolved. "
                "Pass --transcript or keep `transcript_json` in the cut list."
            )
        first = int(cut.get("from_word", 0))
        last = int(cut.get("to_word", first))
        if first < 0 or last < first or last >= len(words):
            raise ToolError(
                f"cut #{index} word range {first}-{last} is outside 0-{len(words) - 1}"
            )
        start, end = words[first]["start"], words[last]["end"]
    elif has_times:
        start = float(cut.get("start", 0.0))
        end = float(cut.get("end", start))
    else:
        raise ToolError(f"cut #{index} has neither word indices nor times: {cut}")
    if end <= start:
        raise ToolError(f"cut #{index} is empty or reversed: {start}s -> {end}s")
    return {"start": start, "end": end, "reason": cut.get("reason", "")}


def apply_cuts(args: argparse.Namespace) -> dict:
    started = time.time()
    source = require_input(args.video)
    cuts_data = load_json(require_input(args.cuts), "Cut list")
    if not isinstance(cuts_data.get("cuts"), list):
        raise ToolError(
            f"Cut list has no `cuts` array: {args.cuts}. "
            "Expected the file written by script_read.py."
        )

    info = probe(source)
    total = duration_of(info)
    has_audio = stream_of(info, "audio") is not None
    if not has_audio:
        raise ToolError(f"No audio stream in {source}: nothing to cut against.")

    warnings: list[str] = []
    declared = cuts_data.get("transcript_total_seconds")
    if declared and abs(float(declared) - total) > 1.0:
        warnings.append(
            f"cut list was built for a {float(declared):.2f}s file but this video is "
            f"{total:.2f}s; word indices may not line up."
        )

    transcript: dict | None = None
    transcript_path = args.transcript or cuts_data.get("transcript_json")
    if transcript_path and Path(transcript_path).is_file():
        transcript = load_json(Path(transcript_path), "Transcript")
    words = word_timeline(transcript) if transcript else []

    entries = cuts_data["cuts"]
    if args.only_reasons:
        wanted = {item.strip().lower() for item in args.only_reasons.split(",") if item.strip()}
        entries = [
            cut for cut in entries
            if any(tag in str(cut.get("reason", "")).lower() for tag in wanted)
        ]

    resolved = []
    for index, cut in enumerate(entries):
        item = resolve_cut(cut, words, index)
        item["start"] = max(0.0, item["start"] - args.pad)
        item["end"] = min(total, item["end"] + args.pad)
        if item["end"] > item["start"]:
            resolved.append(item)

    removals = merge_ranges(resolved, total)
    keep = complement_ranges(removals, total)
    removed = sum(item["duration"] for item in removals)

    plan = {
        "operation": "script-cut",
        "video": str(source),
        "cuts_file": str(args.cuts),
        "duration_seconds": round(total, 3),
        "cut_count": len(removals),
        "removed_seconds": round(removed, 3),
        "kept_seconds": round(total - removed, 3),
        "removals": removals,
        "keep_ranges": keep,
        "warnings": warnings,
    }

    if args.plan_only:
        plan["mode"] = "plan-only"
        plan["elapsed_seconds"] = round(time.time() - started, 2)
        return plan

    if not removals:
        raise ToolError(
            "The cut list resolves to no cuts, so there is nothing to write. "
            "Add entries to `cuts` or run with --plan-only to inspect."
        )

    out = Path(args.output) if args.output else (
        ensure_output_dir(args.output_dir or Path.cwd() / "video-output")
        / f"{source.stem.replace(' ', '_')}_scripted.mp4"
    )
    report = rebuild(
        source=source,
        keep_ranges=keep,
        output=out,
        has_audio=has_audio,
        crf=args.crf,
        preset=args.preset,
        audio_bitrate=args.audio_bitrate,
    )
    plan.update(report)
    plan["elapsed_seconds"] = round(time.time() - started, 2)
    return plan


def render_plan(plan: dict, limit: int = 40) -> str:
    lines = [
        f"File:    {plan['video']}",
        f"Length:  {format_time(plan['duration_seconds'])} ({plan['duration_seconds']}s)",
        f"Cuts:    {plan['cut_count']} ranges, {format_time(plan['removed_seconds'])} removed",
        f"Result:  {format_time(plan['kept_seconds'])} expected",
    ]
    for warning in plan["warnings"]:
        lines.append(f"WARNING: {warning}")
    shown = plan["removals"][:limit]
    if shown:
        lines.append("Removing:")
        for item in shown:
            reason = f"  ({item['reason']})" if item.get("reason") else ""
            lines.append(
                f"  {format_time(item['start'])} -> {format_time(item['end'])} "
                f"({item['duration']}s){reason}"
            )
        if len(plan["removals"]) > limit:
            lines.append(f"  ... {len(plan['removals']) - limit} more")
    return "\n".join(lines)


def render_result(plan: dict) -> str:
    lines = ["Script cut applied", f"  output:   {plan['output']}"]
    if not plan.get("exists"):
        lines.append("  status:   file was not created")
        return "\n".join(lines)
    lines += [
        f"  size:     {format_bytes(plan['size_bytes'])}",
        f"  duration: {format_time(plan.get('duration_seconds'))} "
        f"(expected {plan['expected_seconds']}s)",
        f"  removed:  {format_time(plan['removed_seconds'])} across "
        f"{plan['cut_count']} ranges",
        f"  elapsed:  {plan['elapsed_seconds']}s",
    ]
    for warning in plan["warnings"]:
        lines.append(f"  WARNING: {warning}")
    if plan.get("probe_error"):
        lines.append(f"  WARNING: could not re-probe the output: {plan['probe_error']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Apply a hand-written cut list (word indices or seconds) to a video."
    )
    parser.add_argument("cuts", help="Cut list JSON written by script_read.py")
    parser.add_argument("--video", required=True, help="The video that was transcribed")
    parser.add_argument("--transcript", help="Transcript JSON (else taken from the cut list)")
    parser.add_argument("--output")
    parser.add_argument("--output-dir")
    parser.add_argument("--plan-only", action="store_true",
                        help="Print what would be removed without writing a file")
    parser.add_argument("--pad", type=float, default=0.05,
                        help="Seconds added on each side of a cut (default 0.05)")
    parser.add_argument("--only-reasons", metavar="TAGS",
                        help="Only apply cuts whose reason contains one of these tags")
    parser.add_argument("--crf", type=int, default=20)
    parser.add_argument("--preset", default="veryfast")
    parser.add_argument("--audio-bitrate", default="128k")
    parser.add_argument("--json")
    args = parser.parse_args(argv)

    try:
        result = apply_cuts(args)
    except ToolError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(render_plan(result) if args.plan_only else render_result(result))
    if args.json:
        write_json(result, args.json)
        print(f"\nJSON report: {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
