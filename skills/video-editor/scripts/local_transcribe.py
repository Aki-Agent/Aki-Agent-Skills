#!/usr/bin/env python3
"""Local faster-whisper fallback used when the sibling transcription skill is absent.

Usage:
    python3 scripts/local_transcribe.py INPUT --output-dir video-output \
        --base-name clip --language es --model base

Writes the same word-timed JSON shape consumed by the video-editor scripts, plus
an SRT and a readable Markdown transcript. Models are loaded from the standard
faster-whisper cache; use --local-files-only to avoid downloads on restricted
sandboxes. The model package remains optional unless this fallback is selected.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ffmpeg_lib import (
    ToolError,
    duration_of,
    ensure_output_dir,
    format_time,
    probe,
    require_input,
    stream_of,
)


def _load_model(model_name: str, cache_dir: str | None, offline: bool, threads: int):
    if offline and cache_dir and not Path(model_name).exists():
        root = Path(cache_dir) / f"models--Systran--faster-whisper-{model_name}" / "snapshots"
        cached = any(
            (snapshot / "model.bin").is_file()
            for snapshot in root.glob("*")
            if snapshot.is_dir()
        )
        if not cached:
            raise ToolError(
                f"Whisper model {model_name!r} is not cached under {cache_dir}; "
                "populate the cache or use --download-model explicitly."
            )

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise ToolError(
            "The sibling video_transcription skill was not found and faster-whisper "
            "is not installed in this Python. Install faster-whisper in an isolated "
            "environment or set VIDEO_TRANSCRIPTION_PYTHON to its interpreter."
        ) from exc

    kwargs = {
        "device": "cpu",
        "compute_type": "int8",
        "cpu_threads": max(1, threads),
        "num_workers": 1,
    }
    if cache_dir:
        kwargs["download_root"] = cache_dir
    if offline:
        kwargs["local_files_only"] = True
    try:
        return WhisperModel(model_name, **kwargs)
    except Exception as exc:
        mode = " without network access" if offline else ""
        raise ToolError(
            f"Could not load faster-whisper model {model_name!r}{mode}: "
            f"{type(exc).__name__}: {exc}"
        ) from exc


def _srt_timestamp(seconds: float) -> str:
    total_ms = max(0, round(float(seconds) * 1000))
    hours, remain = divmod(total_ms, 3_600_000)
    minutes, remain = divmod(remain, 60_000)
    whole, milliseconds = divmod(remain, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole:02d},{milliseconds:03d}"


def transcribe(args: argparse.Namespace) -> dict:
    started = time.monotonic()
    source = require_input(args.input)
    output_dir = ensure_output_dir(args.output_dir)
    base = args.base_name or source.stem.replace(" ", "_")
    transcript_path = output_dir / f"{base}.json"
    script_path = output_dir / f"{base}.script.md"
    srt_path = output_dir / f"{base}.srt"
    info = probe(source)
    total = duration_of(info)
    audio = stream_of(info, "audio")
    if not audio:
        raise ToolError(f"No audio stream found in {source}: transcription needs audio.")

    model = _load_model(args.model, args.cache_dir, args.local_files_only, args.threads)
    try:
        segments, detected = model.transcribe(
            str(source),
            language=None if args.language == "auto" else args.language,
            beam_size=args.beam_size,
            word_timestamps=True,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        rows = []
        srt_rows = []
        discarded_words = 0
        for segment_index, segment in enumerate(segments, start=1):
            words = []
            for word in segment.words or []:
                start = round(float(word.start), 3)
                end = round(float(word.end), 3)
                if end <= start:
                    # faster-whisper can emit a degenerate word span on low-confidence
                    # tokens; drop the artifact instead of failing the whole pass.
                    discarded_words += 1
                    continue
                words.append({
                    "word": word.word,
                    "start": start,
                    "end": end,
                    "probability": round(float(word.probability or 0.0), 4),
                })
            row = {
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "text": segment.text.strip(),
                "words": words,
            }
            rows.append(row)
            if row["text"]:
                srt_rows.extend([
                    str(segment_index),
                    f"{_srt_timestamp(row['start'])} --> {_srt_timestamp(row['end'])}",
                    row["text"],
                    "",
                ])
    except Exception as exc:
        raise ToolError(f"faster-whisper inference failed: {type(exc).__name__}: {exc}") from exc

    word_count = sum(len(row["words"]) for row in rows)
    elapsed = time.monotonic() - started
    for row in rows:
        for word in row["words"]:
            if total and (word["start"] >= total or word["end"] > total + 0.25):
                raise ToolError(
                    f"faster-whisper timestamp falls outside the {total:.3f}s source: {word!r}"
                )
    transcript = {
        "source": str(source.resolve()),
        "duration": total,
        "language": detected.language,
        "language_probability": round(float(detected.language_probability or 0), 4),
        "model": args.model,
        "engine": "faster-whisper",
        "segments": rows,
        "elapsed_seconds": round(elapsed, 2),
        "discarded_words": discarded_words,
    }
    transcript_path.write_text(json.dumps(transcript, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    script = [
        f"# Script: {source.name}",
        "",
        f"- language: {detected.language} (p={transcript['language_probability']})",
        f"- duration: {format_time(total)} ({total:.3f}s)",
        f"- model: faster-whisper {args.model}",
        f"- segments: {len(rows)}, words: {word_count}",
        f"- discarded degenerate words: {discarded_words}",
        f"- elapsed: {elapsed:.2f}s",
        "",
        "## Timeline",
        "",
    ]
    for index, row in enumerate(rows):
        script.append(f"[{index:03d}] {format_time(row['start'])} -> {format_time(row['end'])}  {row['text']}")
    script_path.write_text("\n".join(script) + "\n", encoding="utf-8")
    srt_path.write_text("\n".join(srt_rows).rstrip() + "\n", encoding="utf-8")
    return {
        "operation": "transcribe",
        "input": str(source),
        "engine": "faster-whisper",
        "model": args.model,
        "transcript_json": str(transcript_path),
        "script_markdown": str(script_path),
        "srt": str(srt_path),
        "language": detected.language,
        "duration_seconds": total,
        "segment_count": len(rows),
        "word_count": word_count,
        "discarded_words": discarded_words,
        "elapsed_seconds": round(elapsed, 2),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input")
    parser.add_argument("--output-dir", default="video-output")
    parser.add_argument("--base-name")
    parser.add_argument("--language", default="es")
    workspace = Path("/workspace")
    default_cache = (workspace / ".cache" / "whisper") if workspace.is_dir() else (Path.home() / ".cache" / "whisper")
    parser.add_argument("--model", default="base")
    parser.add_argument("--cache-dir", default=os.environ.get("WHISPER_CACHE_DIR", str(default_cache)))
    parser.add_argument("--local-files-only", dest="local_files_only", action="store_true", default=True)
    parser.add_argument("--download-model", dest="local_files_only", action="store_false",
                        help="Allow faster-whisper to download the requested model")
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--json")
    args = parser.parse_args(argv)
    if args.threads <= 0:
        parser.error("--threads must be greater than zero")
    if args.beam_size <= 0:
        parser.error("--beam-size must be greater than zero")
    try:
        report = transcribe(args)
    except ToolError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print("Transcribed with local faster-whisper")
    for key in ("transcript_json", "script_markdown", "srt", "language", "duration_seconds", "segment_count", "word_count", "elapsed_seconds"):
        print(f"  {key}: {report[key]}")
    if report.get("discarded_words"):
        print(f"  discarded degenerate words: {report['discarded_words']}")
    if args.json:
        path = Path(args.json)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  report: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
