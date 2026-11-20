#!/usr/bin/env python3
"""Audit a transcript for places where the script stops making sense.

Usage:
    python3 scripts/audit.py TRANSCRIPT.json [--video CUT.mp4] \
                                 [--output-dir DIR] [--listen] [--language es]

Why this exists
---------------
The script pass has one judgement step: read the transcript and mark the places
where the speaker abandons an idea, restarts, or says something twice. Reading
is still what decides, but reading alone misses two cases that matter:

1. Speech the recognizer **swallowed**. In the 1119 recording the audio says
   "saben que hay un altísimo que hay una altísima probabilidad", and the
   transcript renders it as "saben que hay una altísima probabilidad" with the
   word "una" stretched to 1.86 s. The aborted start is invisible in the text
   and obvious in the timings.
2. An idea that is **abandoned mid-clause** and picked up again later. The
   clause ends without terminal punctuation and the next sentence starts a new
   thread.

So this step produces candidates from measurements, not verdicts:

- `collapsed`: a word whose duration is far longer than its neighbours while
  its confidence is low. Speech went missing there.
- `unfinished`: a segment that ends mid-clause (no terminal punctuation).
- `restart`: an unfinished segment followed by a discourse marker that opens a
  new thread ("primero que nada", "es importante", "lo que...").
- `repeat`: an n-gram that reappears later in the recording. Deliberate rhetoric
  and a genuine stumble look identical here, which is why it is a candidate.
- `stutter` / `filler`: repeated words and hesitation sounds.

`--listen` turns a candidate into evidence: it extracts that window, transcribes
it **in isolation** (a short clip is much easier to hear than minute 3 of a long
recording) and reports what was actually said, with the real word boundaries.
That is how the swallowed phrase above was recovered.

The output is `*.audit.md` (read it) and `*.audit.json` (feed it forward).
Deciding the cuts stays with the reader; `script_cut.py` applies them.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ffmpeg_lib import (  # noqa: E402
    ToolError,
    ensure_output_dir,
    format_time,
    require_input,
    run_ffmpeg,
    write_json,
)

# Openers that abandon the previous thread. Kept deliberately narrow: bare
# connectives are not restarts. "entonces tendría sentido..." continues the same
# argument, and "quién llega primero" merely contains the word "primero", so a
# loose list turns continuations into false positives.
RESTART_MARKERS = (
    "primero que nada", "primero de todo", "antes que nada",
    "es importante", "lo importante", "lo que hay que",
    "por otro lado", "en realidad lo", "el tema es", "la cuestión es",
    "a ver si", "digamos que",
)

HESITATIONS = {"eh", "ehh", "ehhh", "em", "emm", "mmm", "mm", "ahh", "uh", "uhh"}

# Enough Spanish function words to keep the n-gram check on content.
STOPWORDS = {
    "a", "al", "algo", "algun", "ante", "antes", "aqui", "asi", "aun", "bien",
    "cada", "como", "con", "contra", "cual", "cuando", "de", "del", "desde",
    "donde", "dos", "el", "ella", "ellas", "ello", "ellos", "en", "entonces",
    "entre", "era", "es", "esa", "ese", "eso", "esta", "este", "esto", "estos",
    "fue", "ha", "haber", "hasta", "hay", "la", "las", "le", "les", "lo",
    "los", "mas", "me", "mi", "mis", "mucho", "muy", "no", "nos", "o", "otra",
    "otro", "para", "pero", "poco", "por", "porque", "que", "quien", "se",
    "sea", "ser", "si", "sin", "sobre", "son", "su", "sus", "tambien", "te",
    "tener", "tiene", "todo", "todos", "tu", "un", "una", "uno", "y", "ya",
    "yo", "va", "van", "ser", "puede", "pueden", "esta", "estan", "tenes",
}

ISOLATED_CODE = r"""
import json, sys
from faster_whisper import WhisperModel
audio, language, model_name, cache = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
kwargs = {"device": "cpu", "compute_type": "int8", "cpu_threads": 2, "num_workers": 1}
if cache:
    kwargs["download_root"] = cache
    kwargs["local_files_only"] = True
model = WhisperModel(model_name, **kwargs)
segments, info = model.transcribe(audio, language=language, word_timestamps=True,
                                  beam_size=3, vad_filter=True, condition_on_previous_text=False)
words = []
for segment in segments:
    for word in segment.words or []:
        words.append({
            "word": word.word.strip(),
            "start": round(word.start, 3),
            "end": round(word.end, 3),
            "probability": round(word.probability or 0.0, 3),
        })
print(json.dumps({"language": info.language, "words": words}))
"""


def normalize(token: str) -> str:
    text = unicodedata.normalize("NFD", token)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return "".join(ch for ch in text.lower() if ch.isalnum())


def flatten(segments: list[dict]) -> list[dict]:
    """Same flat indexing as `script_read.py`, so indices line up."""
    words: list[dict] = []
    for index, segment in enumerate(segments):
        for word in segment.get("words") or []:
            norm = normalize(word.get("word", ""))
            if not norm:
                continue
            words.append({
                "index": len(words),
                "text": str(word.get("word", "")).strip(),
                "norm": norm,
                "start": round(float(word.get("start", segment.get("start", 0))), 3),
                "end": round(float(word.get("end", segment.get("end", 0))), 3),
                "probability": round(float(word.get("probability") or 0.0), 3),
                "segment": index,
            })
    return words


def signal_collapsed(words: list[dict]) -> list[dict]:
    """Words stretched far past their neighbours while sounding uncertain.

    A recognizer that fails to split speech assigns the whole swallowed stretch
    to one token: the token gets long and its confidence drops. That combination
    is the measurable trace of speech that is in the audio but not the text.
    """
    if not words:
        return []
    durations = [word["end"] - word["start"] for word in words]
    median = statistics.median(durations) or 0.3
    floor = max(1.6, 3.0 * median)
    found: list[dict] = []
    for word in words:
        duration = word["end"] - word["start"]
        # Numbers and acronyms ("64GB", "3090") are read slowly on purpose and
        # come back with low confidence; a long one is not swallowed speech.
        if any(char.isdigit() for char in word["text"]):
            continue
        if duration > floor and word["probability"] < 0.75:
            found.append({
                "kind": "collapsed",
                "from_word": word["index"],
                "to_word": word["index"],
                "start": word["start"],
                "end": word["end"],
                "text": word["text"],
                "evidence": (
                    f"word lasts {duration:.2f}s (median {median:.2f}s) at "
                    f"confidence {word['probability']:.2f}: speech likely swallowed"
                ),
            })
    return found


def signal_truncated_token(words: list[dict]) -> list[dict]:
    """A token the recognizer wrote with an ellipsis: an aborted word in the audio.

    Whisper only emits "..." when it heard a word it could not finish decoding,
    which is exactly what a false start sounds like ("se arco... que largó").
    Measured across the test recordings, this trace appears only where the
    speaker actually stumbled, so it is a precise signal rather than a heuristic.
    """
    found: list[dict] = []
    for position, word in enumerate(words):
        if "..." not in word["text"] and "\u2026" not in word["text"]:
            continue
        # Widen to the surrounding words so the cut can drop the whole stumble.
        first = words[max(0, position - 1)]["index"]
        last = words[min(len(words) - 1, position + 1)]["index"]
        found.append({
            "kind": "truncated",
            "from_word": first,
            "to_word": last,
            "start": words[max(0, position - 1)]["start"],
            "end": words[min(len(words) - 1, position + 1)]["end"],
            "text": " ".join(
                item["text"]
                for item in words[max(0, position - 1):min(len(words), position + 2)]
            ),
            "evidence": (
                f"recognizer wrote {word['text']!r} with an ellipsis at "
                f"confidence {word['probability']:.2f}: an unfinished word"
            ),
        })
    return found


def signal_restart(segments: list[dict], words: list[dict]) -> list[dict]:
    """A clause left hanging and then a new thread opened after it.

    A segment ending in a comma is **not** enough on its own: whisper splits on
    pauses, not on sentences, so almost every segment of continuous speech ends
    mid-clause. That check flagged 26 of 28 candidates on a clean recording,
    which is noise, not signal.

    What is worth flagging is the combination: the clause is left unfinished
    *and* the next segment opens with a marker that starts a new thread
    ("primero que nada", "es importante"...). That is the shape of an idea the
    speaker dropped to take up another one.

    The whole segment is reported with its word indices, because where to cut
    inside it is a judgement: the head often carries the answer ("a mí me parece
    que más bien") and only the abandoned tail goes.
    """
    by_segment: dict[int, list[dict]] = {}
    for word in words:
        by_segment.setdefault(word["segment"], []).append(word)

    found: list[dict] = []
    for index, segment in enumerate(segments):
        text = (segment.get("text") or "").strip()
        if not text or text[-1] in ".?!":
            continue
        if index + 1 >= len(segments):
            continue
        following = (segments[index + 1].get("text") or "").strip().lower()
        marker = next((m for m in RESTART_MARKERS if following.startswith(m)), None)
        run = by_segment.get(index) or []
        if not marker or not run:
            continue
        found.append({
            "kind": "restart",
            "from_word": run[0]["index"],
            "to_word": run[-1]["index"],
            "start": run[0]["start"],
            "end": run[-1]["end"],
            "text": text,
            "evidence": (
                f"clause ends without terminal punctuation and the next segment "
                f"opens a new thread with \"{marker}\""
            ),
            "words": [
                {"index": word["index"], "text": word["text"], "start": word["start"]}
                for word in run
            ],
            "next_segment": (segments[index + 1].get("text") or "").strip(),
        })
    return found


def signal_repeat(words: list[dict], size: int = 4, gap: int = 5) -> list[dict]:
    """An n-gram that comes back later, ignoring function words.

    Rhetorical repetition and a stumble are the same measurement; the reader
    separates them by looking at whether the second run advances the argument.
    """
    content = [word for word in words if word["norm"] not in STOPWORDS]
    seen: dict[tuple, int] = {}
    found: list[dict] = []
    reported: set[int] = set()
    last_end = -1.0
    for position in range(len(content) - size + 1):
        key = tuple(item["norm"] for item in content[position:position + size])
        if key in seen and position - seen[key] >= gap:
            first = seen[key]
            head = content[position]
            # Sliding by one word re-detects the same repeat shifted by a token;
            # report each repeat once, at its first occurrence.
            if head["index"] not in reported and head["start"] > last_end:
                reported.add(head["index"])
                last_end = content[position + size - 1]["end"]
                found.append({
                    "kind": "repeat",
                    "from_word": head["index"],
                    "to_word": content[position + size - 1]["index"],
                    "start": head["start"],
                    "end": content[position + size - 1]["end"],
                    "text": " ".join(item["text"] for item in content[position:position + size]),
                    "evidence": (
                        f"same {size} content words as words "
                        f"{content[first]['index']}-{content[first + size - 1]['index']}"
                    ),
                })
        else:
            seen.setdefault(key, position)
    return found


def signal_mechanical(words: list[dict]) -> list[dict]:
    """Hesitations and repeated words: cheap candidates, never auto-applied."""
    found: list[dict] = []
    for word in words:
        if word["norm"] in HESITATIONS:
            found.append({
                "kind": "filler",
                "from_word": word["index"], "to_word": word["index"],
                "start": word["start"], "end": word["end"],
                "text": word["text"], "evidence": "hesitation sound",
            })
    for previous, current in zip(words, words[1:]):
        if previous["norm"] == current["norm"]:
            # "60 .000" is how a recognizer splits "60.000": a number, not a stutter.
            if any(char.isdigit() for char in previous["text"] + current["text"]):
                continue
            found.append({
                "kind": "stutter",
                "from_word": current["index"], "to_word": current["index"],
                "start": current["start"], "end": current["end"],
                "text": f"{previous['text']} {current['text']}",
                "evidence": "same word twice in a row",
            })
    return found


_LOCAL_MODELS: dict[tuple[str, str], object] = {}


def _listen_local(audio: Path, language: str, model_name: str,
                  cache_dir: str | None) -> dict:
    """Transcribe one isolated window while reusing the cached local model."""
    from faster_whisper import WhisperModel

    key = (model_name, cache_dir or "")
    if key not in _LOCAL_MODELS:
        options = {
            "device": "cpu", "compute_type": "int8", "cpu_threads": 2,
            "num_workers": 1,
        }
        if cache_dir:
            options["download_root"] = cache_dir
            options["local_files_only"] = True
        _LOCAL_MODELS[key] = WhisperModel(model_name, **options)
    engine = _LOCAL_MODELS[key]
    segments, _ = engine.transcribe(
        str(audio), language=None if language == "auto" else language,
        beam_size=3, word_timestamps=True, vad_filter=True,
        condition_on_previous_text=False,
    )
    words = []
    for segment in segments:
        for word in segment.words or []:
            words.append({
                "word": word.word,
                "start": round(float(word.start), 3),
                "end": round(float(word.end), 3),
                "probability": round(float(word.probability or 0), 4),
            })
    return {"words": words}


def listen(source: Path, start: float, end: float, python: str,
           language: str, model: str, workdir: Path, cache_dir: str | None = None,
           local_fallback: bool = False) -> dict:
    """Re-transcribe a window in isolation and report what is really there.

    A short clip removes the long-recording context that makes a recognizer skip
    a false start. Timestamps come back relative to the window and are shifted
    to absolute seconds here.
    """
    window = max(0.0, start - 1.5)
    length = (end + 1.5) - window
    audio = workdir / f"_listen-{os.getpid()}-{time.time_ns()}.wav"
    try:
        run_ffmpeg([
            "-ss", f"{window:.3f}", "-t", f"{length:.3f}", "-i", str(source),
            "-vn", "-ac", "1", "-ar", "16000", "-y", str(audio),
        ], timeout=60)
    except ToolError as exc:
        return {"error": str(exc)[-400:]}
    try:
        if local_fallback and python == sys.executable:
            payload = _listen_local(audio, language, model, cache_dir)
        else:
            proc = subprocess.run(
                [python, "-c", ISOLATED_CODE, str(audio), language, model, cache_dir or ""],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=300,
            )
            if proc.returncode != 0:
                return {"error": (proc.stderr or proc.stdout or "").strip()[-400:]}
            payload = json.loads(proc.stdout.strip().splitlines()[-1])
    except subprocess.TimeoutExpired:
        return {"error": "isolated transcription exceeded the 300s safety timeout"}
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}
    finally:
        audio.unlink(missing_ok=True)
    for word in payload["words"]:
        word["start"] = round(word["start"] + window, 3)
        word["end"] = round(word["end"] + window, 3)
    payload["window"] = [round(window, 3), round(window + length, 3)]
    return payload


def collect(transcript: dict, listen_args: dict | None) -> list[dict]:
    segments = transcript.get("segments") or []
    words = flatten(segments)
    candidates: list[dict] = []
    candidates += signal_truncated_token(words)
    candidates += signal_collapsed(words)
    candidates += signal_restart(segments, words)
    candidates += signal_repeat(words)
    candidates += signal_mechanical(words)
    candidates.sort(key=lambda item: (item["start"], item["kind"]))

    if listen_args:
        for candidate in candidates:
            if candidate["kind"] in {"filler", "stutter"}:
                continue
            heard = listen(
                start=candidate["start"], end=candidate["end"], **listen_args
            )
            candidate["heard"] = heard
            if heard.get("words"):
                said = " ".join(word["word"] for word in heard["words"])
                candidate["heard_text"] = said
                candidate["heard_span"] = [
                    heard["words"][0]["start"], heard["words"][-1]["end"]
                ]
    return candidates


def render_markdown(source_name: str, transcript: dict, words: list[dict],
                    candidates: list[dict]) -> str:
    lines = [
        f"# Script audit: {source_name}",
        "",
        f"- duration: {format_time(float(transcript.get('duration') or 0))}",
        f"- words: {len(words)}",
        f"- candidates: {len(candidates)}",
        "",
        "## How to use this",
        "",
        "Each candidate is a measurement, not a verdict. Read the quoted text and",
        "decide: cut it, or keep it because the repetition carries the argument.",
        "`heard` is the same window transcribed in isolation, which recovers",
        "speech the full-file pass swallowed; trust it over the transcript when",
        "the two disagree, and cut by seconds when they do, because the word",
        "index of a swallowed stretch points at the wrong boundaries.",
        "",
        "## Candidates",
        "",
    ]
    if not candidates:
        lines.append("None found. The script reads clean.")
    for candidate in candidates:
        lines += [
            f"### {candidate['kind']} at {format_time(candidate['start'])} "
            f"(words {candidate['from_word']}-{candidate['to_word']})",
            "",
            f"- transcript: \"{candidate['text']}\"",
            f"- span: {candidate['start']}s -> {candidate['end']}s",
            f"- why: {candidate['evidence']}",
        ]
        heard = candidate.get("heard") or {}
        if heard.get("heard_text") or heard.get("words"):
            lines.append(f"- heard in isolation: \"{candidate.get('heard_text', '')}\"")
            if candidate.get("heard_span"):
                lines.append(
                    f"- heard span: {candidate['heard_span'][0]}s -> "
                    f"{candidate['heard_span'][1]}s"
                )
        if heard.get("error"):
            lines.append(f"- listen failed: {heard['error']}")
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    parser = argparse.ArgumentParser(
        description="Find the places where a transcript stops making sense."
    )
    parser.add_argument("transcript", help="Transcript JSON from transcribe.py")
    parser.add_argument("--video", help="The video that was transcribed (needed for --listen)")
    parser.add_argument("--output-dir", default="video-output")
    parser.add_argument("--base-name")
    parser.add_argument("--listen", action="store_true",
                        help="Re-transcribe each candidate window in isolation")
    parser.add_argument("--language", default="es")
    parser.add_argument("--model", help="Whisper model (local audit fallback prefers cached base)")
    parser.add_argument("--no-local-fallback", dest="local_fallback", action="store_false",
                        help="Fail if the sibling transcription skill/interpreter is unavailable")
    parser.set_defaults(local_fallback=True)
    parser.add_argument("--json")
    args = parser.parse_args(argv)

    try:
        transcript_path = require_input(args.transcript)
        try:
            transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ToolError(f"Transcript is not valid JSON: {transcript_path}: {exc}") from exc
        if not transcript.get("segments"):
            raise ToolError("Transcript has no segments: nothing to audit.")

        listen_args = None
        if args.listen:
            local_fallback = False
            if not args.video:
                raise ToolError("--listen needs --video to extract the windows from.")
            source = require_input(args.video)
            from transcribe import _cached_model_path, default_cache_dir, locate_python, locate_skill
            cache = default_cache_dir()
            try:
                skill = locate_skill()
                python = locate_python(skill)
            except ToolError as backend_error:
                if not args.local_fallback:
                    raise ToolError(
                        f"{backend_error}\nUse the local faster-whisper fallback or install the sibling skill."
                    ) from backend_error
                python = sys.executable
                local_fallback = True
            model_name = args.model or ("base" if _cached_model_path(cache, "base") else "small")
            if cache:
                cached = _cached_model_path(cache, model_name)
                if cached:
                    model_name = str(cached)
                elif local_fallback:
                    raise ToolError(
                        f"Whisper model {model_name!r} is not cached under {cache}; "
                        "populate the cache or install the sibling transcription skill."
                    )
            listen_args = {
                "source": source,
                "python": python,
                "language": args.language,
                "model": model_name,
                "workdir": ensure_output_dir(Path(args.output_dir)),
                "cache_dir": str(cache) if local_fallback else None,
                "local_fallback": local_fallback,
            }

        candidates = collect(transcript, listen_args)
        words = flatten(transcript.get("segments") or [])
        output_dir = ensure_output_dir(Path(args.output_dir))
        base = args.base_name or transcript_path.stem
        markdown = output_dir / f"{base}.audit.md"
        markdown.write_text(
            render_markdown(transcript_path.stem, transcript, words, candidates),
            encoding="utf-8",
        )
    except ToolError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    report = {
        "transcript_json": str(transcript_path),
        "video": str(args.video) if args.video else None,
        "audit_markdown": str(markdown),
        "candidate_count": len(candidates),
        "candidates": candidates,
    }
    print(f"Audited {transcript_path.name}")
    print(f"  candidates: {len(candidates)}")
    for candidate in candidates:
        print(
            f"  {candidate['kind']:<10} {format_time(candidate['start'])} "
            f"w{candidate['from_word']}-{candidate['to_word']}  "
            f"\"{candidate['text'][:60]}\""
        )
    print(f"  report: {markdown}")
    if args.json:
        write_json(report, args.json)
        print(f"  JSON:   {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
