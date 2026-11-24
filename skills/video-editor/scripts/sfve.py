#!/usr/bin/env python3
"""Script First Video Edition: prepare a reviewable script, then apply user edits."""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

from ffmpeg_lib import ToolError, duration_of, probe, stream_of, write_json
from script_read import flatten_words
from enhance import load_plan

HERE = Path(__file__).resolve().parent
LINE = re.compile(r"^@(\d{4,})\s+(\d+\.\d{3})s\s+\|\s*(.*)$")
DIRECTIVE = re.compile(r"^\[(zoom|pantalla|overlay|imagen)\s+(\d+(?:\.\d+)?)s(?:\s*:\s*(.+))?\]$", re.I)
ADVANCED = re.compile(r"^\[efecto\s+(\{.*\})\]$", re.I)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def command(*args):
    result = subprocess.run([sys.executable, *(str(x) for x in args)], text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.stdout:
        print(result.stdout, end="", flush=True)
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr, flush=True)
    if result.returncode:
        raise ToolError(f"{Path(args[0]).name} failed with exit code {result.returncode}")


def norm(text):
    text = unicodedata.normalize("NFD", text.casefold())
    return "".join(c for c in text if c.isalnum() and unicodedata.category(c) != "Mn")


def parse_script(path):
    segments, current = {}, None
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            current = None
            continue
        match = LINE.fullmatch(line)
        if match:
            idx = int(match.group(1))
            if idx in segments or (segments and idx <= next(reversed(segments))):
                raise ToolError(f"Line {lineno}: duplicate or reordered segment {idx}")
            segments[idx] = {"time": match.group(2), "text": match.group(3), "directives": []}
            current = idx
        elif line.startswith("[") and line.endswith("]") and current is not None:
            if not DIRECTIVE.fullmatch(line) and not ADVANCED.fullmatch(line):
                raise ToolError(f"Line {lineno}: unsupported edit instruction: {line}")
            segments[current]["directives"].append(line)
        else:
            raise ToolError(f"Line {lineno}: invalid script line: {line}")
    return segments


def prepare(args):
    source = Path(args.video).resolve(strict=True)
    project = Path(args.project).resolve()
    if project.exists():
        raise ToolError(f"Project already exists: {project}; choose a new project path")
    project.mkdir(parents=True)
    tight = project / "tight.mp4"
    started = time.monotonic()
    command(HERE / "analyze.py", source, "--sheet", project / "contact.jpg",
            "--json", project / "metadata.json")
    command(HERE / "silence.py", source, "--min-silence", "0.8", "--pad", "0.08",
            "--chunked", "--chunk-seconds", "60", "--chunk-timeout", "30",
            "--output", tight, "--json", project / "silence.json")
    transcribe_args = [HERE / "transcribe.py", tight, "--output-dir", project,
                       "--model", args.model, "--threads", str(args.threads)]
    if args.language:
        transcribe_args += ["--language", args.language]
    if args.download_model:
        transcribe_args.append("--download-model")
    command(*transcribe_args)
    transcript = project / "tight.json"
    data = json.loads(transcript.read_text(encoding="utf-8"))
    words = flatten_words(data.get("segments") or [])
    if not words:
        raise ToolError("Transcript has no timed words")
    grouped = {}
    for word in words:
        grouped.setdefault(word["segment"], []).append(word)
    lines = [
        "# SFVE - guion para revisar",
        "# Borra palabras o bloques para quitarlos del video. Conserva los identificadores y tiempos.",
        "# Corrige texto si hace falta; cambiar texto no crea audio nuevo.",
        "# Las líneas entre corchetes son sugerencias: edítalas o elimínalas.",
        "# Al devolver este guion se aceptan las indicaciones que permanezcan.",
        "# Formatos: [zoom 2s]  [pantalla 6s: Título]  [overlay 3s: Texto]  [imagen 5s: ruta/local.jpg]",
        '# Avanzado: [efecto {"type":"counter","duration":3,"params":{"value":10}}]',
        "# Cada efecto empieza en la primera palabra conservada del bloque anterior.",
        "",
    ]
    next_zoom = 0.0
    for index, segment_words in grouped.items():
        start = segment_words[0]["start"]
        text = " ".join(w["text"] for w in segment_words)
        lines.append(f"@{index:04d} {start:.3f}s | {text}")
        if start >= next_zoom:
            lines.append("[zoom 2s]")
            next_zoom = start + 30.0
        lines.append("")
    baseline = project / "original.sfve.md"
    edited = project / "guion.sfve.md"
    script = "\n".join(lines) + "\n"
    baseline.write_text(script, encoding="utf-8")
    edited.write_text(script, encoding="utf-8")
    manifest = {"version": 1, "status": "draft", "source": str(source), "video": tight.name,
                "transcript": transcript.name, "baseline": baseline.name,
                "video_sha256": digest(tight), "transcript_sha256": digest(transcript),
                "baseline_sha256": digest(baseline), "elapsed_seconds": round(time.monotonic() - started, 2)}
    write_json(manifest, project / "sfve.json")
    print(f"SFVE draft: {edited}")
    print("Add contextual edit suggestions, then run freeze before delivering the script.")
    print(f"Original baseline: {baseline}")
    print(f"Preparation: {manifest['elapsed_seconds']}s")


def diff_project(project, edited):
    manifest = json.loads((project / "sfve.json").read_text(encoding="utf-8"))
    for key in ("video", "transcript", "baseline"):
        path = Path(manifest[key])
        if not path.is_absolute():
            path = project / path
        if not path.is_file() or digest(path) != manifest[key + "_sha256"]:
            raise ToolError(f"{key} is missing or changed since preparation: {path}")
        manifest[key] = str(path.resolve())
    baseline = parse_script(Path(manifest["baseline"]))
    reviewed = parse_script(edited)
    unknown = set(reviewed) - set(baseline)
    if unknown:
        raise ToolError(f"Unknown segment IDs: {sorted(unknown)}")
    data = json.loads(Path(manifest["transcript"]).read_text(encoding="utf-8"))
    words = flatten_words(data.get("segments") or [])
    grouped = {}
    for word in words:
        grouped.setdefault(word["segment"], []).append(word)
    if set(grouped) != set(baseline):
        raise ToolError("Baseline segment IDs do not match the transcript")
    removed, corrections, kept_by_segment = [], [], {}
    for idx, original in baseline.items():
        src = grouped[idx]
        if idx not in reviewed:
            removed.extend(src)
            continue
        now = reviewed[idx]
        if now["time"] != original["time"]:
            raise ToolError(f"Segment {idx}: timestamps must not be edited")
        old = [w["norm"] for w in src]
        new_words = [x for x in now["text"].split() if norm(x)]
        new = [norm(x) for x in new_words]
        keep = set()
        for op, i, j, a, b in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
            if op == "equal":
                keep.update(range(i, j))
                for offset in range(j - i):
                    before, after = src[i + offset]["text"], new_words[a + offset]
                    if before != after:
                        corrections.append({"segment": idx, "from": [before],
                                            "to": [after], "audio_changed": False})
            elif op == "delete":
                removed.extend(src[i:j])
            elif op == "replace" and j - i == b - a:
                keep.update(range(i, j))
                corrections.append({"segment": idx, "from": [w["text"] for w in src[i:j]],
                                    "to": new_words[a:b], "audio_changed": False})
            else:
                raise ToolError(f"Segment {idx}: inserted or ambiguous replacement words cannot be "
                                "created in the recorded audio; remove words or use one-for-one corrections")
        kept_by_segment[idx] = [word for n, word in enumerate(src) if n in keep]
        if now["directives"] and not kept_by_segment[idx]:
            raise ToolError(f"Segment {idx}: remove its edit instructions or retain a word")
    removed_indices = {w["index"] for w in removed}
    ranges = []
    for w in words:
        if w["index"] in removed_indices:
            if ranges and ranges[-1]["to_word"] == w["index"] - 1:
                ranges[-1]["to_word"] = w["index"]
                ranges[-1]["end"] = w["end"]
            else:
                ranges.append({"from_word": w["index"], "to_word": w["index"],
                               "start": w["start"], "end": w["end"]})
    for cut in ranges:
        if cut["end"] <= cut["start"]:
            raise ToolError(f"Invalid word timestamps in cut {cut}")
        for word in words:
            if word["index"] not in removed_indices and word["start"] < cut["end"] and word["end"] > cut["start"]:
                raise ToolError(f"Deleted words overlap a retained word in time: {cut}; review timestamps")
    def mapped(t):
        return t - sum(max(0.0, min(t, c["end"]) - c["start"]) for c in ranges if t > c["start"])
    duration = duration_of(probe(Path(manifest["video"])))
    events = []
    for idx, item in reviewed.items():
        for directive in item["directives"]:
            match = DIRECTIVE.fullmatch(directive)
            advanced = ADVANCED.fullmatch(directive)
            raw = {}
            if advanced:
                raw = json.loads(advanced.group(1))
                if not isinstance(raw, dict) or not raw.get("type") or "duration" not in raw:
                    raise ToolError(f"Segment {idx}: advanced effect requires type and duration")
                if any(key in raw for key in ("start", "end", "render", "index")):
                    raise ToolError(f"Segment {idx}: advanced effect cannot override its timeline")
                kind, length, value = "efecto", float(raw.pop("duration")), None
            else:
                kind, length, value = match.group(1).lower(), float(match.group(2)), match.group(3)
            if not 0 < length <= 30:
                raise ToolError(f"Segment {idx}: effect duration must be 0-30 seconds")
            start = kept_by_segment[idx][0]["start"]
            output_duration = duration - sum(c["end"] - c["start"] for c in ranges)
            mapped_start = mapped(start)
            if mapped_start < 0 or mapped_start >= output_duration:
                raise ToolError(f"Segment {idx}: effect starts outside the edited video")
            event = {"start": round(mapped_start, 3),
                     "end": round(min(output_duration, mapped_start + length), 3)}
            if event["end"] <= event["start"]:
                raise ToolError(f"Segment {idx}: effect has no duration in the edited video")
            if kind == "efecto":
                event.update(raw)
                for params in (event.get("params"), (event.get("panel") or {}).get("params")):
                    if isinstance(params, dict) and params.get("src"):
                        image = Path(params["src"])
                        if not image.is_absolute():
                            image = edited.parent / image
                        if not image.is_file():
                            raise ToolError(f"Segment {idx}: image not found: {image}")
                        params["src"] = str(image.resolve())
            elif kind == "zoom":
                if value:
                    raise ToolError(f"Segment {idx}: zoom takes no text")
                event.update(type="punch", zoom=1.2, center=[0.5, 0.4])
            else:
                if not value or not value.strip():
                    raise ToolError(f"Segment {idx}: {kind} requires text or a local image path")
                value = value.strip()
                if kind == "imagen":
                    image = Path(value)
                    if not image.is_absolute():
                        image = edited.parent / image
                    if not image.is_file():
                        raise ToolError(f"Segment {idx}: image not found: {image}")
                    event.update(type="broll", params={"src": str(image.resolve())})
                elif kind == "pantalla":
                    event.update(type="screen-detail", params={"title": value})
                else:
                    event.update(type="callout", params={"title": value})
            events.append(event)
    changes = {"deleted_words": [{"index": w["index"], "text": w["text"],
                                  "start": w["start"], "end": w["end"]} for w in removed],
               "text_corrections": corrections,
               "instructions_before": {str(k): v["directives"] for k, v in baseline.items() if v["directives"]},
               "instructions_after": {str(k): v["directives"] for k, v in reviewed.items() if v["directives"]},
               "cuts": ranges, "events": events}
    return manifest, changes, duration


def freeze(args):
    project = Path(args.project).resolve(strict=True)
    draft = project / "guion.sfve.md"
    manifest, changes, _ = diff_project(project, draft)
    if manifest.get("status") != "draft":
        raise ToolError("Project is already frozen for review")
    if changes["deleted_words"] or changes["text_corrections"]:
        raise ToolError("A draft may add suggestions but must not change the transcribed speech")
    baseline = Path(manifest["baseline"])
    baseline.write_text(draft.read_text(encoding="utf-8"), encoding="utf-8")
    manifest["baseline_sha256"] = digest(baseline)
    manifest["status"] = "awaiting_review"
    for key in ("video", "transcript", "baseline"):
        manifest[key] = str(Path(manifest[key]).relative_to(project))
    write_json(manifest, project / "sfve.json")
    print(f"Ready for user review: {draft}")


def apply(args):
    project = Path(args.project).resolve(strict=True)
    edited = Path(args.script).resolve(strict=True)
    manifest, changes, duration = diff_project(project, edited)
    if manifest.get("status") != "awaiting_review":
        raise ToolError("Freeze the draft before asking the user to review it")
    source = Path(manifest["video"])
    cut_path, plan_path, report_path = (project / "sfve.cuts.json", project / "sfve.enhance.json",
                                        project / "sfve.diff.json")
    cuts = [{"from_word": c["from_word"], "to_word": c["to_word"], "reason": "removed by user"}
            for c in changes["cuts"]]
    write_json({"transcript_json": manifest["transcript"], "transcript_total_seconds": duration, "cuts": cuts}, cut_path)
    write_json({"events": changes["events"]}, plan_path)
    write_json(changes, report_path)
    info = probe(source)
    video = stream_of(info, "video")
    final_duration = duration - sum(c["end"] - c["start"] for c in changes["cuts"])
    if final_duration <= 0:
        raise ToolError("The reviewed script removes the entire video")
    _, errors = load_plan(plan_path, int(video["width"]), int(video["height"]), final_duration)
    if errors:
        raise ToolError("Invalid effects: " + "; ".join(errors))
    print(f"Diff: {len(changes['deleted_words'])} deleted words, {len(changes['text_corrections'])} text corrections, "
          f"{len(changes['events'])} effects. Report: {report_path}")
    if changes["text_corrections"]:
        print("Text corrections do not change the recorded audio.")
    if args.plan_only:
        return
    output = Path(args.output).resolve()
    if output.exists() or output == source:
        raise ToolError(f"Output already exists or is the source: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    current = source
    if cuts:
        current = project / "sfve.cut.mp4"
        if current.exists():
            raise ToolError(f"Intermediate already exists: {current}; use a fresh project")
        command(HERE / "script_cut.py", cut_path, "--video", source, "--pad", "0",
                "--chunked", "--chunk-seconds", "60", "--chunk-timeout", "30", "--output", current)
    if changes["events"]:
        command(HERE / "enhance.py", plan_path, "--video", current, "--output", output,
                "--chunked", "--chunk-seconds", "8", "--chunk-timeout", "30",
                "--preset", "veryfast", "--json", project / "sfve.render.json")
    else:
        shutil.copy2(current, output)
    command(HERE / "analyze.py", output, "--samples", "1", "--json", project / "sfve.output.json")
    result = subprocess.run(["ffmpeg", "-v", "error", "-i", str(output), "-f", "null", "-"],
                            capture_output=True, text=True)
    if result.returncode:
        raise ToolError(f"Final decode failed: {result.stderr.strip()}")
    print(f"SFVE output verified: {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    p = sub.add_parser("prepare", help="Analyze, cut silence, transcribe and stop for user review")
    p.add_argument("video")
    p.add_argument("--project", required=True)
    p.add_argument("--model", default="base")
    p.add_argument("--language")
    p.add_argument("--threads", type=int, default=1)
    p.add_argument("--download-model", action="store_true")
    p.set_defaults(func=prepare)
    p = sub.add_parser("freeze", help="Save the suggested draft as the review baseline")
    p.add_argument("--project", required=True)
    p.set_defaults(func=freeze)
    p = sub.add_parser("apply", help="Diff the returned script and apply the selected edits")
    p.add_argument("--project", required=True)
    p.add_argument("--script", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--plan-only", action="store_true")
    p.set_defaults(func=apply)
    args = parser.parse_args()
    try:
        args.func(args)
    except (ToolError, OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
