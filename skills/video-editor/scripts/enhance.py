#!/usr/bin/env python3
"""Enhancement pass: callouts, badges, screenshots, b-roll, punch-in zooms and split layouts.

Usage:
    # 1. Validate the plan and print the timeline, render nothing
    python3 scripts/enhance.py PLAN.json --video final.mp4 --plan-only

    # 2. Render the components, check them against the frame, compose one output
    python3 scripts/enhance.py PLAN.json --video final.mp4 \
        --ass video-output/final.subs.ass --output video-output/final_enhanced.mp4

Why one pass
------------
Every visual is an HTML component (`components/*.html`) rendered to a clip with
alpha by `overlay_render.js`, then composed over the footage in a single FFmpeg
filter graph. Burning the subtitles in the same graph keeps the delivery file one
lossy generation away from the cut, instead of re-encoding once per layer.

Checks are measurements
-----------------------
A component can land on the speaker's face or under the subtitles and still
"render fine". After rendering, the middle frame of each overlay is compared
against a skin map of the footage in the same window and against the subtitle
band read from the ASS file, and the overlap is reported as a share.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import tempfile
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ffmpeg_lib import (  # noqa: E402
    ToolError,
    duration_of,
    format_time,
    frame_rate_of,
    output_report,
    probe,
    require_input,
    run_ffmpeg,
    stream_of,
    tail,
    tool_path,
    write_json,
)
from subs import _skin_share  # noqa: E402
from subtitles import _ass_filter_path  # noqa: E402

SKILL_DIR = Path(__file__).resolve().parent.parent
COMPONENTS = SKILL_DIR / "components"
RENDERER = Path(__file__).resolve().parent / "overlay_render.js"

OVERLAY_TYPES = {"callout", "badge", "screenshot", "broll",
                 "lower-third", "counter", "quote", "steps", "versus", "bars", "kinetic",
                 "highlight", "timeline", "chapter",
                 "toast", "terminal", "chips", "gauge", "kpi-row", "progress"}
# Full-frame screens (components/screen-*.html): they replace the footage while the audio plays.
SCREEN_TYPES = {"screen-chart", "screen-donut", "screen-stats", "screen-detail", "screen-compare", "screen-list"}
OVERLAY_TYPES |= SCREEN_TYPES
LAYOUT_TYPES = {"punch", "split"}
# Full-frame cutaways go under the cards: a callout over b-roll stays readable.
LAYER = {"broll": 10, "screenshot": 20, "callout": 20, "badge": 30, **{name: 10 for name in SCREEN_TYPES}}
# Overlays that are meant to cover the person are not checked against the face.
COVERS_PERSON = {"broll", "chapter"} | SCREEN_TYPES

MAP_COLS, MAP_ROWS = 9, 16
PERSON_CELL = 0.2   # skin share that marks a cell as the face or torso
OVERLAY_CELL = 0.3  # alpha coverage that marks a cell as covered by a component
FACE_WARN = 0.10    # warn when a component covers more than this share of the head
SUBS_WARN = 0.05    # warn when a component covers more than this share of the subtitle band


def _even(value: float) -> int:
    return max(2, int(round(value / 2)) * 2)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


# ----------------------------------------------------------------- plan


def load_plan(path: Path, width: int, height: int, duration: float) -> tuple[list[dict], list[str]]:
    """Normalize events and reject the ones that cannot be composed."""
    plan = json.loads(path.read_text(encoding="utf-8"))
    accent = plan.get("accent")
    # Plan-wide params (theme, colors, font) applied to every component; an event's own params win.
    defaults = dict(plan.get("defaults") or {})
    errors: list[str] = []
    events: list[dict] = []
    for index, raw in enumerate(plan.get("events") or []):
        kind = raw.get("type")
        name = f"event {index} ({kind})"
        try:
            start, end = float(raw["start"]), float(raw["end"])
        except (KeyError, TypeError, ValueError):
            errors.append(f"{name}: needs numeric start and end")
            continue
        if end <= start:
            errors.append(f"{name}: end {end} is not after start {start}")
            continue
        if start < 0 or end > duration + 0.05:
            errors.append(f"{name}: {start}-{end}s is outside the video (0-{duration:.2f}s)")
            continue
        event = {**raw, "index": index, "start": start, "end": end}
        if kind in OVERLAY_TYPES or (kind not in LAYOUT_TYPES and raw.get("component")):
            component = _resolve_component(raw.get("component") or kind, path.parent)
            if not component.is_file():
                errors.append(f"{name}: component not found: {component}")
                continue
            params = {**defaults, **(raw.get("params") or {})}
            if accent and "accent" not in params:
                params["accent"] = accent
            problem = _resolve_images(params, path.parent)
            if problem:
                errors.append(f"{name}: {problem}")
                continue
            event.update(component=str(component.resolve()), params=params)
        elif kind == "punch":
            zoom = float(raw.get("zoom", 1.2))
            if not 1.0 < zoom <= 2.0:
                errors.append(f"{name}: zoom {zoom} must be between 1.0 and 2.0")
                continue
            event["zoom"] = zoom
        elif kind == "split":
            panel = dict(raw.get("panel") or {})
            component = _resolve_component(panel.get("component") or "split-panel", path.parent)
            if not component.is_file():
                errors.append(f"{name}: panel component not found: {component}")
                continue
            params = {**defaults, **(panel.get("params") or {})}
            if accent and "accent" not in params:
                params["accent"] = accent
            # Only split-panel.html paints its own opaque background. Any other component used as a
            # panel is transparent by default, which would show the uncropped head behind it.
            if component.name != "split-panel.html" and not params.get("bg"):
                errors.append(f"{name}: panel component {component.name} needs an opaque \"bg\" param "
                              f"(for example \"#0a0c12\"), or the uncropped footage shows through")
                continue
            problem = _resolve_images(params, path.parent)
            if problem:
                errors.append(f"{name}: {problem}")
                continue
            vertical = height >= width
            side = raw.get("person") or ("bottom" if vertical else "right")
            valid_sides = ("top", "bottom") if vertical else ("left", "right")
            if side not in valid_sides:
                errors.append(f"{name}: person '{side}' is not valid for a "
                              f"{'vertical' if vertical else 'horizontal'} frame, use {valid_sides}")
                continue
            event.update(person=side, panel_component=str(component.resolve()), panel_params=params)
        else:
            errors.append(f"{name}: unknown type (use {sorted(OVERLAY_TYPES | LAYOUT_TYPES)} or set `component`)")
            continue
        events.append(event)

    # Layout events rewrite the base picture, so two of them cannot share a moment.
    layouts = sorted((e for e in events if e["type"] in LAYOUT_TYPES), key=lambda e: e["start"])
    for first, second in zip(layouts, layouts[1:]):
        if second["start"] < first["end"]:
            errors.append(f"event {first['index']} ({first['type']}) and event {second['index']} "
                          f"({second['type']}) overlap: a punch-in or split cannot run inside another")
    return events, errors


def _resolve_component(value: str, base: Path) -> Path:
    """A built-in name ("bars"), a path relative to the plan, or an absolute path.

    A plan that wrote "component": "bars" failed with "not found" because only paths were
    accepted; a bare name is what anyone reading the component list writes first.
    """
    builtin = COMPONENTS / f"{value}.html"
    if "/" not in value and "\\" not in value and not value.endswith(".html") and builtin.is_file():
        return builtin.resolve()
    candidate = Path(value)
    if not candidate.is_absolute() and not candidate.exists():
        candidate = base / candidate
    return candidate.resolve() if candidate.exists() else candidate


def _resolve_images(params: dict, base: Path) -> str | None:
    """Turn local image paths into file URLs the browser can load."""
    for key in ("src",):
        value = params.get(key)
        if not value or str(value).startswith(("file:", "data:", "http:", "https:")):
            continue
        image = Path(value)
        if not image.is_absolute():
            image = base / image
        if not image.is_file():
            return f"image not found: {image}"
        params[key] = image.resolve().as_uri()
    return None


# --------------------------------------------------------------- render


def render_jobs(events: list[dict], width: int, height: int, fps: float, renders: Path) -> tuple[list[dict], dict]:
    """One job per component clip. A job whose inputs did not change is reused."""
    shared = [COMPONENTS / "overlay.js", COMPONENTS / "overlay.css", COMPONENTS / "screen.js", COMPONENTS / "screen.css"]
    jobs: list[dict] = []
    for event in events:
        if event["type"] == "punch":
            continue
        if event["type"] == "split":
            html, params = event["panel_component"], event["panel_params"]
            w, h = _panel_size(width, height)
        else:
            html, params = event["component"], event["params"]
            w, h = width, height
        dur = round(event["end"] - event["start"], 3)
        stamp = [html, params, w, h, fps, dur]
        # The component, the shared runtime and any local image all invalidate the cache:
        # keying on the image path alone reused a stale clip after the image was redrawn.
        images = [Path(_uri_to_path(v)) for v in params.values() if isinstance(v, str) and v.startswith("file:")]
        for source in [Path(html), *shared, *images]:
            if source.is_file():
                stamp.append(source.stat().st_mtime_ns)
        digest = hashlib.sha1(json.dumps(stamp, sort_keys=True, default=str).encode()).hexdigest()[:10]
        out = renders / f"{event['index']:02d}_{event['type']}_{digest}.mov"
        event["render"] = str(out)
        if not out.is_file():
            jobs.append({"html": html, "params": params, "w": w, "h": h, "fps": fps, "dur": dur, "out": str(out)})

    stats = {"rendered": len(jobs), "reused": sum(1 for e in events if e.get("render")) - len(jobs), "seconds": 0.0}
    if not jobs:
        return jobs, stats
    node = shutil.which("node")
    if not node:
        raise ToolError("`node` not found on PATH. The components are rendered with Node 22+ and Edge or Chrome.")
    renders.mkdir(parents=True, exist_ok=True)
    jobs_file = renders / "jobs.json"
    jobs_file.write_text(json.dumps(jobs, indent=2, ensure_ascii=False), encoding="utf-8")
    started = time.time()
    command = [node, str(RENDERER), "--jobs", str(jobs_file)]
    browser = os.environ.get("VIDEO_EDITOR_BROWSER")
    if browser:
        command += ["--browser", browser]
    try:
        proc = subprocess.run(command, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=1800)
    except subprocess.TimeoutExpired as exc:
        raise ToolError("HTML component rendering exceeded the 1800s safety timeout. "
                        "Reduce the number/duration of components and reuse cached renders.") from exc
    stats["seconds"] = round(time.time() - started, 2)
    if proc.returncode != 0:
        raise ToolError(f"overlay_render.js exited with code {proc.returncode}\n"
                        f"stderr (last lines):\n{tail(proc.stderr)}\nstdout:\n{tail(proc.stdout, 10)}")
    for job in jobs:
        if not Path(job["out"]).is_file():
            raise ToolError(f"overlay_render.js reported success but {job['out']} does not exist")
    return jobs, stats


def _uri_to_path(uri: str) -> str:
    parsed = urlparse(uri)
    path = unquote(parsed.path)
    # file:///C:/x -> /C:/x on Windows; drop the leading slash before a drive letter.
    return path[1:] if re.match(r"^/[A-Za-z]:", path) else path


def _panel_size(width: int, height: int) -> tuple[int, int]:
    if height >= width:
        return width, height - _even(height / 2)
    return width - _even(width / 2), height


# --------------------------------------------------------------- checks


def _grab(source: str, at: float, w: int, h: int, pix_fmt: str) -> bytes:
    proc = subprocess.run(
        [tool_path("ffmpeg"), "-v", "error", "-ss", f"{max(0.0, at):.3f}", "-i", source, "-frames:v", "1",
         "-vf", f"scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", pix_fmt, "-"],
        capture_output=True,
    )
    size = w * h * (4 if pix_fmt == "rgba" else 3)
    if proc.returncode != 0 or len(proc.stdout) != size:
        raise ToolError(f"Could not read a frame of {source} at {at:.2f}s: "
                        f"{tail(proc.stderr.decode('utf-8', 'replace'))}")
    return proc.stdout


def _grid(width: int, height: int) -> tuple[int, int]:
    """Columns and rows of the overlap map: 9x16 on a vertical frame, 16x9 on a horizontal one."""
    return (MAP_COLS, MAP_ROWS) if height >= width else (MAP_ROWS, MAP_COLS)


def person_cells(video: str, start: float, end: float, width: int, height: int) -> set[tuple[int, int]]:
    """Cells where the person is, from three samples across the window (any sample counts)."""
    # 8x8 pixels per cell is enough for shares and keeps the pure-Python loops cheap.
    cols, rows = _grid(width, height)
    w, h = cols * 8, rows * 8
    cells: set[tuple[int, int]] = set()
    span = end - start
    for share in (0.2, 0.5, 0.8):
        buf = _grab(video, start + span * share, w, h, "rgb24")
        for row in range(rows):
            for col in range(cols):
                if _skin_share(buf, w, h, col * 8, row * 8, col * 8 + 8, row * 8 + 8) > PERSON_CELL:
                    cells.add((row, col))
    return cells


def overlay_cells(render: str, dur: float, width: int, height: int) -> set[tuple[int, int]]:
    """Cells a component paints, read from the alpha of its middle frame."""
    cols, rows = _grid(width, height)
    w, h = cols * 8, rows * 8
    buf = _grab(render, dur / 2, w, h, "rgba")
    cells: set[tuple[int, int]] = set()
    for row in range(rows):
        for col in range(cols):
            painted = 0
            for y in range(row * 8, row * 8 + 8):
                for x in range(col * 8, col * 8 + 8):
                    if buf[(y * w + x) * 4 + 3] > 16:
                        painted += 1
            if painted / 64 > OVERLAY_CELL:
                cells.add((row, col))
    return cells


def subtitle_rows(ass: Path | None, height: int, rows: int) -> set[int]:
    """Grid rows the subtitle block occupies, from the ASS style (two lines, bottom or top)."""
    if not ass:
        return set()
    text = ass.read_text(encoding="utf-8", errors="replace")
    play_y = re.search(r"^PlayResY:\s*(\d+)", text, re.M)
    style = re.search(r"^Style:\s*Default,(.*)$", text, re.M)
    if not style:
        return set()
    fields = [part.strip() for part in style.group(1).split(",")]
    try:
        size, alignment, margin_v = float(fields[1]), int(fields[17]), float(fields[20])
    except (IndexError, ValueError):
        return set()
    scale = height / float(play_y.group(1)) if play_y else 1.0
    block = 2 * 1.25 * size * scale
    if alignment in (1, 2, 3):
        top, bottom = height - margin_v * scale - block, height - margin_v * scale
    else:
        top, bottom = margin_v * scale, margin_v * scale + block
    cell = height / rows
    return {row for row in range(rows) if row * cell < bottom and (row + 1) * cell > top}


def check_overlays(events: list[dict], video: str, ass: Path | None, width: int, height: int) -> list[dict]:
    cols, rows = _grid(width, height)
    sub_rows = subtitle_rows(ass, height, rows)
    checks = []
    for event in events:
        if event["type"] not in OVERLAY_TYPES and not event.get("component"):
            continue
        dur = event["end"] - event["start"]
        painted = overlay_cells(event["render"], dur, width, height)
        item = {"event": event["index"], "type": event["type"], "start": event["start"],
                "painted_cells": len(painted)}
        if event["type"] not in COVERS_PERSON:
            person = person_cells(video, event["start"], event["end"], width, height)
            # Skin includes neck and hands. On a talking head the upper half of the skin rows
            # is the head: a card over the hands is fine, a card over the eyes is not, and one
            # number for both warned on a screenshot that only covered the chest.
            rows_with = sorted({row for row, _ in person})
            head = {cell for cell in person if cell[0] <= rows_with[0] + (rows_with[-1] - rows_with[0]) // 2} \
                if rows_with else set()
            item["person_cells"] = len(person)
            item["person_overlap"] = round(len(person & painted) / len(person), 3) if person else 0.0
            item["face_overlap"] = round(len(head & painted) / len(head), 3) if head else 0.0
        if sub_rows and event["type"] not in COVERS_PERSON:
            band = {(r, c) for r in sub_rows for c in range(cols)}
            item["subtitle_overlap"] = round(len(band & painted) / len(band), 3)
        warnings = []
        if item.get("face_overlap", 0) > FACE_WARN:
            warnings.append(f"covers {item['face_overlap']:.0%} of the head")
        if item.get("subtitle_overlap", 0) > SUBS_WARN:
            warnings.append(f"covers {item['subtitle_overlap']:.0%} of the subtitle band")
        item["warnings"] = warnings
        checks.append(item)
    return checks


# ---------------------------------------------------------------- graph


def build_graph(
    events: list[dict], width: int, height: int, ass: Path | None,
    *, source_label: str = "[0:v]", fps: float = 30.0,
) -> tuple[list[str], str]:
    """Inputs and filter_complex: layouts first, then overlays by layer, subtitles last."""
    inputs: list[str] = []
    parts: list[str] = []
    counter = 0

    def label() -> str:
        nonlocal counter
        counter += 1
        return f"[v{counter}]"

    def window(e: dict) -> str:
        return f"between(t,{e['start']:.3f},{e['end']:.3f})"

    cur = source_label
    overlay_input_index = 1
    for e in sorted((e for e in events if e["type"] in LAYOUT_TYPES), key=lambda e: e["start"]):
        s, t = e["start"], e["end"]
        main, side, piece, out = label(), label(), label(), label()
        parts.append(f"{cur}split=2{main}{side}")
        cut = f"{side}trim=start={s:.3f}:end={t:.3f},setpts=PTS-STARTPTS"
        if e["type"] == "punch":
            # Smoothstep ramps are evaluated on the original event clock, including across chunks.
            zoom = e["zoom"]
            cx, cy = e.get("center") or (0.5, 0.4)
            duration = e.get("_zoom_duration", t - s)
            offset = e.get("_zoom_offset", 0.0)
            ramp = min(0.3, duration / 2)
            progress = f"clip(min((on/{fps:.6f}+{offset:.6f})/{ramp:.6f},({duration:.6f}-on/{fps:.6f}-{offset:.6f})/{ramp:.6f}),0,1)"
            z = f"1+{zoom - 1:.6f}*({progress})*({progress})*(3-2*({progress}))"
            x = f"clip(iw*{cx:.6f}-iw/zoom/2,0,iw-iw/zoom)"
            y = f"clip(ih*{cy:.6f}-ih/zoom/2,0,ih-ih/zoom)"
            parts.append(f"{cut},zoompan=z='{z}':x='{x}':y='{y}':d=1:"
                         f"s={width}x{height}:fps={fps:.6f},setsar=1,setpts=PTS+{s:.3f}/TB{piece}")
            parts.append(f"{main}{piece}overlay=0:0:eof_action=pass:enable='{window(e)}'{out}")
            cur = out
            continue
        # split: crop the person out of the frame, then lay the panel over the other half.
        pw, ph = _panel_size(width, height)
        if height >= width:
            person_h = height - ph
            y = int(_clamp(float(e.get("person_y", 0.15)) * height, 0, height - person_h))
            parts.append(f"{cut},crop={width}:{person_h}:0:{y},setpts=PTS+{s:.3f}/TB{piece}")
            person_at, panel_at = ((0, ph) if e["person"] == "bottom" else (0, 0)), \
                ((0, 0) if e["person"] == "bottom" else (0, person_h))
        else:
            person_w = width - pw
            x = int(_clamp(float(e.get("person_x", 0.25)) * width, 0, width - person_w))
            parts.append(f"{cut},crop={person_w}:{height}:{x}:0,setpts=PTS+{s:.3f}/TB{piece}")
            person_at, panel_at = ((pw, 0) if e["person"] == "right" else (0, 0)), \
                ((0, 0) if e["person"] == "right" else (person_w, 0))
        placed, panel, out2 = label(), label(), label()
        parts.append(f"{main}{piece}overlay={person_at[0]}:{person_at[1]}:eof_action=pass:"
                     f"enable='{window(e)}'{placed}")
        inputs += ["-i", e["render"]]
        panel_index = overlay_input_index
        overlay_input_index += 1
        panel_input = f"[{panel_index}:v]"
        trim_start = e.get("_render_trim_start")
        trim_end = e.get("_render_trim_end")
        trim = (f"trim=start={trim_start:.3f}:end={trim_end:.3f}," if trim_start is not None else "")
        parts.append(f"{panel_input}{trim}setpts=PTS-STARTPTS+{s:.3f}/TB{panel}")
        parts.append(f"{placed}{panel}overlay={panel_at[0]}:{panel_at[1]}:eof_action=pass:"
                     f"enable='{window(e)}'{out2}")
        cur = out2

    overlays = [e for e in events if e["type"] not in LAYOUT_TYPES]
    for e in sorted(overlays, key=lambda e: (LAYER.get(e["type"], 20), e["start"])):
        inputs += ["-i", e["render"]]
        clip, out = label(), label()
        overlay_index = overlay_input_index
        overlay_input_index += 1
        overlay_input = f"[{overlay_index}:v]"
        trim_start = e.get("_render_trim_start")
        trim_end = e.get("_render_trim_end")
        trim = (f"trim=start={trim_start:.3f}:end={trim_end:.3f}," if trim_start is not None else "")
        parts.append(f"{overlay_input}{trim}setpts=PTS-STARTPTS+{e['start']:.3f}/TB{clip}")
        parts.append(f"{cur}{clip}overlay=0:0:eof_action=pass:format=auto:enable='{window(e)}'{out}")
        cur = out

    tail_filters = [f"ass='{_ass_filter_path(ass)}'"] if ass else []
    tail_filters.append("format=yuv420p")
    parts.append(f"{cur}{','.join(tail_filters)}[vout]")
    return inputs, ";".join(parts)


# ----------------------------------------------------------------- main


def print_timeline(events: list[dict]) -> None:
    for e in sorted(events, key=lambda e: e["start"]):
        detail = ""
        if e["type"] == "punch":
            detail = f"zoom {e['zoom']}"
        elif e["type"] == "split":
            detail = f"person {e['person']}, panel {Path(e['panel_component']).name}"
        else:
            p = e.get("params") or {}
            detail = (p.get("title") or p.get("label") or p.get("caption") or p.get("figure") or p.get("name")
                      or p.get("text") or Path(e["component"]).name)
        print(f"  {format_time(e['start'])} -> {format_time(e['end'])}  {e['type']:<10} {detail}")


def _ass_seconds(value: str) -> float:
    hours, minutes, seconds = value.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def _ass_timestamp(seconds: float) -> str:
    centiseconds = max(0, int(seconds * 100))
    hours, rest = divmod(centiseconds, 360000)
    minutes, rest = divmod(rest, 6000)
    whole, fraction = divmod(rest, 100)
    return f"{hours}:{minutes:02d}:{whole:02d}.{fraction:02d}"


def _slice_ass(source: Path | None, start: float, end: float, destination: Path) -> Path | None:
    """Copy an ASS subtitle file with events clipped and shifted to a chunk."""
    if source is None:
        return None
    output: list[str] = []
    for line in source.read_text(encoding="utf-8-sig").splitlines():
        if not line.startswith("Dialogue:"):
            output.append(line)
            continue
        fields = line[len("Dialogue:"):].strip().split(",", 9)
        if len(fields) != 10:
            raise ToolError(f"Malformed ASS Dialogue line in {source}: {line[:100]}")
        try:
            cue_start = _ass_seconds(fields[1])
            cue_end = _ass_seconds(fields[2])
        except ValueError as exc:
            raise ToolError(f"Malformed ASS timestamp in {source}: {line[:100]}") from exc
        clipped_start, clipped_end = max(start, cue_start), min(end, cue_end)
        if clipped_end <= clipped_start:
            continue
        fields[1] = _ass_timestamp(clipped_start - start)
        fields[2] = _ass_timestamp(clipped_end - start)
        output.append("Dialogue: " + ",".join(fields))
    destination.write_text("\n".join(output) + "\n", encoding="utf-8")
    return destination


def _chunk_events(events: list[dict], start: float, end: float) -> list[dict]:
    """Clip global enhancement events to a chunk-local timeline."""
    selected: list[dict] = []
    for event in events:
        absolute_start, absolute_end = float(event["start"]), float(event["end"])
        overlap_start, overlap_end = max(start, absolute_start), min(end, absolute_end)
        if overlap_end <= overlap_start:
            continue
        clipped = dict(event)
        clipped["start"] = round(overlap_start - start, 6)
        clipped["end"] = round(overlap_end - start, 6)
        if event["type"] == "punch":
            clipped["_zoom_offset"] = overlap_start - absolute_start
            clipped["_zoom_duration"] = absolute_end - absolute_start
        else:
            clipped["_render_trim_start"] = max(0.0, overlap_start - absolute_start)
            clipped["_render_trim_end"] = min(absolute_end - absolute_start, overlap_end - absolute_start)
        selected.append(clipped)
    return selected


def _encode_enhanced_chunks(
    *, video: Path, events: list[dict], output: Path,
    width: int, height: int, fps: float, duration: float,
    crf: int, preset: str, ass: Path | None, audio_info: dict | None,
    renders_dir: Path, chunk_seconds: float, chunk_timeout: float, started: float,
) -> dict:
    """Compose short closed MP4 chunks and concatenate their video without re-encoding.

    The input is sought to each chunk start. Event windows, rendered overlay
    media and ASS cues are clipped and shifted into that chunk's local timeline;
    only matching event clips are added as inputs. This avoids the sandbox's
    short wall-time ceiling while preserving one visual composition per frame.
    """
    if chunk_seconds <= 0:
        raise ToolError(f"--chunk-seconds must be greater than zero (got {chunk_seconds}).")
    if chunk_timeout <= 0:
        raise ToolError(f"--chunk-timeout must be greater than zero (got {chunk_timeout}).")
    if output.suffix.lower() != ".mp4":
        raise ToolError("--chunked enhancement requires an MP4 output for temporary chunks.")
    chunk_total = max(1, int(math.ceil(duration / chunk_seconds)))
    if chunk_total > 400:
        raise ToolError(f"Chunked enhancement requires {chunk_total} chunks; maximum is 400.")
    sample_rate = int((audio_info or {}).get("sample_rate") or 48000)
    channels = int((audio_info or {}).get("channels") or 2)
    audio_bitrate = "192k"

    with tempfile.TemporaryDirectory(prefix=f".{output.stem}.chunks-", dir=output.parent) as temp:
        work = Path(temp)
        chunks: list[Path] = []
        for index in range(chunk_total):
            start = index * chunk_seconds
            end = min(duration, (index + 1) * chunk_seconds)
            local_events = _chunk_events(events, start, end)
            for event in local_events:
                if event["type"] != "split":
                    continue
                candidates = [
                    Path(event["render"]) if event.get("render") else None,
                    *renders_dir.glob(f"{event['index']:02d}_split_*.mov"),
                ]
                panel_render = next((item for item in candidates if item and item.is_file()), None)
                if panel_render is None:
                    raise ToolError(
                        f"Could not locate rendered panel for split event {event['index']}; "
                        "re-render the component clips or disable --chunked."
                    )
                event["render"] = str(panel_render)
            local_ass = _slice_ass(ass, start, end, work / f"subs-{index:04d}.ass")
            overlay_inputs, graph = build_graph(
                local_events, width, height, local_ass, source_label="[vsrc]", fps=fps
            )
            local_graph = work / f"filter-{index:04d}.txt"
            local_graph.write_text(
                "[0:v]setpts=PTS-STARTPTS[vsrc];\n" + graph,
                encoding="utf-8",
            )
            chunk = work / f"{index:04d}.mp4"
            cmd = ["-ss", f"{start:.6f}", "-i", str(video), *overlay_inputs,
                   "-t", f"{end - start:.6f}", "-filter_complex_script", str(local_graph),
                   "-map", "[vout]"]
            if audio_info:
                cmd += ["-map", "0:a:0", "-af", "aresample=async=1:first_pts=0",
                        "-c:a", "aac", "-b:a", audio_bitrate,
                        "-ar", str(sample_rate), "-ac", str(channels)]
            else:
                cmd += ["-an"]
            cmd += [
                "-c:v", "libx264", "-crf", str(crf), "-preset", preset,
                "-pix_fmt", "yuv420p", "-threads", "1", "-r", f"{fps:.6f}",
                "-fps_mode", "cfr", "-movflags", "+faststart", str(chunk),
            ]
            run_ffmpeg(cmd, timeout=chunk_timeout)
            chunks.append(chunk)

        manifest = work / "concat.txt"
        manifest.write_text(
            "".join("file '" + str(path.resolve()).replace("'", "'\\''") + "'\n" for path in chunks),
            encoding="utf-8",
        )
        concat = ["-f", "concat", "-safe", "0", "-i", str(manifest), "-map", "0:v:0"]
        if audio_info:
            concat += ["-map", "0:a:0"]
        # Independent audio chunks carry AAC priming packets; re-encode only
        # audio at concat so the final audio clock aligns with the copied video.
        if audio_info:
            concat += ["-c:v", "copy", "-c:a", "aac", "-b:a", audio_bitrate]
        else:
            concat += ["-c:v", "copy"]
        concat += ["-movflags", "+faststart", str(output)]
        run_ffmpeg(concat, timeout=chunk_timeout)

    report = output_report(output, started, {
        "chunked": True,
        "chunk_seconds": chunk_seconds,
        "chunk_timeout_seconds": chunk_timeout,
        "chunk_count": chunk_total,
        "expected_duration_seconds": round(duration, 3),
    })
    if report.get("probe_error"):
        raise ToolError(f"Completed chunked output could not be probed: {report['probe_error']}")
    actual = report.get("duration_seconds")
    if actual is None or abs(actual - duration) > 0.25:
        raise ToolError(
            f"Chunked output duration is {actual}s; expected {duration:.3f}s (tolerance 0.25s)."
        )
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compose HTML components, zooms and split layouts over a video.")
    parser.add_argument("plan", help="Enhancement plan JSON")
    parser.add_argument("--video", required=True, help="Video to enhance (the cut, not the original)")
    parser.add_argument("--ass", help="Subtitles to burn in the same pass (from `subtitles build`)")
    parser.add_argument("--output", help="Output MP4 (default: <video>_enhanced.mp4 next to the video)")
    parser.add_argument("--renders-dir", help="Where component clips are cached (default: <output>_renders)")
    parser.add_argument("--plan-only", action="store_true", help="Validate and print the timeline, render nothing")
    parser.add_argument("--no-check", action="store_true", help="Skip the face and subtitle overlap checks")
    parser.add_argument("--crf", type=int, default=20)
    parser.add_argument("--preset", default="medium")
    parser.add_argument("--json", help="Write the report as JSON")
    parser.add_argument("--chunked", action="store_true",
                        help="Encode short output clips then concat by stream copy")
    parser.add_argument("--chunk-seconds", type=float, default=8.0,
                        help="Maximum output span per chunk when --chunked (default 8s)")
    parser.add_argument("--chunk-timeout", type=float, default=30.0,
                        help="Seconds allowed for each FFmpeg chunk (default 30; lower chunk size if exceeded)")
    args = parser.parse_args(argv)

    started = time.time()
    try:
        plan_path = require_input(args.plan)
        video = require_input(args.video)
        ass = require_input(args.ass) if args.ass else None
        info = probe(video)
        stream = stream_of(info, "video")
        if not stream:
            raise ToolError(f"No video stream in {video}")
        width, height = int(stream["width"]), int(stream["height"])
        fps = round(frame_rate_of({"r_frame_rate": stream.get("r_frame_rate")}) or frame_rate_of(stream) or 30, 3)
        duration = duration_of(info)

        events, errors = load_plan(plan_path, width, height, duration)
        print(f"Enhancement plan: {plan_path.name}")
        print(f"  video:  {video.name}  {width}x{height} @ {fps:g} fps, {format_time(duration)}")
        print(f"  events: {len(events)} valid, {len(errors)} problems")
        print_timeline(events)
        if errors:
            for problem in errors:
                print(f"  ERROR: {problem}")
            return 2
        if args.plan_only:
            return 0

        out = Path(args.output) if args.output else video.with_name(f"{video.stem}_enhanced.mp4")
        if out.resolve() == video.resolve():
            raise ToolError("Output path must differ from the input video; the source is never overwritten.")
        renders = Path(args.renders_dir) if args.renders_dir else out.with_name(f"{out.stem}_renders")
        _, stats = render_jobs(events, width, height, fps, renders)
        print(f"  renders: {stats['rendered']} rendered, {stats['reused']} reused, {stats['seconds']}s")

        checks = [] if args.no_check else check_overlays(events, str(video), ass, width, height)
        for item in checks:
            if item["warnings"]:
                print(f"  WARNING: event {item['event']} ({item['type']} at {format_time(item['start'])}): "
                      + "; ".join(item["warnings"]))

        inputs, graph = build_graph(events, width, height, ass, fps=fps)
        out.parent.mkdir(parents=True, exist_ok=True)
        graph_file = renders / "filter_complex.txt"
        graph_file.parent.mkdir(parents=True, exist_ok=True)
        graph_file.write_text(graph, encoding="utf-8")
        cmd = ["-i", str(video), *inputs, "-filter_complex_script", str(graph_file), "-map", "[vout]"]
        cmd += ["-map", "0:a?", "-c:a", "copy"] if stream_of(info, "audio") else []
        cmd += ["-c:v", "libx264", "-crf", str(args.crf), "-preset", args.preset, "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", str(out)]
        encode_started = time.time()
        if args.chunked:
            report = _encode_enhanced_chunks(
                video=video,
                events=events,
                output=out,
                width=width,
                height=height,
                fps=fps,
                duration=duration,
                crf=args.crf,
                preset=args.preset,
                ass=ass,
                audio_info=stream_of(info, "audio"),
                renders_dir=renders,
                chunk_seconds=args.chunk_seconds,
                chunk_timeout=args.chunk_timeout,
                started=started,
            )
        else:
            run_ffmpeg(cmd)
            report = None
        encode_seconds = round(time.time() - encode_started, 2)

        report = report or output_report(out, started)
        report.update({
            "source": str(video), "plan": str(plan_path), "subtitles": str(ass) if ass else None,
            "events": [{k: v for k, v in e.items() if k not in ("params", "panel_params")} for e in events],
            "renders": stats, "checks": checks, "encode_seconds": encode_seconds,
            "expected_duration_seconds": round(duration, 3),
            "chunked": bool(args.chunked),
            "chunk_seconds": args.chunk_seconds if args.chunked else None,
            "chunk_timeout_seconds": args.chunk_timeout if args.chunked else None,
        })
        if args.json:
            write_json(report, args.json)
        drift = abs(report.get("duration_seconds", 0) - duration)
        print(f"  output:  {out}")
        print(f"  size:    {report['size_bytes'] / (1024 * 1024):.1f} MiB")
        print(f"  duration: {format_time(report.get('duration_seconds'))} (expected {duration:.3f}s)")
        print(f"  encode:  {encode_seconds}s, total {report['elapsed_seconds']}s")
        if drift > 0.15:
            print(f"  ERROR: output duration differs from the input by {drift:.2f}s")
            return 1
        return 0
    except ToolError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
