"""Shared helpers for the video-editor skill.

Locates the FFmpeg binaries, runs them, and surfaces their real errors.
No third-party Python packages: standard library only.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

INSTALL_HINT = (
    "Install FFmpeg and reopen the shell: Windows `winget install Gyan.FFmpeg`, "
    "macOS `brew install ffmpeg`, Debian/Ubuntu `sudo apt install ffmpeg`."
)


class ToolError(RuntimeError):
    """A real tool failure, reported with the underlying output."""


def tail(text: str, lines: int = 25) -> str:
    """Last lines of a tool's stderr, which is where FFmpeg explains failures."""
    if not text:
        return "(no output)"
    parts = [line for line in text.strip().splitlines() if line.strip()]
    return "\n".join(parts[-lines:])


def tool_path(name: str) -> str:
    """Resolve an executable, honoring an explicit override env var."""
    override = os.environ.get(f"{name.upper()}_PATH")
    if override and Path(override).is_file():
        return override
    found = shutil.which(name)
    if not found:
        raise ToolError(f"`{name}` not found on PATH. {INSTALL_HINT}")
    return found


def run(cmd: list[str], timeout: float | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def run_ffmpeg(args: list[str], timeout: float | None = None) -> subprocess.CompletedProcess:
    """Run FFmpeg and atomically publish a completed file output.

    FFmpeg writes to a same-directory temporary whose suffix still identifies
    the container (for example `edit.part-1234-deadbeef.mp4`). A failed or timed-out
    render never publishes a partial at the requested delivery path. A process
    interrupted by the outer host may leave its uniquely named temporary behind.
    """
    final: Path | None = None
    temporary: Path | None = None
    command_args = list(args)
    if command_args:
        raw_output = str(command_args[-1])
        candidate = Path(raw_output)
        if raw_output not in {"-", "pipe:1"} and candidate.suffix:
            final = candidate
            final.parent.mkdir(parents=True, exist_ok=True)
            temporary = candidate.with_name(
                f"{candidate.stem}.part-{os.getpid()}-{uuid.uuid4().hex[:8]}{candidate.suffix}"
            )
            # A same-directory temporary also makes os.replace atomic on one filesystem.
            # The unique suffix prevents a rerun from deleting a killed concurrent render.
            command_args[-1] = str(temporary)

    cmd = [tool_path("ffmpeg"), "-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y", *command_args]
    try:
        proc = run(cmd, timeout=timeout)
        if proc.returncode != 0:
            raise ToolError(
                f"ffmpeg exited with code {proc.returncode}\n"
                f"command: {' '.join(cmd)}\n"
                f"stderr (last lines):\n{tail(proc.stderr)}"
            )
        if temporary is not None and final is not None:
            if not temporary.is_file() or temporary.stat().st_size == 0:
                raise ToolError(
                    f"ffmpeg exited successfully but produced no file at {temporary}"
                )
            os.replace(temporary, final)
        return proc
    except subprocess.TimeoutExpired as exc:
        detail = exc.stderr.decode("utf-8", errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        raise ToolError(
            f"ffmpeg timed out after {timeout}s\n"
            f"stderr (last lines):\n{tail(detail)}"
        ) from exc
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def probe(path: str | Path) -> dict:
    """Return ffprobe's JSON for a media file, or raise ToolError."""
    target = Path(path)
    if not target.exists():
        raise ToolError(f"Input file does not exist: {target}")
    cmd = [
        tool_path("ffprobe"),
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(target),
    ]
    proc = run(cmd)
    if proc.returncode != 0 or not proc.stdout.strip():
        raise ToolError(
            f"ffprobe exited with code {proc.returncode} for {target}\n"
            f"stderr (last lines):\n{tail(proc.stderr)}"
        )
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise ToolError(f"ffprobe returned unparsable JSON for {target}: {exc}") from exc
    data["path"] = str(target)
    return data


def stream_of(data: dict, codec_type: str) -> dict | None:
    for stream in data.get("streams", []):
        if stream.get("codec_type") == codec_type:
            return stream
    return None


def duration_of(data: dict) -> float:
    """Duration in seconds, from the container or the longest stream."""
    try:
        return float(data.get("format", {}).get("duration"))
    except (TypeError, ValueError):
        pass
    longest = 0.0
    for stream in data.get("streams", []):
        try:
            longest = max(longest, float(stream.get("duration")))
        except (TypeError, ValueError):
            continue
    return longest


def frame_rate_of(stream: dict) -> float:
    raw = stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "0/0"
    try:
        num, den = raw.split("/")
        return float(num) / float(den) if float(den) else 0.0
    except (ValueError, AttributeError):
        return 0.0


def parse_time(value: str | float | int | None) -> float | None:
    """Accept seconds (`12.5`), `MM:SS` or `HH:MM:SS.mmm`."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    negative = text.startswith("-")
    if negative:
        text = text[1:]
    parts = text.split(":")
    if len(parts) > 3:
        raise ToolError(f"Invalid time value: {value!r} (use seconds, MM:SS or HH:MM:SS)")
    try:
        seconds = 0.0
        for part in parts:
            seconds = seconds * 60 + float(part)
    except ValueError as exc:
        raise ToolError(f"Invalid time value: {value!r} (use seconds, MM:SS or HH:MM:SS)") from exc
    return -seconds if negative else seconds


def format_time(seconds: float) -> str:
    if seconds is None:
        return "unknown"
    total = max(0.0, float(seconds))
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    if hours >= 1:
        return f"{int(hours):02d}:{int(minutes):02d}:{secs:06.3f}"
    return f"{int(minutes):02d}:{secs:06.3f}"


def format_bytes(size: float | int | None) -> str:
    if size is None:
        return "unknown"
    value = float(size)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if value < 1024 or unit == "TiB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{value:.1f} TiB"


def output_report(path: str | Path, started: float, extra: dict | None = None) -> dict:
    """Structured result for one operation: real file facts plus measured runtime."""
    target = Path(path)
    report = {
        "output": str(target),
        "exists": target.is_file(),
        "size_bytes": target.stat().st_size if target.is_file() else 0,
        "elapsed_seconds": round(time.time() - started, 2),
    }
    if report["exists"]:
        try:
            data = probe(target)
            report["duration_seconds"] = round(duration_of(data), 3)
            video = stream_of(data, "video")
            if video:
                report["width"] = video.get("width")
                report["height"] = video.get("height")
                report["video_codec"] = video.get("codec_name")
            audio = stream_of(data, "audio")
            report["audio_codec"] = audio.get("codec_name") if audio else None
        except ToolError as exc:
            report["probe_error"] = str(exc)
    if extra:
        report.update(extra)
    return report


def write_json(report: dict, destination: str | Path) -> None:
    target = Path(destination)
    if target.parent and not target.parent.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


def require_input(path: str | Path) -> Path:
    target = Path(path)
    if not target.exists():
        raise ToolError(f"Input file does not exist: {target}")
    if not target.is_file():
        raise ToolError(f"Input path is not a file: {target}")
    return target


def ensure_output_dir(path: str | Path) -> Path:
    target = Path(path)
    target.mkdir(parents=True, exist_ok=True)
    return target
