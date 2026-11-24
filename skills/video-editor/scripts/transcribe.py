#!/usr/bin/env python3
"""Word-timed local transcription with faster-whisper, in the shape create-project.cjs expects.

Usage:
  python transcribe.py VIDEO_OR_AUDIO OUT_JSON [--language es] [--model small] [--cache-dir DIR]
                       [--clip START,END] [--allow-download]

The input can be any media file; it is converted to mono 16 kHz WAV with FFmpeg first.
`--clip` re-transcribes one doubtful window (use with --model medium) without touching the rest.
Weights are only downloaded with --allow-download; otherwise a missing model fails with the real error.
"""
import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def extract_audio(source: Path, target: Path) -> None:
    run = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(source), "-vn", "-ac", "1",
                          "-ar", "16000", "-c:a", "pcm_s16le", str(target)], capture_output=True, text=True)
    if run.returncode != 0:
        raise RuntimeError(f"ffmpeg audio extraction failed: {run.stderr.strip()}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--language", default=None, help="language code; auto-detected when omitted")
    parser.add_argument("--model", default="small")
    parser.add_argument("--cache-dir", default=None, help="model folder (download_root); default is the Hugging Face cache")
    parser.add_argument("--clip", default=None, help="START,END seconds of a single window to re-transcribe")
    parser.add_argument("--allow-download", action="store_true", help="allow downloading model weights")
    args = parser.parse_args()

    source, output = Path(args.input).resolve(), Path(args.output).resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Input not found: {source}")
    if output.exists():
        raise FileExistsError(f"Output already exists: {output}")
    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise RuntimeError("faster-whisper is not installed in this Python. Create a venv and run: "
                           "python -m pip install faster-whisper==1.2.1") from error

    started = time.time()
    with tempfile.TemporaryDirectory(prefix="transcribe-") as work:
        audio = Path(work) / "audio-16k-mono.wav"
        extract_audio(source, audio)
        print(f"loading model {args.model} (cpu, int8)", file=sys.stderr, flush=True)
        model = WhisperModel(args.model, device="cpu", compute_type="int8", download_root=args.cache_dir,
                             local_files_only=not args.allow_download)
        options = dict(language=args.language, task="transcribe", beam_size=5, temperature=0,
                       condition_on_previous_text=False, vad_filter=True,
                       vad_parameters={"min_silence_duration_ms": 250, "speech_pad_ms": 100}, word_timestamps=True)
        if args.clip:
            options["clip_timestamps"] = args.clip
            options["vad_filter"] = False
        segments, info = model.transcribe(str(audio), **options)

        out_segments, discarded = [], 0
        for index, segment in enumerate(segments):
            words = []
            for w in segment.words or []:
                start, end = round(float(w.start), 3), round(float(w.end), 3)
                # faster-whisper sometimes emits start == end; skip it instead of losing the transcript.
                if end <= start:
                    discarded += 1
                    continue
                words.append({"word": w.word, "start": start, "end": end, "probability": round(float(w.probability), 4)})
            out_segments.append({"id": index, "start": round(float(segment.start), 3), "end": round(float(segment.end), 3),
                                 "text": segment.text.strip(), "avg_logprob": round(float(segment.avg_logprob), 4),
                                 "no_speech_prob": round(float(segment.no_speech_prob), 4), "words": words})

    words_total = sum(len(s["words"]) for s in out_segments)
    # Segment scores repeat per 30 s window, so doubtful passages are flagged per word (p < 0.5).
    low = [{"word": w["word"].strip(), "start": w["start"], "end": w["end"], "probability": w["probability"]}
           for s in out_segments for w in s["words"] if w["probability"] < 0.5]
    payload = {"source": source.name, "language": info.language, "language_probability": round(float(info.language_probability), 4),
               "duration": round(float(info.duration), 3), "model": args.model, "clip": args.clip,
               "discarded_words": discarded, "low_confidence_words": low,
               "runtime_seconds": round(time.time() - started, 1), "segments": out_segments}
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "x", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    print(f"{source.name}: {len(out_segments)} segments, {words_total} words, {discarded} discarded, language {info.language}, "
          f"{len(low)} words below p 0.5, {payload['runtime_seconds']} s", file=sys.stderr)
    print(json.dumps({"output": str(output), "segments": len(out_segments), "words": words_total, "discarded_words": discarded,
                      "language": info.language, "low_confidence_words": low, "runtime_seconds": payload["runtime_seconds"]}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # surface the underlying error verbatim
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
