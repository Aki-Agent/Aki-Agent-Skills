#!/usr/bin/env python3
"""Shared cut-rebuild helpers.

Both the silence pass and the script pass end the same way: take a list of time
ranges to keep, trim them, and concatenate them in one filter graph. That logic
lives here so the two passes cannot drift apart.

The only difference between them is how the ranges are computed: silence works
from an inverted list of silences, the script pass from an inverted list of
flagged lines. The rebuild itself is identical.
"""

from __future__ import annotations

import time
from pathlib import Path

from ffmpeg_lib import ToolError, ensure_output_dir, output_report, run_ffmpeg

# A keep-range shorter than this is a click, not speech; drop it.
MIN_KEEP_SECONDS = 0.05
# Guards against a filter graph that would never finish building.
MAX_SEGMENTS = 400


def merge_ranges(ranges: list[dict], total: float | None = None) -> list[dict]:
    """Sort, clamp and merge overlapping or touching ranges.

    Overlap is normal here: two flagged phrases can share a word, and the
    silence pass pads every range into its neighbour.
    """
    cleaned: list[dict] = []
    for item in ranges:
        start = max(0.0, float(item["start"]))
        end = float(item["end"])
        if total is not None:
            end = min(total, end)
        if end <= start:
            continue
        cleaned.append({"start": start, "end": end})
    cleaned.sort(key=lambda item: item["start"])

    merged: list[dict] = []
    for item in cleaned:
        if merged and item["start"] <= merged[-1]["end"] + 1e-6:
            merged[-1]["end"] = max(merged[-1]["end"], item["end"])
        else:
            merged.append(dict(item))

    for item in merged:
        item["start"] = round(item["start"], 3)
        item["end"] = round(item["end"], 3)
        item["duration"] = round(item["end"] - item["start"], 3)
    return merged


def complement_ranges(
    removals: list[dict], total: float, min_keep: float = MIN_KEEP_SECONDS
) -> list[dict]:
    """The parts of [0, total] that survive a list of removals."""
    merged = merge_ranges(removals, total)
    keep: list[dict] = []
    cursor = 0.0
    for item in merged:
        if item["start"] > cursor:
            keep.append({"start": cursor, "end": item["start"]})
        cursor = max(cursor, item["end"])
    if total > cursor:
        keep.append({"start": cursor, "end": total})

    kept: list[dict] = []
    for item in keep:
        if item["end"] - item["start"] < min_keep:
            continue
        kept.append({
            "start": round(item["start"], 3),
            "end": round(item["end"], 3),
            "duration": round(item["end"] - item["start"], 3),
        })
    return kept


def build_graph(ranges: list[dict], has_audio: bool, offset: float = 0.0) -> str:
    """One filter graph: trim every kept range, then concat them in order.

    `offset` is the input seek applied before decoding, so timestamps in the
    graph are relative to that point. Written to a script file rather than
    inline because a long recording can produce hundreds of ranges and blow
    past the command-line length limit.
    """
    parts: list[str] = []
    labels: list[str] = []
    for index, item in enumerate(ranges):
        start = f"{max(0.0, item['start'] - offset):.3f}"
        end = f"{max(0.0, item['end'] - offset):.3f}"
        parts.append(
            f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS[v{index}]"
        )
        if has_audio:
            parts.append(
                f"[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[a{index}]"
            )
            labels.append(f"[v{index}][a{index}]")
        else:
            labels.append(f"[v{index}]")
    parts.append(
        f"{''.join(labels)}concat=n={len(ranges)}:v=1:a={1 if has_audio else 0}"
        f"[vout]{'[aout]' if has_audio else ''}"
    )
    return ";\n".join(parts)


def rebuild(
    source: Path,
    keep_ranges: list[dict],
    output: Path,
    has_audio: bool,
    crf: int = 20,
    preset: str = "veryfast",
    audio_bitrate: str = "128k",
) -> dict:
    """Trim and concatenate `keep_ranges` into `output`, re-encoding both streams.

    Re-encoding is what makes every cut land on an exact frame and keeps the two
    streams aligned; a stream copy can only cut on keyframes and would desync.
    """
    if not keep_ranges:
        raise ToolError(
            "No ranges left to keep, so the output would be empty. "
            "Check the cut list: it may cover the whole file."
        )
    if len(keep_ranges) > MAX_SEGMENTS:
        raise ToolError(
            f"{len(keep_ranges)} keep-ranges exceeds the {MAX_SEGMENTS} limit. "
            "Merge adjacent cuts or process the file in ranges."
        )

    ensure_output_dir(output.parent)
    script = output.with_suffix(".filtergraph.txt")
    script.write_text(build_graph(keep_ranges, has_audio), encoding="utf-8")
    cmd = ["-i", str(source), "-filter_complex_script", str(script), "-map", "[vout]"]
    if has_audio:
        cmd += ["-map", "[aout]", "-c:a", "aac", "-b:a", audio_bitrate]
    cmd += [
        "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
    ]
    try:
        run_ffmpeg(cmd)
    finally:
        script.unlink(missing_ok=True)

    expected = round(sum(item["duration"] for item in keep_ranges), 3)
    return output_report(output, time.time(), {"expected_seconds": expected})
