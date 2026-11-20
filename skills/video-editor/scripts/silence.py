#!/usr/bin/env python3
"""Remove silence from a video: detect it, show the plan, then rebuild the cut.

Usage:
    python3 scripts/silence.py INPUT [--noise -30dB] [--min-silence 0.8]
                                   [--pad 0.08] [--plan-only] [--chunked] [--output PATH]

Two stages, deliberately separate:

1. Detect. `silencedetect` reports every silent run in the audio track. Nothing
   is modified; the ranges are parsed from FFmpeg's log and turned into a list
   of ranges to *keep* (speech), each padded so cuts do not clip consonants.
2. Rebuild. The kept ranges are trimmed and concatenated in one filter graph,
   re-encoding both streams so every cut lands on an exact frame.

`--plan-only` stops after stage 1 and prints the timeline, which is the honest
way to check the thresholds before rewriting a two-hour file.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ffmpeg_lib import (  # noqa: E402
    ToolError,
    duration_of,
    ensure_output_dir,
    format_bytes,
    format_time,
    output_report,
    probe,
    require_input,
    run,
    stream_of,
    tail,
    tool_path,
    write_json,
)

SILENCE_START = re.compile(r"silence_start:\s*(-?[\d.]+)")
SILENCE_END = re.compile(r"silence_end:\s*(-?[\d.]+)")
# A keep-range shorter than this is a click, not speech; drop it.
MIN_KEEP_SECONDS = 0.05
# Tight, but leave enough lead/tail for consonants. Raise these values for a calmer edit.
DEFAULT_MIN_SILENCE_SECONDS = 0.8
DEFAULT_SPEECH_PAD_SECONDS = 0.08
DEFAULT_CHUNK_SECONDS = 8.0
DEFAULT_CHUNK_TIMEOUT_SECONDS = 30.0
# Guards against a filter graph that would never finish building.
MAX_SEGMENTS = 400


def detect_silences(
    path: Path, noise: str, min_silence: float, start: float = 0.0, end: float | None = None
) -> list[dict]:
    """Run `silencedetect` and return [{start, end, duration}] in seconds.

    FFmpeg writes these to stderr, not stdout, so the log is the result.
    """
    args = ["-v", "info", "-nostats"]
    if start:
        args += ["-ss", f"{start:.3f}"]
    args += ["-i", str(path)]
    if end is not None:
        args += ["-t", f"{max(0.0, end - start):.3f}"]
    args += [
        "-vn",
        "-af", f"silencedetect=noise={noise}:d={min_silence:.3f}",
        "-f", "null", "-",
    ]
    cmd = [tool_path("ffmpeg"), "-hide_banner", "-nostdin", *args]
    proc = run(cmd)
    if proc.returncode != 0:
        raise ToolError(
            f"silencedetect failed with code {proc.returncode}\n"
            f"stderr (last lines):\n{tail(proc.stderr)}"
        )

    silences: list[dict] = []
    open_start: float | None = None
    for line in proc.stderr.splitlines():
        if "silence_start" in line:
            match = SILENCE_START.search(line)
            if match:
                open_start = float(match.group(1))
        elif "silence_end" in line:
            match = SILENCE_END.search(line)
            if match and open_start is not None:
                stop = float(match.group(1))
                silences.append({
                    "start": round(open_start + start, 3),
                    "end": round(stop + start, 3),
                    "duration": round(stop - open_start, 3),
                })
                open_start = None
    # A silence that runs to the end of the file has no closing log line.
    if open_start is not None:
        total = duration_of(probe(path))
        silences.append({
            "start": round(open_start + start, 3),
            "end": round(total, 3),
            "duration": round(total - (open_start + start), 3),
        })
    return silences


def keep_ranges(
    silences: list[dict],
    total: float,
    pad: float,
    start: float = 0.0,
    end: float | None = None,
    min_keep: float = MIN_KEEP_SECONDS,
) -> list[dict]:
    """Complement of the silences inside [start, end], padded and clamped.

    Padding grows each kept range into the adjacent silence, so a cut lands on
    the last audible sample instead of clipping the attack of the next word.
    Overlapping results are merged rather than emitted twice.
    """
    window_start = max(0.0, start)
    window_end = total if end is None else min(total, end)
    ranges: list[dict] = []
    cursor = window_start
    for silence in silences:
        silence_start = max(window_start, min(silence["start"], window_end))
        if silence_start > cursor:
            ranges.append({"start": cursor, "end": silence_start})
        cursor = max(cursor, min(silence["end"], window_end))
    if window_end > cursor:
        ranges.append({"start": cursor, "end": window_end})

    padded: list[dict] = []
    for item in ranges:
        start_at = max(window_start, item["start"] - pad)
        end_at = min(window_end, item["end"] + pad)
        if end_at - start_at < min_keep:
            continue
        if padded and start_at <= padded[-1]["end"]:
            padded[-1]["end"] = max(padded[-1]["end"], end_at)
        else:
            padded.append({"start": start_at, "end": end_at})

    for item in padded:
        item["start"] = round(item["start"], 3)
        item["end"] = round(item["end"], 3)
        item["duration"] = round(item["end"] - item["start"], 3)
    return padded


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


def remove_silence(args: argparse.Namespace) -> dict:
    started = time.time()
    source = require_input(args.input)
    info = probe(source)
    total = duration_of(info)
    has_audio = stream_of(info, "audio") is not None
    if not has_audio:
        raise ToolError(
            f"No audio stream in {source}: silence removal needs a soundtrack to analyse."
        )

    start = args.start or 0.0
    end = args.end if args.end is not None else total
    if end <= start:
        raise ToolError(f"Invalid range: start={start}s end={end}s")

    silences = detect_silences(source, args.noise, args.min_silence, start, end)
    ranges = keep_ranges(silences, total, args.pad, start, end)
    kept = sum(item["duration"] for item in ranges)
    removed = (end - start) - kept

    plan = {
        "input": str(source),
        "duration_seconds": round(total, 3),
        "window": {"start": round(start, 3), "end": round(end, 3)},
        "window_seconds": round(end - start, 3),
        "has_audio": has_audio,
        "settings": {
            "noise": args.noise,
            "min_silence_seconds": args.min_silence,
            "pad_seconds": args.pad,
            "chunked": args.chunked,
            "chunk_seconds": args.chunk_seconds if args.chunked else None,
            "chunk_timeout_seconds": args.chunk_timeout if args.chunked else None,
        },
        "silences": silences,
        "silence_count": len(silences),
        "keep_ranges": ranges,
        "keep_count": len(ranges),
        "kept_seconds": round(kept, 3),
        "removed_seconds": round(removed, 3),
        "removed_share": round(removed / (end - start), 3) if end > start else 0.0,
    }

    if args.chunked and args.chunk_seconds <= 0:
        raise ToolError(f"--chunk-seconds must be greater than zero (got {args.chunk_seconds}).")
    if args.chunked and args.chunk_timeout <= 0:
        raise ToolError(f"--chunk-timeout must be greater than zero (got {args.chunk_timeout}).")
    if not ranges:
        raise ToolError(
            "Every sample was detected as silence, so the output would be empty. "
            "Lower --noise (for example -40dB) or raise --min-silence."
        )
    if len(ranges) > MAX_SEGMENTS:
        raise ToolError(
            f"{len(ranges)} keep-ranges exceeds the {MAX_SEGMENTS} limit. "
            "Raise --min-silence to merge short pauses, or process the file in ranges."
        )

    if args.plan_only:
        plan["mode"] = "plan-only"
        plan["elapsed_seconds"] = round(time.time() - started, 2)
        return plan

    out = Path(args.output) if args.output else (
        ensure_output_dir(args.output_dir or Path.cwd() / "video-output")
        / f"{source.stem.replace(' ', '_')}_nosilence.mp4"
    )
    if out.resolve() == source.resolve():
        raise ToolError("Output path must differ from the input video; the source is never overwritten.")
    ensure_output_dir(out.parent)

    script = out.with_suffix(".filtergraph.txt")
    cmd: list[str] = []
    if not args.chunked:
        script.write_text(build_graph(ranges, has_audio, start), encoding="utf-8")
        if start:
            cmd += ["-ss", f"{start:.3f}"]
        cmd += [
            "-i", str(source),
            "-filter_complex_script", str(script),
            "-map", "[vout]",
        ]
        if has_audio:
            cmd += ["-map", "[aout]", "-c:a", "aac", "-b:a", args.audio_bitrate]
        cmd += [
            "-c:v", "libx264", "-preset", args.preset, "-crf", str(args.crf),
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out),
        ]

    if args.chunked:
        from cuts import rebuild

        report = rebuild(
            source=source,
            keep_ranges=ranges,
            output=out,
            has_audio=has_audio,
            crf=args.crf,
            preset=args.preset,
            audio_bitrate=args.audio_bitrate,
            chunked=True,
            chunk_seconds=args.chunk_seconds,
            chunk_timeout=args.chunk_timeout,
            started=started,
        )
    else:
        from ffmpeg_lib import run_ffmpeg

        try:
            run_ffmpeg(cmd)
        finally:
            script.unlink(missing_ok=True)
        report = output_report(out, started, {
            "expected_seconds": round(kept, 3),
            "chunked": False,
        })
        if report.get("probe_error"):
            raise ToolError(f"Completed output could not be probed: {report['probe_error']}")
        actual = report.get("duration_seconds")
        if actual is not None and abs(actual - kept) > 0.25:
            raise ToolError(
                f"Output duration {actual:.3f}s differs from expected {kept:.3f}s "
                f"by more than 0.25s; check the silence ranges and A/V timestamps."
            )

    report.update({
        "operation": "silence-remove",
        "input": str(source),
        "settings": plan["settings"],
        "silence_count": plan["silence_count"],
        "keep_count": plan["keep_count"],
        "kept_seconds": plan["kept_seconds"],
        "removed_seconds": plan["removed_seconds"],
        "removed_share": plan["removed_share"],
        "expected_seconds": round(kept, 3),
    })
    return report


def render_plan(plan: dict, limit: int = 40) -> str:
    lines = [
        f"File:        {plan['input']}",
        f"Length:      {format_time(plan['duration_seconds'])}  ({plan['duration_seconds']}s)",
        f"Settings:    noise {plan['settings']['noise']}, "
        f"min silence {plan['settings']['min_silence_seconds']}s, "
        f"pad {plan['settings']['pad_seconds']}s",
        f"chunked {plan['settings']['chunked']}"
        + (f" ({plan['settings']['chunk_seconds']}s chunks)" if plan['settings']['chunked'] else ""),
        f"Detected:    {plan['silence_count']} silent runs -> keep {plan['keep_count']} ranges",
        f"Result:      {format_time(plan['kept_seconds'])} kept, "
        f"{format_time(plan['removed_seconds'])} removed ({plan['removed_share']:.0%})",
    ]
    shown = plan["keep_ranges"][:limit]
    if shown:
        lines.append("Keep ranges:")
        for item in shown:
            lines.append(
                f"  {format_time(item['start'])} -> {format_time(item['end'])}  ({item['duration']}s)"
            )
        if len(plan["keep_ranges"]) > limit:
            lines.append(f"  ... {len(plan['keep_ranges']) - limit} more")
    return "\n".join(lines)


def render_result(report: dict) -> str:
    lines = [
        "Silence removed",
        f"  output:   {report['output']}",
    ]
    if not report.get("exists"):
        lines.append("  status:   file was not created")
        return "\n".join(lines)
    lines += [
        f"  size:     {format_bytes(report['size_bytes'])}",
        f"  duration: {format_time(report.get('duration_seconds'))}  "
        f"(expected {report['expected_seconds']}s)",
        f"  removed:  {format_time(report['removed_seconds'])} across "
        f"{report['silence_count']} silent runs",
        f"  chunked:  {report.get('chunked', False)}"
        + (f" ({report.get('chunk_count')} chunks)" if report.get('chunked') else ""),
        f"  elapsed:  {report['elapsed_seconds']}s",
    ]
    if report.get("probe_error"):
        lines.append(f"  WARNING: could not re-probe the output: {report['probe_error']}")
    return "\n".join(lines)


def _join_negative_values(argv: list[str]) -> list[str]:
    """Turn `--noise -30dB` into `--noise=-30dB`.

    argparse reads a leading dash as the start of another option, so the most
    natural way to write a dB threshold would otherwise be rejected.
    """
    out: list[str] = []
    index = 0
    while index < len(argv):
        token = argv[index]
        if token == "--noise" and index + 1 < len(argv) and argv[index + 1].startswith("-"):
            out.append(f"--noise={argv[index + 1]}")
            index += 2
            continue
        out.append(token)
        index += 1
    return out


def main(argv: list[str] | None = None) -> int:
    argv = _join_negative_values(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(
        description="Remove silence from a video by detecting it and rebuilding the cut."
    )
    parser.add_argument("input", help="Video file to process")
    parser.add_argument("--noise", default="-30dB", help="Silence threshold (default -30dB)")
    parser.add_argument(
        "--min-silence", type=float, default=DEFAULT_MIN_SILENCE_SECONDS,
        help=f"Only cut silences at least this long (default {DEFAULT_MIN_SILENCE_SECONDS:g}s; tighter edit)",
    )
    parser.add_argument(
        "--pad", type=float, default=DEFAULT_SPEECH_PAD_SECONDS,
        help=f"Seconds retained around speech on each side (default {DEFAULT_SPEECH_PAD_SECONDS:g}s)",
    )
    parser.add_argument("--start", type=float, help="Only process from this second")
    parser.add_argument("--end", type=float, help="Only process up to this second")
    parser.add_argument(
        "--plan-only", action="store_true",
        help="Detect and print the cut plan without writing a file",
    )
    parser.add_argument("--crf", type=int, default=20)
    parser.add_argument("--preset", default="veryfast")
    parser.add_argument("--audio-bitrate", default="128k")
    parser.add_argument("--chunked", action="store_true",
                        help="Encode short MP4 chunks then concat by stream copy (bounded FFmpeg jobs)")
    parser.add_argument("--chunk-seconds", type=float, default=DEFAULT_CHUNK_SECONDS,
                        help=f"Maximum source span per chunk when --chunked (default {DEFAULT_CHUNK_SECONDS:g}s)")
    parser.add_argument("--chunk-timeout", type=float, default=DEFAULT_CHUNK_TIMEOUT_SECONDS,
                        help=f"Seconds allowed for each FFmpeg chunk (default {DEFAULT_CHUNK_TIMEOUT_SECONDS:g}; lower chunk size if exceeded)")
    parser.add_argument("--output")
    parser.add_argument("--output-dir")
    parser.add_argument("--json")
    args = parser.parse_args(argv)

    try:
        result = remove_silence(args)
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
