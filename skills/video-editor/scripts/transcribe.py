#!/usr/bin/env python3
"""Transcribe a video with the existing video_transcription skill and turn the
result into a timed script ready for review.

Usage:
    python3 scripts/transcribe.py INPUT [--output-dir DIR] [--language es]
                                        [--model small] [--formats json,srt,txt]

This script deliberately does **not** reimplement speech recognition. The
`video_transcription` skill is the single source of truth for transcription, so
this module only locates it, runs it, and reshapes its JSON into the two things
the rest of the pipeline needs:

1. `*.json`  - the raw transcript, untouched, with segment and word timestamps.
2. `*.script.md` - the same content as a readable, timecoded script. That is the
   artifact a human or a model reviews to judge whether the script makes sense.

Keeping the script separate from the transcript matters: the transcript is
evidence, the script is the thing being edited.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ffmpeg_lib import (  # noqa: E402
    ToolError,
    ensure_output_dir,
    format_time,
    require_input,
    write_json,
)

SKILL_NAME = "video_transcription"
DEFAULT_FORMATS = "json,srt,txt"


def _candidate_roots() -> list[Path]:
    """Places where a sibling `video_transcription` skill may live.

    Checked in order, so an explicit env var always wins over autodetection.
    """
    roots: list[Path] = []
    override = os.environ.get("VIDEO_TRANSCRIPTION_DIR")
    if override:
        roots.append(Path(override))
    here = Path(__file__).resolve()
    # skills/video-editor/scripts -> skills/
    for parent in here.parents:
        roots.append(parent / "skills" / SKILL_NAME)
        roots.append(parent / "skill" / SKILL_NAME)
    # The transcription skill usually lives in the workspace that runs this one.
    cwd = Path.cwd().resolve()
    for parent in (cwd, *cwd.parents):
        roots.append(parent / "skill" / SKILL_NAME)
        roots.append(parent / "skills" / SKILL_NAME)
    return roots

def locate_skill() -> Path:
    """Return the directory of the transcription skill, or explain what is missing."""
    seen: set[Path] = set()
    tried: list[str] = []
    for candidate in _candidate_roots():
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        tried.append(str(resolved))
        if (resolved / "transcribe_video.py").is_file():
            return resolved
    raise ToolError(
        f"Could not find the `{SKILL_NAME}` skill. Looked in:\n  "
        + "\n  ".join(tried)
        + "\nSet VIDEO_TRANSCRIPTION_DIR to the skill folder to override."
    )


def locate_python(skill: Path) -> str:
    """Python interpreter that can import faster_whisper.

    The skill's own `.venv` is preferred, then an explicit override, then the
    interpreter running this script if it happens to have the package.
    """
    override = os.environ.get("VIDEO_TRANSCRIPTION_PYTHON")
    if override and Path(override).is_file():
        return override
    for relative in (".venv/Scripts/python.exe", ".venv/bin/python"):
        candidate = skill / relative
        if candidate.is_file():
            return str(candidate)
    if _has_faster_whisper(sys.executable):
        return sys.executable
    raise ToolError(
        f"No Python with faster-whisper found for {skill}. Create the environment first:\n"
        f"  {skill / 'install_windows.bat'}\n"
        "or set VIDEO_TRANSCRIPTION_PYTHON to an interpreter that has the package."
    )


def _has_faster_whisper(python: str) -> bool:
    import subprocess

    proc = subprocess.run(
        [python, "-c", "import faster_whisper"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return proc.returncode == 0


def run_transcription(
    skill: Path,
    python: str,
    source: Path,
    output_dir: Path,
    base_name: str,
    language: str,
    model: str,
    formats: str,
    extra: list[str],
) -> Path:
    """Run the transcription skill and return the JSON it wrote."""
    import subprocess

    command = [
        python,
        str(skill / "transcribe_video.py"),
        str(source),
        "--output-dir", str(output_dir),
        "--base-name", base_name,
        "--formats", formats,
        "--language", language,
        "--model", model,
        "--force",
        *extra,
    ]
    proc = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise ToolError(
            f"transcription failed with code {proc.returncode}\n"
            f"command: {' '.join(command)}\n{detail[-2000:]}"
        )
    transcript = output_dir / f"{base_name}.json"
    if not transcript.is_file():
        raise ToolError(
            f"transcription reported success but wrote no JSON at {transcript}\n"
            f"stdout: {proc.stdout.strip()[-1000:]}"
        )
    return transcript


def load_transcript(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ToolError(f"Transcript is not valid JSON: {path}: {exc}") from exc
    if not isinstance(data.get("segments"), list):
        raise ToolError(f"Transcript has no `segments` list: {path}")
    return data


def render_script(transcript: dict, source_name: str) -> str:
    """Timecoded script: one line per segment, plus a header with the basics.

    This is the review artifact. Timestamps are absolute in the transcribed
    file, which is why the pipeline transcribes the *already cut* video.
    """
    segments = transcript.get("segments", [])
    words = sum(len(item.get("words") or []) for item in segments)
    duration = transcript.get("duration") or 0.0
    speech = sum(
        max(0.0, float(item.get("end", 0)) - float(item.get("start", 0)))
        for item in segments
    )
    lines = [
        f"# Script: {source_name}",
        "",
        f"- language: {transcript.get('language')} "
        f"(p={transcript.get('language_probability')})",
        f"- duration: {format_time(duration)} ({duration}s)",
        f"- segments: {len(segments)}, words: {words}",
        f"- speech time: {format_time(speech)}, "
        f"pace: {(words / speech * 60):.0f} words/min" if speech else "- speech time: 0",
        "",
        "## Timeline",
        "",
    ]
    for index, item in enumerate(segments):
        start = format_time(float(item.get("start", 0)))
        end = format_time(float(item.get("end", 0)))
        text = (item.get("text") or "").strip()
        lines.append(f"[{index:03d}] {start} -> {end}  {text}")
    lines.append("")
    return "\n".join(lines)


def transcribe(args: argparse.Namespace) -> dict:
    started = time.time()
    source = require_input(args.input)
    skill = locate_skill()
    python = locate_python(skill)

    output_dir = ensure_output_dir(Path(args.output_dir))
    base_name = args.base_name or source.stem.replace(" ", "_")

    transcript_path = run_transcription(
        skill=skill,
        python=python,
        source=source,
        output_dir=output_dir,
        base_name=base_name,
        language=args.language,
        model=args.model,
        formats=args.formats,
        extra=args.transcribe_arg or [],
    )

    transcript = load_transcript(transcript_path)
    script_text = render_script(transcript, source.name)
    script_path = output_dir / f"{base_name}.script.md"
    script_path.write_text(script_text, encoding="utf-8")

    segments = transcript["segments"]
    speech = sum(
        max(0.0, float(item.get("end", 0)) - float(item.get("start", 0)))
        for item in segments
    )
    return {
        "operation": "transcribe",
        "input": str(source),
        "skill_dir": str(skill),
        "python": python,
        "transcript_json": str(transcript_path),
        "script_markdown": str(script_path),
        "language": transcript.get("language"),
        "duration_seconds": transcript.get("duration"),
        "segment_count": len(segments),
        "word_count": sum(len(item.get("words") or []) for item in segments),
        "speech_seconds": round(speech, 3),
        "words_per_minute": round(
            (sum(len(item.get("words") or []) for item in segments) / speech * 60), 1
        ) if speech else None,
        "elapsed_seconds": round(time.time() - started, 2),
    }


def render_result(report: dict) -> str:
    lines = [
        "Transcribed",
        f"  transcript: {report['transcript_json']}",
        f"  script:     {report['script_markdown']}",
        f"  language:   {report['language']}",
        f"  duration:   {format_time(report['duration_seconds'])} "
        f"({report['duration_seconds']}s)",
        f"  segments:   {report['segment_count']}, words: {report['word_count']}",
    ]
    if report.get("words_per_minute"):
        lines.append(f"  pace:       {report['words_per_minute']:.0f} words/min")
    lines.append(f"  elapsed:    {report['elapsed_seconds']}s")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Transcribe a video with the video_transcription skill and "
        "produce a timecoded script."
    )
    parser.add_argument("input", help="Video or audio file")
    parser.add_argument("--output-dir", default="video-output")
    parser.add_argument("--base-name", help="Base name for output files")
    parser.add_argument("--language", default="es", help="Language code or auto")
    parser.add_argument("--model", default="small", help="Whisper model")
    parser.add_argument(
        "--formats", default=DEFAULT_FORMATS,
        help=f"Formats passed to the transcription skill (default {DEFAULT_FORMATS})",
    )
    parser.add_argument(
        "--transcribe-arg", action="append", metavar="ARG",
        help="Extra argument forwarded verbatim to transcribe_video.py (repeatable)",
    )
    parser.add_argument("--json", help="Write the operation report as JSON")
    args = parser.parse_args(argv)

    try:
        result = transcribe(args)
    except ToolError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(render_result(result))
    if args.json:
        write_json(result, args.json)
        print(f"\nJSON report: {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
