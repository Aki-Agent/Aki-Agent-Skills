#!/usr/bin/env python3
"""Inspect one or more media files and print a human report plus optional JSON.

Usage:
    python3 scripts/probe.py INPUT [INPUT ...] [--json PATH]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ffmpeg_lib import (  # noqa: E402
    ToolError,
    duration_of,
    format_bytes,
    format_time,
    frame_rate_of,
    probe,
    stream_of,
    write_json,
)


def describe(path: str) -> dict:
    data = probe(path)
    video = stream_of(data, "video")
    audio = stream_of(data, "audio")
    info = {
        "path": data["path"],
        "container": data.get("format", {}).get("format_name"),
        "duration_seconds": round(duration_of(data), 3),
        "size_bytes": int(data.get("format", {}).get("size") or 0),
        "bit_rate": int(data.get("format", {}).get("bit_rate") or 0),
        "video": None,
        "audio": None,
        "rotation": None,
    }
    if video:
        rotation = None
        for side in video.get("side_data_list", []) or []:
            if "rotation" in side:
                try:
                    rotation = int(float(side["rotation"]))
                except (TypeError, ValueError):
                    rotation = None
        info["video"] = {
            "codec": video.get("codec_name"),
            "profile": video.get("profile"),
            "width": video.get("width"),
            "height": video.get("height"),
            "fps": round(frame_rate_of(video), 3),
            "pix_fmt": video.get("pix_fmt"),
            "bit_rate": int(video.get("bit_rate") or 0) or None,
            "frames": video.get("nb_frames"),
        }
        info["rotation"] = rotation
    if audio:
        info["audio"] = {
            "codec": audio.get("codec_name"),
            "sample_rate": int(audio.get("sample_rate") or 0) or None,
            "channels": audio.get("channels"),
            "bit_rate": int(audio.get("bit_rate") or 0) or None,
        }
    return info


def render(info: dict) -> str:
    lines = [
        f"File:     {info['path']}",
        f"Container:{info['container']}",
        f"Duration: {format_time(info['duration_seconds'])}  ({info['duration_seconds']}s)",
        f"Size:     {format_bytes(info['size_bytes'])}  ({info['size_bytes']} bytes)",
        f"Bit rate: {info['bit_rate'] // 1000 if info['bit_rate'] else 0} kb/s",
    ]
    video = info["video"]
    if video:
        lines.append(
            "Video:    {codec} {width}x{height} @ {fps} fps, {pix_fmt}".format(**video)
        )
    else:
        lines.append("Video:    none")
    if info["rotation"]:
        lines.append(f"Rotation: {info['rotation']} deg (displayed size is swapped)")
    audio = info["audio"]
    if audio:
        lines.append(
            "Audio:    {codec} {sample_rate} Hz, {channels} ch".format(**audio)
        )
    else:
        lines.append("Audio:    none")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Inspect media files with ffprobe.")
    parser.add_argument("inputs", nargs="+", help="Media files to inspect")
    parser.add_argument("--json", metavar="PATH", help="Write the report as JSON to PATH")
    args = parser.parse_args(argv)

    reports = []
    failed = 0
    for path in args.inputs:
        try:
            info = describe(path)
        except ToolError as exc:
            failed += 1
            print(f"ERROR: {exc}", file=sys.stderr)
            continue
        reports.append(info)
        print(render(info))
        if path != args.inputs[-1]:
            print()

    if args.json:
        write_json({"files": reports, "failed": failed}, args.json)
        print(f"\nJSON report: {args.json}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
