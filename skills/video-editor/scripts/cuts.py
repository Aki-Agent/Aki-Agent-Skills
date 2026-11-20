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

import tempfile
import time
from pathlib import Path

from ffmpeg_lib import (
    ToolError, ensure_output_dir, frame_rate_of, output_report,
    probe, run_ffmpeg, stream_of,
)

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


def _chunk_ranges(keep_ranges: list[dict], chunk_seconds: float = 8.0) -> list[dict]:
    """Split kept spans into short source windows for bounded FFmpeg jobs."""
    if chunk_seconds <= 0:
        raise ToolError(f"--chunk-seconds must be greater than zero (got {chunk_seconds}).")
    chunks: list[dict] = []
    for item in keep_ranges:
        cursor = float(item["start"])
        end = float(item["end"])
        while end - cursor > chunk_seconds + 1e-6:
            stop = cursor + chunk_seconds
            chunks.append({"start": cursor, "end": stop, "duration": stop - cursor})
            cursor = stop
        if end > cursor + 1e-6:
            chunks.append({"start": cursor, "end": end, "duration": end - cursor})
    return chunks


def rebuild(
    source: Path,
    keep_ranges: list[dict],
    output: Path,
    has_audio: bool,
    crf: int = 20,
    preset: str = "veryfast",
    audio_bitrate: str = "128k",
    *,
    chunked: bool = False,
    chunk_seconds: float = 12.0,
    chunk_timeout: float = 30.0,
    started: float | None = None,
) -> dict:
    """Trim and concatenate `keep_ranges`, optionally using short MP4 chunks.

    Re-encoding is what makes every cut land on a frame and keeps A/V aligned.
    In chunked mode each closed MP4 is encoded separately and the results are
    concat-demuxed with stream copy. This avoids one long FFmpeg process being
    interrupted by short-lived execution hosts. Every chunk uses the same
    codec, pixel format, frame rate and audio parameters.
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
    if chunked and chunk_seconds <= 0:
        raise ToolError(f"--chunk-seconds must be greater than zero (got {chunk_seconds}).")
    if chunked and chunk_timeout <= 0:
        raise ToolError(f"--chunk-timeout must be greater than zero (got {chunk_timeout}).")
    if output.resolve() == source.resolve():
        raise ToolError("Output path must differ from the input video; the source is never overwritten.")

    ensure_output_dir(output.parent)
    started = time.time() if started is None else started
    expected = round(sum(float(item["end"]) - float(item["start"]) for item in keep_ranges), 3)
    chunk_count = 0

    if not chunked:
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
    else:
        chunks = _chunk_ranges(keep_ranges, chunk_seconds)
        if len(chunks) > MAX_SEGMENTS:
            raise ToolError(
                f"Chunked edit requires {len(chunks)} chunks, above the {MAX_SEGMENTS} limit. "
                "Increase --chunk-seconds or process a shorter input."
            )
        source_info = probe(source)
        video = stream_of(source_info, "video")
        if not video:
            raise ToolError(f"No video stream found in {source}.")
        fps = frame_rate_of(video) or 30.0
        audio = stream_of(source_info, "audio") if has_audio else None
        sample_rate = int(audio.get("sample_rate") or 48000) if audio else 0
        channels = int(audio.get("channels") or 2) if audio else 0

        with tempfile.TemporaryDirectory(prefix=f".{output.stem}.chunks-", dir=output.parent) as temp:
            work = Path(temp)
            paths: list[Path] = []
            for index, item in enumerate(chunks):
                chunk = work / f"{index:04d}.mp4"
                duration = float(item["end"]) - float(item["start"])
                cmd = [
                    "-ss", f"{float(item['start']):.6f}", "-i", str(source),
                    "-t", f"{duration:.6f}", "-map", "0:v:0",
                ]
                if has_audio:
                    cmd += ["-map", "0:a:0", "-af", "aresample=async=1:first_pts=0"]
                else:
                    cmd += ["-an"]
                cmd += [
                    "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
                    "-pix_fmt", "yuv420p", "-threads", "1", "-r", f"{fps:.6f}",
                    "-fps_mode", "cfr", "-movflags", "+faststart",
                ]
                if has_audio:
                    cmd += ["-c:a", "aac", "-b:a", audio_bitrate,
                            "-ar", str(sample_rate), "-ac", str(channels)]
                cmd.append(str(chunk))
                run_ffmpeg(cmd, timeout=chunk_timeout)
                paths.append(chunk)

            manifest = work / "concat.txt"
            manifest.write_text(
                "".join(
                    "file '" + str(path.resolve()).replace("'", "'\\''") + "'\n"
                    for path in paths
                ),
                encoding="utf-8",
            )
            concat = ["-f", "concat", "-safe", "0", "-i", str(manifest), "-map", "0:v:0"]
            if has_audio:
                concat += ["-map", "0:a:0"]
            if has_audio:
                # Independent AAC encodes carry priming delay; normalize only the
                # audio during concat so the MP4 timeline matches the planned cut.
                concat += ["-af", "aresample=async=1:first_pts=0"]
            concat += ["-c:v", "copy"]
            if has_audio:
                concat += ["-c:a", "aac", "-b:a", audio_bitrate]
            concat += ["-movflags", "+faststart", str(output)]
            run_ffmpeg(concat, timeout=chunk_timeout)
            chunk_count = len(paths)

    report = output_report(output, started, {
        "expected_seconds": expected,
        "chunked": chunked,
        "chunk_seconds": chunk_seconds if chunked else None,
        "chunk_timeout_seconds": chunk_timeout if chunked else None,
        "chunk_count": chunk_count,
    })
    if report.get("probe_error"):
        raise ToolError(f"Completed output could not be probed: {report['probe_error']}")
    actual = report.get("duration_seconds")
    if actual is not None and abs(actual - expected) > 0.25:
        raise ToolError(
            f"Output duration {actual:.3f}s differs from expected {expected:.3f}s "
            f"by more than 0.25s; check the cut ranges and A/V timestamps."
        )
    return report
