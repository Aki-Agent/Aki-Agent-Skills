#!/usr/bin/env python3
"""Core editing operations for the video-editor skill.

One CLI, one subcommand per operation:

    trim       cut a time range out of one file
    concat     join several files that share codec, size and frame rate
    audio      extract or replace the audio track
    transcode  re-encode to a delivery-friendly H.264/AAC MP4
    frame      export a still frame (thumbnail or verification)

Every subcommand prints a human report and can write the same data as JSON.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ffmpeg_lib import (  # noqa: E402
    ToolError,
    duration_of,
    ensure_output_dir,
    format_bytes,
    format_time,
    parse_time,
    probe,
    require_input,
    run_ffmpeg,
    stream_of,
    write_json,
)

VIDEO_ENCODERS = {
    "h264": ["-c:v", "libx264", "-preset", "{preset}", "-crf", "{crf}", "-pix_fmt", "yuv420p"],
    "h265": ["-c:v", "libx265", "-preset", "{preset}", "-crf", "{crf}", "-tag:v", "hvc1"],
}
AUDIO_ONLY_EXT = {"mp3": ".mp3", "wav": ".wav", "aac": ".m4a", "opus": ".opus", "flac": ".flac"}


def _print_report(title: str, report: dict) -> None:
    print(f"{title}")
    print(f"  output:  {report['output']}")
    if not report.get("exists"):
        print("  status:  file was not created")
        return
    print(f"  size:    {format_bytes(report['size_bytes'])}")
    if "duration_seconds" in report:
        print(f"  duration:{format_time(report['duration_seconds'])}  ({report['duration_seconds']}s)")
    if report.get("width"):
        print(f"  video:   {report.get('video_codec')} {report['width']}x{report['height']}")
    print(f"  audio:   {report.get('audio_codec') or 'none'}")
    print(f"  elapsed: {report['elapsed_seconds']}s")
    if report.get("probe_error"):
        print(f"  WARNING: could not re-probe the output: {report['probe_error']}")


def _resolve_output(path: str | None, default_dir: str | None, name: str, ext: str) -> Path:
    if path:
        target = Path(path)
        ensure_output_dir(target.parent)
        return target
    folder = ensure_output_dir(default_dir or Path.cwd() / "video-output")
    return folder / f"{name}{ext}"


def _stem(path: Path) -> str:
    return path.stem.replace(" ", "_")


def cmd_trim(args: argparse.Namespace) -> int:
    started = time.time()
    source = require_input(args.input)
    info = probe(source)
    total = duration_of(info)
    start = parse_time(args.start) or 0.0
    end = parse_time(args.end)
    duration = parse_time(args.duration)
    if end is None and duration is not None:
        end = start + duration
    if end is None:
        raise ToolError("trim needs --end or --duration")
    if start < 0 or end <= start:
        raise ToolError(f"Invalid range: start={start}s end={end}s")
    if total and start >= total:
        raise ToolError(
            f"--start {start}s is at or past the end of the file ({total:.3f}s)"
        )
    clipped = total and end > total
    if clipped:
        end = total
    length = end - start

    out = _resolve_output(
        args.output, args.output_dir, f"{_stem(source)}_trim", source.suffix or ".mp4"
    )
    common = ["-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(source)]
    if args.copy:
        codec = ["-c", "copy", "-avoid_negative_ts", "make_zero"]
    else:
        codec = [
            "-c:v", "libx264", "-preset", args.preset, "-crf", str(args.crf),
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
        ]
    run_ffmpeg([*common, *codec, "-movflags", "+faststart", str(out)])

    report = _report(out, started, {
        "operation": "trim",
        "input": str(source),
        "start_seconds": round(start, 3),
        "end_seconds": round(end, 3),
        "requested_seconds": round(length, 3),
        "mode": "stream-copy" if args.copy else "re-encode",
        "clipped_to_input_end": bool(clipped),
    })
    _print_report("Trimmed", report)
    if args.json:
        write_json(report, args.json)
    return 0


def _report(out: Path, started: float, extra: dict) -> dict:
    from ffmpeg_lib import output_report

    return output_report(out, started, extra)


def cmd_concat(args: argparse.Namespace) -> int:
    started = time.time()
    inputs = [require_input(path) for path in args.inputs]
    if len(inputs) < 2:
        raise ToolError("concat needs at least two input files")

    reference = probe(inputs[0])
    ref_video = stream_of(reference, "video")
    mismatches = []
    for path in inputs[1:]:
        data = probe(path)
        video = stream_of(data, "video")
        if not video or not ref_video:
            mismatches.append(f"{path}: missing a video stream")
            continue
        if (video.get("width"), video.get("height")) != (ref_video.get("width"), ref_video.get("height")):
            mismatches.append(f"{path}: {video.get('width')}x{video.get('height')} != {ref_video.get('width')}x{ref_video.get('height')}")
        if video.get("codec_name") != ref_video.get("codec_name"):
            mismatches.append(f"{path}: codec {video.get('codec_name')} != {ref_video.get('codec_name')}")
    if mismatches and args.copy:
        raise ToolError(
            "Inputs are not stream-compatible for a copy concat:\n  "
            + "\n  ".join(mismatches)
            + "\nNormalize them first (transcode) or drop --copy to re-encode."
        )

    out = _resolve_output(
        args.output, args.output_dir, "concat", Path(inputs[0]).suffix or ".mp4"
    )
    with tempfile.TemporaryDirectory() as tmp:
        listing = Path(tmp) / "inputs.txt"
        lines = []
        for path in inputs:
            escaped = str(path.resolve()).replace("'", "'\\''")
            lines.append(f"file '{escaped}'")
        listing.write_text("\n".join(lines) + "\n", encoding="utf-8")
        base = ["-f", "concat", "-safe", "0", "-i", str(listing)]
        if args.copy:
            codec = ["-c", "copy"]
        else:
            codec = [
                "-c:v", "libx264", "-preset", args.preset, "-crf", str(args.crf),
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            ]
        run_ffmpeg([*base, *codec, "-movflags", "+faststart", str(out)])

    report = _report(out, started, {
        "operation": "concat",
        "inputs": [str(path) for path in inputs],
        "mode": "stream-copy" if args.copy else "re-encode",
    })
    _print_report("Concatenated", report)
    if args.json:
        write_json(report, args.json)
    return 0


def cmd_audio(args: argparse.Namespace) -> int:
    started = time.time()
    source = require_input(args.input)
    info = probe(source)
    audio = stream_of(info, "audio")
    if not audio:
        raise ToolError(f"No audio stream found in {source}")

    if args.operation == "extract":
        fmt = args.format
        out = _resolve_output(
            args.output, args.output_dir, f"{_stem(source)}_audio", AUDIO_ONLY_EXT[fmt]
        )
        codec = ["-vn", "-c:a", "libmp3lame", "-b:a", args.bitrate] if fmt == "mp3" else []
        if fmt == "wav":
            codec = ["-vn", "-c:a", "pcm_s16le"]
        elif fmt == "aac":
            codec = ["-vn", "-c:a", "aac", "-b:a", args.bitrate]
        elif fmt == "opus":
            codec = ["-vn", "-c:a", "libopus", "-b:a", args.bitrate]
        elif fmt == "flac":
            codec = ["-vn", "-c:a", "flac"]
        run_ffmpeg(["-i", str(source), *codec, str(out)])
        extra = {"operation": "audio-extract", "input": str(source), "format": fmt}
    else:
        replacement = require_input(args.replace)
        out = _resolve_output(
            args.output, args.output_dir, f"{_stem(source)}_audio", source.suffix or ".mp4"
        )
        run_ffmpeg([
            "-i", str(source),
            "-i", str(replacement),
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy", "-c:a", "aac", "-b:a", args.bitrate,
            "-shortest", "-movflags", "+faststart", str(out),
        ])
        extra = {"operation": "audio-replace", "input": str(source), "replacement": str(replacement)}

    report = _report(out, started, extra)
    _print_report("Audio", report)
    if args.json:
        write_json(report, args.json)
    return 0


def _fit_filter(
    width: int | None, height: int | None, max_width: int | None, max_height: int | None = None
) -> str | None:
    """Build a scale filter that keeps the aspect ratio and even dimensions.

    `--max-width` alone does nothing for a vertical clip: a 2160x3840 phone video
    already fits under a 720 px width cap, so the output keeps full resolution.
    Capping by the long side is what actually shrinks both orientations, which is
    why `--max-height` exists and why the preview section recommends it.
    """
    if max_width and max_height:
        return f"scale='min({max_width},iw)':'min({max_height},ih)':force_original_aspect_ratio=decrease"
    if max_width:
        return f"scale='min({max_width},iw)':-2"
    if max_height:
        return f"scale=-2:'min({max_height},ih)'"
    if width and height:
        return f"scale={width}:{height}"
    if width:
        return f"scale={width}:-2"
    if height:
        return f"scale=-2:{height}"
    return None


def cmd_transcode(args: argparse.Namespace) -> int:
    started = time.time()
    source = require_input(args.input)
    info = probe(source)
    if not stream_of(info, "video"):
        raise ToolError(f"No video stream found in {source}")

    out = _resolve_output(args.output, args.output_dir, f"{_stem(source)}_web", ".mp4")
    codec = [token.format(preset=args.preset, crf=args.crf) for token in VIDEO_ENCODERS[args.codec]]
    filters = []
    scale = _fit_filter(args.width, args.height, args.max_width, args.max_height)
    if scale:
        filters.append(scale)
    if args.fps:
        filters.append(f"fps={args.fps}")
    # Rotated phone footage carries a display matrix; bake the rotation into pixels.
    if any("rotation" in side for side in (stream_of(info, "video").get("side_data_list") or [])):
        filters.insert(0, "format=yuv420p")

    cmd = ["-i", str(source), *codec]
    if filters:
        cmd += ["-vf", ",".join(filters)]
    if args.no_audio or not stream_of(info, "audio"):
        cmd += ["-an"]
    else:
        cmd += ["-c:a", "aac", "-b:a", args.audio_bitrate, "-ac", "2"]
    cmd += ["-movflags", "+faststart", str(out)]
    run_ffmpeg(cmd)

    report = _report(out, started, {
        "operation": "transcode",
        "input": str(source),
        "codec": args.codec,
        "crf": args.crf,
        "filters": filters,
    })
    _print_report("Transcoded", report)
    if args.json:
        write_json(report, args.json)
    return 0


def cmd_frame(args: argparse.Namespace) -> int:
    started = time.time()
    source = require_input(args.input)
    at = parse_time(args.at) or 0.0
    total = duration_of(probe(source))
    if total and at >= total:
        raise ToolError(f"--at {at}s is past the end of the file ({total:.3f}s)")
    ext = Path(args.output).suffix.lower() if args.output else ".jpg"
    out = _resolve_output(
        args.output, args.output_dir, f"{_stem(source)}_frame", ext or ".jpg"
    )
    cmd = ["-ss", f"{at:.3f}", "-i", str(source), "-frames:v", "1"]
    if out.suffix.lower() in {".jpg", ".jpeg"}:
        cmd += ["-q:v", "2"]
    cmd += [str(out)]
    run_ffmpeg(cmd)

    report = _report(out, started, {"operation": "frame", "input": str(source), "at_seconds": at})
    _print_report("Frame", report)
    if args.json:
        write_json(report, args.json)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="edit.py",
        description="Edit video with FFmpeg: trim, concat, audio, transcode, frame.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    trim = sub.add_parser("trim", help="Cut a time range out of one file")
    trim.add_argument("input")
    trim.add_argument("--start", default="0", help="Start time: seconds, MM:SS or HH:MM:SS")
    trim.add_argument("--end", help="End time in the same formats")
    trim.add_argument("--duration", help="Alternative to --end")
    trim.add_argument("--copy", action="store_true", help="Stream copy (fast, cuts on keyframes)")
    trim.add_argument("--crf", type=int, default=20)
    trim.add_argument("--preset", default="medium")
    trim.add_argument("--output")
    trim.add_argument("--output-dir")
    trim.add_argument("--json")
    trim.set_defaults(func=cmd_trim)

    concat = sub.add_parser("concat", help="Join files with the same codec, size and fps")
    concat.add_argument("inputs", nargs="+")
    concat.add_argument("--copy", action="store_true", help="Stream copy when inputs match exactly")
    concat.add_argument("--crf", type=int, default=20)
    concat.add_argument("--preset", default="medium")
    concat.add_argument("--output")
    concat.add_argument("--output-dir")
    concat.add_argument("--json")
    concat.set_defaults(func=cmd_concat)

    audio = sub.add_parser("audio", help="Extract or replace the audio track")
    audio.add_argument("input")
    audio.add_argument("--operation", choices=["extract", "replace"], default="extract")
    audio.add_argument("--format", choices=sorted(AUDIO_ONLY_EXT), default="mp3")
    audio.add_argument("--replace", help="Audio file to use when --operation replace")
    audio.add_argument("--bitrate", default="192k")
    audio.add_argument("--output")
    audio.add_argument("--output-dir")
    audio.add_argument("--json")
    audio.set_defaults(func=cmd_audio)

    transcode = sub.add_parser("transcode", help="Re-encode to H.264/AAC MP4 for delivery")
    transcode.add_argument("input")
    transcode.add_argument("--codec", choices=sorted(VIDEO_ENCODERS), default="h264")
    transcode.add_argument("--crf", type=int, default=20)
    transcode.add_argument("--preset", default="medium")
    transcode.add_argument("--width", type=int)
    transcode.add_argument("--height", type=int)
    transcode.add_argument("--max-width", type=int, help="Downscale only, keep aspect ratio")
    transcode.add_argument(
        "--max-height", type=int,
        help="Downscale by the long side; use this for vertical clips",
    )
    transcode.add_argument("--fps", type=float)
    transcode.add_argument("--no-audio", action="store_true")
    transcode.add_argument("--audio-bitrate", default="192k")
    transcode.add_argument("--output")
    transcode.add_argument("--output-dir")
    transcode.add_argument("--json")
    transcode.set_defaults(func=cmd_transcode)

    frame = sub.add_parser("frame", help="Export one still frame")
    frame.add_argument("input")
    frame.add_argument("--at", default="0", help="Timestamp of the frame")
    frame.add_argument("--output")
    frame.add_argument("--output-dir")
    frame.add_argument("--json")
    frame.set_defaults(func=cmd_frame)

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
