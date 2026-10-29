#!/usr/bin/env python3
"""
yt_transcribe.py - Downloads YouTube audio and transcribes it with timestamps.

Usage:
  python3 yt_transcribe.py <URL_OR_ID> [-o OUTPUT] [--model base|small|medium]
                            [--lang es] [--srt] [--subs] [--range 0-600]

Outputs: <output>.txt (plain text), <output>.srt (subtitles), <output>.json (segments)
"""
import argparse, json, os, re, shutil, subprocess, sys, time

WORKSPACE = "/workspace"
MODEL_CACHE = os.path.join(WORKSPACE, ".cache", "whisper")
os.environ.setdefault("HF_HOME", os.path.join(WORKSPACE, ".cache", "hf"))
os.environ.setdefault("XDG_CACHE_HOME", os.path.join(WORKSPACE, ".cache"))

DEPS = ["yt-dlp", "faster-whisper", "av==12.3.0"]


def log(msg):
    print(f"[yt] {msg}", flush=True)


def bootstrap():
    """Installs missing dependencies (the sandbox can be recreated and lose pip installs)."""
    need = False
    try:
        import faster_whisper  # noqa
        import av  # noqa
        if av.__version__.split(".")[0] > "12":
            need = True
    except Exception:
        need = True
    if shutil.which("yt-dlp") is None and not os.path.exists(os.path.expanduser("~/.local/bin/yt-dlp")):
        need = True
    if need:
        log("installing dependencies (may take ~30s the first time)...")
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet", "--break-system-packages", *DEPS],
            check=False,
        )
    os.makedirs(MODEL_CACHE, exist_ok=True)


def yt_dlp_bin():
    p = shutil.which("yt-dlp")
    if p:
        return [p]
    local = os.path.expanduser("~/.local/bin/yt-dlp")
    if os.path.exists(local):
        return [local]
    return [sys.executable, "-m", "yt_dlp"]


def clean_url(target):
    m = re.search(r"(?:v=|/shorts/|youtu\.be/|/live/|/embed/)([A-Za-z0-9_-]{11})", target)
    if m:
        return f"https://www.youtube.com/watch?v={m.group(1)}"
    return target


def get_metadata(url):
    cmd = yt_dlp_bin() + ["--no-warnings", "--skip-download", "--dump-single-json", url]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        return {}
    try:
        d = json.loads(r.stdout)
        return {
            "id": d.get("id"), "title": d.get("title"), "channel": d.get("uploader"),
            "duration": d.get("duration"), "upload_date": d.get("upload_date"),
            "view_count": d.get("view_count"), "url": d.get("webpage_url"),
            "chapters": [{"start": c.get("start_time"), "title": c.get("title")}
                         for c in (d.get("chapters") or [])
                         if c.get("title") and not c["title"].startswith("<Untitled")],
        }
    except Exception:
        return {}


def try_subs(url, outdir, langs):
    """Shortcut: subtitles (manual or automatic) when YouTube serves them without rate-limiting."""
    cmd = yt_dlp_bin() + [
        "--no-warnings", "--skip-download", "--write-subs", "--write-auto-subs",
        "--sub-langs", langs, "--sub-format", "srt/vtt/best",
        "--retries", "2", "--sleep-subtitles", "1",
        "-o", os.path.join(outdir, "yt_%(id)s"), url,
    ]
    subprocess.run(cmd, capture_output=True, text=True)
    files = [f for f in os.listdir(outdir) if re.match(r"yt_.*\.(srt|vtt)$", f)]
    return os.path.join(outdir, files[0]) if files else None


def parse_subs(path):
    """Converts srt/vtt into segments (start, end, text)."""
    txt = open(path, encoding="utf-8", errors="ignore").read()
    blocks = re.split(r"\n\s*\n", txt.replace("\r", ""))
    ts = re.compile(r"(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})")
    segs = []
    for b in blocks:
        lines = [l for l in b.split("\n") if l.strip() and not l.strip().isdigit() and not l.startswith(("WEBVTT", "Kind:", "Language:"))]
        m = None
        for i, l in enumerate(lines):
            m = ts.search(l)
            if m:
                lines = lines[i + 1:]
                break
        if not m or not lines:
            continue
        g = [int(x) for x in m.groups()]
        start = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        end = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        text = re.sub(r"<[^>]+>", "", " ".join(lines)).strip()
        if text and (not segs or text != segs[-1]["text"]):
            segs.append({"start": start, "end": end, "text": text})
    return segs


def download_audio(url, outdir, time_range=None):
    # unique name per run so audio from a previous download is never reused
    tag = re.search(r"v=([A-Za-z0-9_-]{11})", url)
    tag = tag.group(1) if tag else "audio"
    for f in os.listdir(outdir):
        if f.startswith("audio") and f.endswith(".mp3"):
            os.remove(os.path.join(outdir, f))
    tmpl = os.path.join(outdir, f"audio_{tag}.%(ext)s")
    cmd = yt_dlp_bin() + [
        "-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "5",
        "--no-warnings", "--retries", "3", "--sleep-requests", "1", "--force-overwrites",
        "-o", tmpl,
    ]
    if time_range:
        cmd += ["--download-sections", f"*{time_range}"]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        log("yt-dlp stderr: " + r.stderr.strip()[-500:])
    exp = os.path.join(outdir, f"audio_{tag}.mp3")
    return exp if os.path.exists(exp) else None


def transcribe(audio, model_size, lang=None):
    from faster_whisper import WhisperModel
    t0 = time.time()
    log(f"loading model '{model_size}' (cache: {MODEL_CACHE})...")
    model = WhisperModel(model_size, device="cpu", compute_type="int8", download_root=MODEL_CACHE)
    segs, info = model.transcribe(
        audio, language=lang, vad_filter=True, beam_size=5,
        condition_on_previous_text=False,
    )
    out = []
    for s in segs:
        out.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()})
        print(f"  [{fmt(s.start)}] {s.text.strip()}", flush=True)
    log(f"transcribed in {time.time()-t0:.0f}s (audio {info.duration:.0f}s)")
    return out, {"language": info.language, "language_probability": round(info.language_probability, 2), "duration": info.duration}


def fmt(t):
    h, r = divmod(int(t), 3600)
    m, s = divmod(r, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def to_srt(segs):
    def ts(t):
        h = int(t // 3600); m = int(t % 3600 // 60); s = int(t % 60); ms = int((t % 1) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    return "\n".join(f"{i}\n{ts(s['start'])} --> {ts(s['end'])}\n{s['text']}\n" for i, s in enumerate(segs, 1))


def wrap_paragraphs(segs, max_chars=700, gap=2.0):
    """Groups segments into readable paragraphs with a timestamp at the start."""
    out, buf, start, last_end = [], [], None, None
    for s in segs:
        if start is None:
            start = s["start"]
        gap_hit = last_end is not None and s["start"] - last_end > gap
        if buf and (sum(len(x) + 1 for x in buf) > max_chars or gap_hit):
            out.append(f"[{fmt(start)}] " + " ".join(buf))
            buf, start = [], s["start"]
        buf.append(s["text"])
        last_end = s["end"]
    if buf:
        out.append(f"[{fmt(start)}] " + " ".join(buf))
    return "\n\n".join(out)


def to_md(meta, segs, text, source):
    lines = [f"# {meta.get('title') or 'Transcript'}", ""]
    if meta.get("channel"):
        lines += [f"**Channel:** {meta['channel']}  "]
    if meta.get("duration"):
        lines += [f"**Duration:** {fmt(meta['duration'])}  "]
    if meta.get("upload_date"):
        d = meta["upload_date"]
        lines += [f"**Published:** {d[:4]}-{d[4:6]}-{d[6:8]}  "]
    if meta.get("url"):
        lines += [f"**Source:** {meta['url']}  "]
    lines += [f"**Method:** {source}  ", "", "---", ""]
    if meta.get("chapters"):
        lines += ["## Chapters", ""]
        for c in meta["chapters"]:
            lines.append(f"- `{fmt(c['start'] or 0)}` {c['title']}")
        lines += ["", "---", ""]
    lines += ["## Transcript", "", text, ""]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target")
    ap.add_argument("-o", "--output", default=None)
    ap.add_argument("--model", default="base", choices=["tiny", "base", "small", "medium"])
    ap.add_argument("--lang", default=None, help="ISO code (es, en...). None = auto-detect")
    ap.add_argument("--srt", action="store_true", help="also generate .srt")
    ap.add_argument("--subs", action="store_true", help="try YouTube subtitles before Whisper")
    ap.add_argument("--range", default=None, help="download range, e.g. 0-600 (seconds)")
    ap.add_argument("--outdir", default=None)
    a = ap.parse_args()

    bootstrap()
    url = clean_url(a.target)
    outdir = a.outdir or os.path.join(WORKSPACE, "yt-transcripts")
    os.makedirs(outdir, exist_ok=True)

    log(f"fetching metadata for {url}")
    meta = get_metadata(url)
    if meta.get("title"):
        log(f"title: {meta['title']} ({fmt(meta.get('duration') or 0)})")
    base = a.output or re.sub(r"[^\w\-. ]", "_", (meta.get("title") or meta.get("id") or "video"))[:80]
    base = os.path.join(outdir, base.strip())

    segs, info, source = None, {}, None
    if a.subs:
        log("trying YouTube subtitles...")
        sp = try_subs(url, outdir, (a.lang or "es") + ".*,en.*")
        if sp:
            segs = parse_subs(sp)
            if segs:
                source = "YouTube subtitles"
                log(f"using {len(segs)} subtitle segments")

    if not segs:
        log("downloading audio...")
        audio = download_audio(url, outdir, a.range)
        if not audio:
            log("ERROR: could not download audio")
            sys.exit(1)
        segs, info = transcribe(audio, a.model, a.lang)
        source = f"Whisper {a.model}"

    if not segs:
        log("ERROR: empty transcript")
        sys.exit(1)

    text = wrap_paragraphs(segs)
    open(base + ".txt", "w", encoding="utf-8").write(text + "\n")
    json.dump({"metadata": meta, "info": info, "source": source, "segments": segs},
              open(base + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    open(base + ".md", "w", encoding="utf-8").write(to_md(meta, segs, text, source))
    if a.srt:
        open(base + ".srt", "w", encoding="utf-8").write(to_srt(segs))

    log(f"DONE -> {base}.txt  ({len(segs)} segments, source: {source})")
    print(f"CHARS={len(text)}")


if __name__ == "__main__":
    main()
