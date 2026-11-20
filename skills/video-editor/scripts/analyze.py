#!/usr/bin/env python3
"""Reconnaissance pass before editing: orientation, length, framing and content.

Usage:
    python3 scripts/analyze.py INPUT [--samples 12] [--sheet PATH] [--json PATH]

Answers the four questions an edit plan needs:

1. Orientation  - vertical, horizontal or square, using the *displayed* size
                  (a phone clip can be stored landscape with a rotation flag).
2. Length       - duration plus a coarse class (short / medium / long).
3. Framing      - true letterbox/pillarbox bars, and the aspect that survives.
4. Content      - per-sample guess between screen recording, animation and
                  filmed footage, collapsed into a timeline of segments, so a
                  clip that switches from slides to a talking head is reported
                  as `mixed` instead of being averaged into one meaningless label.

The content guess is a heuristic over measured frame statistics. It is a
starting point, not a verdict: `--sheet` writes a contact sheet so the guess
can be checked against the actual picture.
"""

from __future__ import annotations

import argparse
import math
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ffmpeg_lib import (  # noqa: E402
    ToolError,
    duration_of,
    format_time,
    probe,
    require_input,
    stream_of,
    tail,
    tool_path,
    write_json,
)

SAMPLE_WIDTH = 96
SHEET_WIDTH = 320
MAX_SAMPLES = 12
SHEET_COLUMNS = 4

# A letterbox bar is *uniformly* black: dark content (a shirt, a shadow) has
# dark means but bright pixels, so both the mean and the maximum are checked.
BAR_MEAN_LUMA = 20
BAR_MAX_LUMA = 40

# Calibration ranges, taken from measured samples: flat UI panels vs. footage.
STD_RANGE = (22.0, 65.0)
ENTROPY_RANGE = (4.4, 7.3)
SATURATION_RANGE = (0.15, 0.60)
# Below this share of the frame, a "bar" is a rounding artefact, not framing.
MIN_BAR_SHARE = 0.02


# ---------------------------------------------------------------- sampling


def _sample_size(width: int, height: int, target: int = SAMPLE_WIDTH) -> tuple[int, int]:
    """Keep the aspect ratio while fitting the long side into `target` pixels."""
    if not width or not height:
        return target, target
    if width >= height:
        return target, max(2, round(target * height / width))
    return max(2, round(target * width / height)), target


def sample_timestamps(total: float, count: int) -> list[float]:
    """Evenly spaced timestamps at the middle of `count` equal slices."""
    if total <= 0:
        return [0.0]
    return [round((index + 0.5) * total / count, 3) for index in range(count)]


def grab_frame(path: Path, at: float, width: int, height: int) -> bytes:
    """Decode a single frame as raw rgb24, seeking instead of scanning.

    A single `fps` filter pass would decode every frame of the file; seeking to
    each timestamp decodes one frame per sample and is far faster on long or
    4K inputs.
    """
    frame_size = width * height * 3
    cmd = [
        tool_path("ffmpeg"), "-hide_banner", "-nostdin", "-v", "error",
        "-ss", f"{max(0.0, at):.3f}", "-i", str(path),
        "-frames:v", "1",
        "-vf", f"scale={width}:{height}:flags=area",
        "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if len(proc.stdout) < frame_size:
        raise ToolError(
            f"Could not decode a frame at {at:.3f}s.\n"
            f"stderr (last lines):\n{tail(proc.stderr.decode('utf-8', 'replace'))}"
        )
    return proc.stdout[:frame_size]


# ---------------------------------------------------------------- metrics


def _frame_metrics(buf: bytes, width: int, height: int) -> dict:
    """Luma/colour statistics for one raw rgb24 frame."""
    total = width * height
    luma = bytearray(total)
    sat_sum = 0.0
    colours: dict[int, int] = {}
    for i in range(total):
        base = i * 3
        r = buf[base]
        g = buf[base + 1]
        b = buf[base + 2]
        luma[i] = (299 * r + 587 * g + 114 * b) // 1000
        high = r if r >= g and r >= b else (g if g >= b else b)
        low = r if r <= g and r <= b else (g if g <= b else b)
        if high:
            sat_sum += (high - low) / high
        key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
        colours[key] = colours.get(key, 0) + 1

    histogram = [0] * 256
    for value in luma:
        histogram[value] += 1
    entropy = 0.0
    for count in histogram:
        if count:
            p = count / total
            entropy -= p * math.log2(p)

    # Share of the frame covered by its four most common colours.
    flatness = sum(sorted(colours.values(), reverse=True)[:4]) / total

    # Mean absolute Laplacian: high on text and hard edges, low on soft footage.
    edge_total = 0
    edge_count = 0
    for y in range(1, height - 1):
        row = y * width
        for x in range(1, width - 1):
            i = row + x
            lap = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - width] - luma[i + width]
            edge_total += abs(lap)
            edge_count += 1

    mean_luma = sum(luma) / total
    variance = sum((v - mean_luma) ** 2 for v in luma) / total
    return {
        "luma": luma,
        "mean_luma": round(mean_luma, 2),
        "luma_std": round(math.sqrt(variance), 2),
        "entropy": round(entropy, 3),
        "flatness": round(flatness, 3),
        "palette": len(colours),
        "edge": round(edge_total / edge_count, 2) if edge_count else 0.0,
        "saturation": round(sat_sum / total, 3),
    }


def _motion(prev: bytearray, cur: bytearray) -> float:
    """Mean absolute luma change between two sampled frames (0-255)."""
    if not prev or len(prev) != len(cur):
        return 0.0
    total = sum(abs(a - b) for a, b in zip(prev, cur))
    return round(total / len(cur), 2)


def _bars(luma: bytearray, width: int, height: int) -> dict:
    """Rows/columns of uniformly black pixels at the frame edges.

    Uses the mean *and* the max of each line: a letterbox bar is pure black,
    while dark picture content always contains some brighter pixels.
    """
    def is_bar(pixels) -> bool:
        return sum(pixels) / len(pixels) <= BAR_MEAN_LUMA and max(pixels) <= BAR_MAX_LUMA

    rows = [luma[y * width:(y + 1) * width] for y in range(height)]
    cols = [bytes(luma[x + y * width] for y in range(height)) for x in range(width)]

    def run(lines):
        count = 0
        for line in lines:
            if not is_bar(line):
                break
            count += 1
        return count

    return {
        "top": run(rows),
        "bottom": run(list(reversed(rows))),
        "left": run(cols),
        "right": run(list(reversed(cols))),
    }


# ---------------------------------------------------------------- heuristics


def _norm(value: float, low: float, high: float) -> float:
    """Scale a measurement to 0-1 between two calibrated bounds."""
    if high == low:
        return 0.0
    return max(0.0, min(1.0, (value - low) / (high - low)))


def _classify(frame: dict) -> dict:
    """Label one sampled frame, with the signals that produced the label.

    Two decisions, in order, because only the first is well separated by the
    measurements:

    1. Texture (luma spread + entropy) separates footage from synthetic frames.
       A camera image is continuous tone with grain; flat panels and vector
       shapes are not.
    2. Among synthetic frames, saturation separates animation (saturated
       fills) from a screen recording (desaturated UI).

    Both thresholds are calibrated against measured samples, so a wrong label
    can be traced to the number that caused it.
    """
    texture = 0.45 * _norm(frame["luma_std"], *STD_RANGE) + 0.55 * _norm(frame["entropy"], *ENTROPY_RANGE)
    saturation = _norm(frame["saturation"], *SATURATION_RANGE)
    texture_margin = abs(texture - 0.5)
    saturation_margin = abs(saturation - 0.5)

    if texture_margin < 0.02:
        label = "unclear"
        confidence = 0.5
    elif texture >= 0.5:
        label = "filmed"
        confidence = 0.5 + texture_margin
    else:
        label = "animation" if saturation >= 0.5 else "screen-recording"
        confidence = 0.5 + min(texture_margin, saturation_margin)

    return {
        "content": label,
        "confidence": round(min(1.0, confidence), 3),
        "texture": round(texture, 3),
        "saturation_signal": round(saturation, 3),
    }


def _duration_class(seconds: float) -> str:
    if seconds < 15:
        return "very-short (<15s)"
    if seconds < 60:
        return "short (<1min)"
    if seconds < 300:
        return "medium (<5min)"
    if seconds < 900:
        return "long (<15min)"
    return "very-long (>=15min)"


def _orientation(width: int, height: int, rotation: int | None) -> dict:
    """Displayed size after applying the rotation flag, then the orientation."""
    display_w, display_h = width, height
    if rotation and abs(int(rotation)) % 180 == 90:
        display_w, display_h = height, width
    if display_w > display_h:
        kind = "horizontal"
    elif display_w < display_h:
        kind = "vertical"
    else:
        kind = "square"
    return {
        "kind": kind,
        "display_width": display_w,
        "display_height": display_h,
        "stored_width": width,
        "stored_height": height,
        "rotation": rotation,
        "aspect": round(display_w / display_h, 3) if display_h else None,
    }


def _segments(labels: list[dict], total: float) -> list[dict]:
    """Collapse per-sample labels into a timeline of consecutive segments."""
    if not labels:
        return []
    interval = total / len(labels)
    segments: list[dict] = []
    for index, frame in enumerate(labels):
        start = round(index * interval, 2)
        end = round(min(total, (index + 1) * interval), 2)
        if segments and segments[-1]["content"] == frame["content"]:
            segments[-1]["end_seconds"] = end
            segments[-1]["samples"] += 1
        else:
            segments.append({
                "content": frame["content"],
                "start_seconds": start,
                "end_seconds": end,
                "samples": 1,
            })
    for segment in segments:
        segment["duration_seconds"] = round(segment["end_seconds"] - segment["start_seconds"], 2)
    return segments


def _composition(labels: list[dict]) -> dict:
    """Share of samples per label, and whether the file is one thing or many."""
    counts: dict[str, int] = {}
    for frame in labels:
        counts[frame["content"]] = counts.get(frame["content"], 0) + 1
    total = len(labels) or 1
    shares = {key: round(count / total, 3) for key, count in sorted(counts.items())}
    substantial = [key for key, value in shares.items() if value >= 0.15 and key != "unclear"]
    if len(substantial) >= 2:
        kind = "mixed"
    elif len(substantial) == 1:
        kind = "single"
    else:
        kind = "unclear"
    return {"kind": kind, "shares": shares}


# ---------------------------------------------------------------- output


def _contact_sheet(
    source: Path, stamps: list[float], destination: Path, width: int, height: int
) -> None:
    """Tile the sampled timestamps into one JPEG, seeking per frame.

    Frames are extracted individually (fast seeks) and then tiled, because a
    single `fps`+`tile` pass would have to decode the whole file first.
    """
    columns = min(SHEET_COLUMNS, max(1, len(stamps)))
    rows = max(1, math.ceil(len(stamps) / columns))
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        for index, at in enumerate(stamps):
            target = folder / f"frame_{index:03d}.jpg"
            cmd = [
                tool_path("ffmpeg"), "-hide_banner", "-nostdin", "-v", "error", "-y",
                "-ss", f"{at:.3f}", "-i", str(source),
                "-frames:v", "1", "-vf", f"scale={width}:{height}:flags=area",
                "-q:v", "3", str(target),
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
            if proc.returncode != 0 or not target.is_file():
                raise ToolError(
                    f"Could not extract the frame at {at:.3f}s for the contact sheet.\n"
                    f"stderr (last lines):\n{tail(proc.stderr)}"
                )
        cmd = [
            tool_path("ffmpeg"), "-hide_banner", "-nostdin", "-v", "error", "-y",
            "-framerate", "1", "-i", str(folder / "frame_%03d.jpg"),
            "-vf", f"tile={columns}x{rows}:padding=4:margin=4",
            "-frames:v", "1", "-q:v", "2", str(destination),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0 or not destination.is_file():
        raise ToolError(
            "Could not build the contact sheet.\n"
            f"stderr (last lines):\n{tail(proc.stderr)}"
        )


def analyze(source: Path, samples: int, sheet: Path | None) -> dict:
    started = time.time()
    data = probe(source)
    video = stream_of(data, "video")
    if not video:
        raise ToolError(f"No video stream found in {source}")
    total = duration_of(data)

    rotation = None
    for side in video.get("side_data_list") or []:
        if "rotation" in side:
            try:
                rotation = int(float(side["rotation"]))
            except (TypeError, ValueError):
                rotation = None

    orientation = _orientation(video.get("width") or 0, video.get("height") or 0, rotation)
    count = max(2, min(samples, MAX_SAMPLES))
    width, height = _sample_size(orientation["display_width"], orientation["display_height"])
    stamps = sample_timestamps(total, count)

    metrics = []
    for at in stamps:
        frame = _frame_metrics(grab_frame(source, at, width, height), width, height)
        frame["at_seconds"] = at
        frame.update(_classify(frame))
        metrics.append(frame)

    labels = [{"content": m["content"], "confidence": m["confidence"]} for m in metrics]
    composition = _composition(labels)
    segments = _segments(labels, total)

    bars = [_bars(m["luma"], width, height) for m in metrics]
    letterbox = {
        side: round(
            statistics.median(b[side] for b in bars)
            / (height if side in ("top", "bottom") else width),
            3,
        )
        for side in ("top", "bottom", "left", "right")
    }
    for side in list(letterbox):
        if letterbox[side] < MIN_BAR_SHARE:
            letterbox[side] = 0.0
    has_bars = any(letterbox[side] > 0 for side in letterbox)
    content_w = width * (1 - letterbox["left"] - letterbox["right"])
    content_h = height * (1 - letterbox["top"] - letterbox["bottom"])
    letterbox["has_bars"] = has_bars
    letterbox["content_aspect"] = round(content_w / content_h, 3) if content_h > 0 else None

    features = {
        "flatness": round(statistics.mean(m["flatness"] for m in metrics), 3),
        "edge": round(statistics.mean(m["edge"] for m in metrics), 2),
        "entropy": round(statistics.mean(m["entropy"] for m in metrics), 3),
        "luma_std": round(statistics.mean(m["luma_std"] for m in metrics), 2),
        "saturation": round(statistics.mean(m["saturation"] for m in metrics), 3),
        "mean_luma": round(statistics.mean(m["mean_luma"] for m in metrics), 2),
        "palette": round(statistics.mean(m["palette"] for m in metrics), 1),
        "motion": round(
            statistics.mean(
                _motion(metrics[i - 1]["luma"], metrics[i]["luma"]) for i in range(1, len(metrics))
            ), 2,
        ) if len(metrics) > 1 else 0.0,
    }

    report = {
        "input": str(source),
        "duration_seconds": round(total, 3),
        "duration": format_time(total),
        "duration_class": _duration_class(total),
        "orientation": orientation,
        "letterbox": letterbox,
        "content": {
            "composition": composition["kind"],
            "shares": composition["shares"],
            "segments": segments,
        },
        "features": features,
        "samples": {
            "count": len(metrics),
            "timestamps_seconds": stamps,
            "per_frame": [{k: v for k, v in m.items() if k != "luma"} for m in metrics],
        },
        "elapsed_seconds": round(time.time() - started, 2),
    }

    if sheet:
        sheet.parent.mkdir(parents=True, exist_ok=True)
        sheet_w, sheet_h = _sample_size(
            orientation["display_width"], orientation["display_height"], SHEET_WIDTH
        )
        _contact_sheet(source, stamps, sheet, sheet_w, sheet_h)
        report["contact_sheet"] = str(sheet)
    return report


def render(report: dict) -> str:
    orientation = report["orientation"]
    lines = [
        f"File:        {report['input']}",
        f"Length:      {report['duration']}  ({report['duration_seconds']}s, {report['duration_class']})",
        f"Orientation: {orientation['kind']} - displays "
        f"{orientation['display_width']}x{orientation['display_height']} (aspect {orientation['aspect']})",
    ]
    if orientation["rotation"]:
        lines.append(
            f"             stored {orientation['stored_width']}x{orientation['stored_height']}"
            f" with a {orientation['rotation']} deg rotation flag"
        )

    bars = report["letterbox"]
    if bars["has_bars"]:
        lines.append(
            "Framing:     bars detected "
            f"(top {bars['top']:.0%}, bottom {bars['bottom']:.0%}, "
            f"left {bars['left']:.0%}, right {bars['right']:.0%}); "
            f"content aspect {bars['content_aspect']}"
        )
    else:
        lines.append("Framing:     no letterbox or pillarbox bars")

    content = report["content"]
    shares = ", ".join(f"{key} {value:.0%}" for key, value in content["shares"].items())
    lines.append(f"Content:     {content['composition']} - {shares}")
    for segment in content["segments"]:
        lines.append(
            f"             {format_time(segment['start_seconds'])} -> "
            f"{format_time(segment['end_seconds'])}  {segment['content']} "
            f"({segment['duration_seconds']}s)"
        )

    features = report["features"]
    lines.append(
        "Metrics:     "
        f"flatness {features['flatness']:.2f}, edges {features['edge']:.1f}, "
        f"entropy {features['entropy']:.2f}, luma std {features['luma_std']:.1f}, "
        f"saturation {features['saturation']:.2f}, motion {features['motion']:.1f}"
    )
    if report.get("contact_sheet"):
        lines.append(f"Contact:     {report['contact_sheet']}")
    lines.append(
        "Next:        confirm the content guess against the contact sheet; "
        "the metrics narrow it down but do not replace the picture."
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Inspect orientation, length, framing and content type of a video."
    )
    parser.add_argument("input", help="Video file to analyze")
    parser.add_argument(
        "--samples", type=int, default=MAX_SAMPLES, help=f"Frames to sample (max {MAX_SAMPLES})"
    )
    parser.add_argument("--sheet", metavar="PATH", help="Write a contact sheet JPEG here")
    parser.add_argument("--json", metavar="PATH", help="Write the report as JSON to PATH")
    args = parser.parse_args(argv)

    try:
        report = analyze(
            require_input(args.input), args.samples, Path(args.sheet) if args.sheet else None
        )
    except ToolError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(render(report))
    if args.json:
        write_json(report, args.json)
        print(f"\nJSON report: {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
