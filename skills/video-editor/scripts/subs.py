"""Shared helpers for the subtitle pass: cue building, SRT/ASS writing and
frame-composition measurement.

Standard library only. Frame measurement reuses `analyze.grab_frame`, so the
sampling cost and the seek-based decoding are the same ones already measured for
the recon pass.
"""

from __future__ import annotations

import math
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from analyze import grab_frame  # noqa: E402
from ffmpeg_lib import ToolError  # noqa: E402

# Subtitle reading limits. 42 characters per line is the broadcast convention
# for Latin scripts; two lines is the most that stays readable on a phone.
MAX_CHARS_PER_LINE = 42
MAX_LINES = 2
MIN_CUE_SECONDS = 1.0
MAX_CUE_SECONDS = 7.0
MAX_CPS = 20.0

# Words below this probability are worth a second look while correcting.
LOW_CONFIDENCE = 0.6

GRID_COLS = 6
GRID_ROWS = 6

# A grid cell counts as "person" above this skin share, and a whole row counts
# as occupied above PERSON_ROW. Calibrated on three recordings: a vertical
# talking head, a hybrid screen recording with a webcam inset, and a 4K clip.
PERSON_CELL = 0.15
PERSON_ROW = 0.05
FULL_FRAME_COVERAGE = 0.20

# Mean edge density of the band the text will occupy, above which a plain
# outline is not enough and the style switches to an opaque box. Measured on the
# three test recordings: a screen recording with a webcam inset reads 5.7 (UI
# rows, window chrome), a vertical talking head on a dark set reads 3.5.
DENSE_EDGE = 5.0


# ------------------------------------------------------------------ cues


def flatten_words(segments: list[dict]) -> list[dict]:
    """Every word in reading order with a stable global index."""
    words: list[dict] = []
    for segment_index, segment in enumerate(segments):
        for word in segment.get("words") or []:
            text = (word.get("word") or "").strip()
            if not text:
                continue
            words.append({
                "index": len(words),
                "text": text,
                "start": round(float(word.get("start", segment.get("start", 0))), 3),
                "end": round(float(word.get("end", segment.get("end", 0))), 3),
                "probability": round(float(word.get("probability") or 0.0), 3),
                "segment": segment_index,
            })
    return words


def _balanced_lines(text: str, max_chars: int) -> list[str]:
    """Split a cue into readable lines, balanced when possible.

    A balanced split reads better, but it only exists when a space falls near
    the middle. An 84-character cue whose words do not land at column 41 has no
    balanced two-line split, so the fallback is a greedy fill: first line packed
    up to `max_chars`, remainder on the second. Returning the whole text as one
    long line, which is what a balance-only search does, produces the exact
    defect the limits exist to prevent.
    """
    if len(text) <= max_chars:
        return [text]
    words = text.split()
    best: tuple[int, list[str]] | None = None
    for cut in range(1, len(words)):
        left, right = " ".join(words[:cut]), " ".join(words[cut:])
        if len(left) > max_chars or len(right) > max_chars:
            continue
        score = abs(len(left) - len(right))
        if best is None or score < best[0]:
            best = (score, [left, right])
    if best:
        return best[1]

    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and len(candidate) > max_chars:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def build_cues(
    words: list[dict],
    max_chars: int = MAX_CHARS_PER_LINE,
    max_lines: int = MAX_LINES,
    min_seconds: float = MIN_CUE_SECONDS,
    max_seconds: float = MAX_CUE_SECONDS,
    max_cps: float = MAX_CPS,
) -> list[dict]:
    """Group words into cues that respect the reading limits.

    Greedy by character budget and duration: a cue closes when the next word
    would overflow either limit, so a cue never splits mid-phrase for length
    alone unless a single word is longer than a line.
    """
    limit = max_chars * max_lines
    cues: list[dict] = []
    current: list[dict] = []

    def flush() -> None:
        if not current:
            return
        text = " ".join(word["text"] for word in current)
        cues.append({
            "index": len(cues),
            "start": current[0]["start"],
            "end": max(current[-1]["end"], current[0]["start"] + min_seconds),
            "text": text,
            "from_word": current[0]["index"],
            "to_word": current[-1]["index"],
            "original": text,
            "words": [word["index"] for word in current],
        })
        current.clear()

    for word in words:
        candidate = " ".join([*(w["text"] for w in current), word["text"]])
        span = word["end"] - current[0]["start"] if current else 0.0
        if current and (
            len(_balanced_lines(candidate, max_chars)) > max_lines or span > max_seconds
        ):
            flush()
        current.append(word)
    flush()

    # Never let a cue run into the next one: an overlap makes libass drop a line.
    for left, right in zip(cues, cues[1:]):
        if left["end"] > right["start"]:
            left["end"] = round(right["start"], 3)

    # A cue read faster than `max_cps` can borrow the pause that follows it:
    # holding the text on screen during silence adds no words, it only gives the
    # viewer time to read them. Splitting the cue would not help, because both
    # halves would still be read at the same speed.
    for position, cue in enumerate(cues):
        duration = cue["end"] - cue["start"]
        if duration <= 0 or len(cue["text"]) / duration <= max_cps:
            continue
        limit = cue["start"] + max_seconds
        if position + 1 < len(cues):
            limit = min(limit, cues[position + 1]["start"] - 0.04)
        if limit > cue["end"]:
            cue["end"] = round(limit, 3)

    for cue in cues:
        cue["duration"] = round(cue["end"] - cue["start"], 3)
    return cues


def cue_lines(cue: dict, max_chars: int = MAX_CHARS_PER_LINE) -> list[str]:
    return _balanced_lines(" ".join(cue["text"].split()), max_chars)


# ------------------------------------------------------------- validation


def validate_cues(cues: list[dict], max_chars: int, max_cps: float) -> dict:
    """Reading checks that a delivery file has to pass."""
    problems: list[dict] = []
    for cue in cues:
        duration = max(0.001, cue["end"] - cue["start"])
        lines = cue_lines(cue, max_chars)
        cps = len(cue["text"]) / duration
        if duration < 0.4:
            problems.append({"cue": cue["index"], "kind": "too-short", "detail": f"{duration:.2f}s"})
        if cps > max_cps:
            problems.append({"cue": cue["index"], "kind": "too-fast", "detail": f"{cps:.1f} cps"})
        if len(lines) > MAX_LINES:
            problems.append({"cue": cue["index"], "kind": "too-many-lines", "detail": f"{len(lines)}"})
        for line in lines:
            if len(line) > max_chars:
                problems.append({
                    "cue": cue["index"], "kind": "line-too-long",
                    "detail": f"{len(line)} chars: {line}",
                })
        if not cue["text"].strip():
            problems.append({"cue": cue["index"], "kind": "empty", "detail": "no text"})

    for left, right in zip(cues, cues[1:]):
        if right["start"] < left["start"]:
            problems.append({"cue": right["index"], "kind": "out-of-order", "detail": "start < previous start"})
        if left["end"] > right["start"] + 0.001:
            problems.append({
                "cue": left["index"], "kind": "overlap",
                "detail": f"ends {left['end']:.2f} after next starts {right['start']:.2f}",
            })
    return {"problems": problems, "count": len(problems)}


SENTENCE_END = (".", "?", "!", "\u2026")


def _is_sentence_start(words: list[dict], position: int) -> bool:
    """True at a segment start, or right after terminal punctuation.

    Capitalization alone is useless as a signal: every sentence starts with a
    capital, so flagging all capitals flagged "Porque", "Ahora" and "Este" on a
    clean transcript. A brand name is capitalized *inside* a sentence.
    """
    if position == 0:
        return True
    previous = words[position - 1]
    if previous["segment"] != words[position]["segment"]:
        return True
    return previous["text"].rstrip().endswith(SENTENCE_END)


def flagged_words(words: list[dict]) -> list[dict]:
    """Tokens worth re-listening: low confidence, cut off, numbers, brand names."""
    flags: list[dict] = []
    for position, word in enumerate(words):
        reasons = []
        if word["probability"] and word["probability"] < LOW_CONFIDENCE:
            reasons.append(f"p={word['probability']:.2f}")
        if "..." in word["text"] or "\u2026" in word["text"]:
            reasons.append("cut off")
        if any(ch.isdigit() for ch in word["text"]):
            reasons.append("number")
        stripped = word["text"].strip(".,;:!?\u00bf\u00a1\"'")
        if (
            stripped[:1].isupper()
            and stripped.isalpha()
            and len(stripped) > 2
            and not _is_sentence_start(words, position)
        ):
            reasons.append("capitalized mid-sentence (brand?)")
        if reasons:
            flags.append({
                "index": word["index"], "text": word["text"],
                "start": word["start"], "reasons": reasons,
            })
    return flags


# ------------------------------------------------------------- SRT / ASS


def srt_time(seconds: float) -> str:
    total = max(0.0, float(seconds))
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    whole = int(secs)
    millis = int(round((secs - whole) * 1000))
    if millis == 1000:
        whole += 1
        millis = 0
    return f"{int(hours):02d}:{int(minutes):02d}:{whole:02d},{millis:03d}"


def write_srt(cues: list[dict], path: Path, max_chars: int = MAX_CHARS_PER_LINE) -> None:
    blocks = []
    for number, cue in enumerate(cues, start=1):
        body = "\n".join(cue_lines(cue, max_chars))
        blocks.append(f"{number}\n{srt_time(cue['start'])} --> {srt_time(cue['end'])}\n{body}")
    path.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")


def ass_time(seconds: float) -> str:
    total = max(0.0, float(seconds))
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{int(hours)}:{int(minutes):02d}:{secs:05.2f}"


def write_ass(
    cues: list[dict],
    path: Path,
    width: int,
    height: int,
    style: dict,
    max_chars: int = MAX_CHARS_PER_LINE,
) -> None:
    """Write ASS with PlayRes pinned to the frame size.

    Burning SRT through libass makes the style relative to an unknown script
    resolution, so font size and margins are guesses. Pinning PlayResX/Y to the
    real pixel size makes FontSize and MarginV mean pixels.
    """
    header = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour,"
        " BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,"
        " BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,{font},{size},{primary},{secondary},{outline},{back},"
        "{bold},0,0,0,100,100,0,0,{border_style},{border},{shadow},{alignment},"
        "{margin_l},{margin_r},{margin_v},1".format(**style),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    events = []
    for cue in cues:
        body = "\\N".join(cue_lines(cue, max_chars))
        events.append(
            f"Dialogue: 0,{ass_time(cue['start'])},{ass_time(cue['end'])},Default,,0,0,0,,{body}"
        )
    path.write_text("\n".join([*header, *events]) + "\n", encoding="utf-8")


def ass_style(
    width: int,
    height: int,
    alignment: int = 2,
    margin_v: int = 60,
    font: str = "Arial",
    primary: str = "&H00FFFFFF",
    outline_colour: str = "&H00000000",
    back: str = "&H80000000",
    bold: int = -1,
    border: int = 2,
    shadow: int = 0,
    size_ratio: float = 0.05,
    box: bool = False,
) -> dict:
    """A readable default: white bold text with a black outline.

    The font is sized off the *short* side of the frame, not the height. On a
    vertical clip the height is twice the width, so sizing off the height made
    the text wider than the frame and libass clipped it at both edges.
    """
    short_side = min(width, height)
    size = max(16, round(short_side * size_ratio))
    side_margin = max(8, round(width * 0.04))
    # BorderStyle 1 draws a per-glyph outline; 3 draws an opaque box the width of
    # the line. White text over UI panels is readable only with the box, because
    # the outline follows every glyph and the panel edges run straight through
    # the gaps between letters.
    return {
        "font": font,
        "size": size,
        "primary": primary,
        "secondary": "&H000000FF",
        "outline": outline_colour,
        # In ASS the alpha is inverted: 00 is opaque, FF is transparent. The
        # default &H80 is half transparent, which is not enough over busy UI, so
        # a boxed style uses a nearly opaque fill.
        "back": "&H20000000" if box else back,
        "bold": bold,
        "border": border,
        "shadow": shadow,
        "alignment": alignment,
        "margin_l": side_margin,
        "margin_r": side_margin,
        "margin_v": margin_v,
        "border_style": 3 if box else 1,
        "boxed": bool(box),
    }


# Average glyph advance for a bold sans face, as a share of the font size.
# Measured on rendered output: 42 characters at 58 px overflowed a 720 px frame,
# which puts the real advance near 0.55 rather than the 0.45 a naive estimate
# assumes.
GLYPH_ADVANCE = 0.55


def fit_chars(width: int, font_size: int, margin_ratio: float = 0.04) -> int:
    """Characters that actually fit on one line of this frame at this font size."""
    available = width * (1 - 2 * margin_ratio)
    per_char = max(1.0, font_size * GLYPH_ADVANCE)
    return max(8, int(available / per_char))


# ------------------------------------------------------- frame composition


def _skin_share(buf: bytes, width: int, height: int, x0: int, y0: int, x1: int, y1: int) -> float:
    """Share of skin-toned pixels in one cell (simple RGB rule, tuned on faces)."""
    total = 0
    skin = 0
    for y in range(y0, y1):
        row = y * width
        for x in range(x0, x1):
            base = (row + x) * 3
            r, g, b = buf[base], buf[base + 1], buf[base + 2]
            total += 1
            high = max(r, g, b)
            low = min(r, g, b)
            if r > 95 and g > 40 and b > 20 and high - low > 15 and abs(r - g) > 15 and r > g and r > b:
                skin += 1
    return skin / total if total else 0.0


def _edge_density(buf: bytes, width: int, height: int, x0: int, y0: int, x1: int, y1: int) -> float:
    """Mean absolute Laplacian per cell: high on UI text and hard edges."""
    total = 0
    edge = 0
    for y in range(max(1, y0), min(height - 1, y1)):
        row = y * width
        for x in range(max(1, x0), min(width - 1, x1)):
            base = (row + x) * 3
            left = (row + x - 1) * 3
            right = (row + x + 1) * 3
            up = (row + x - width) * 3
            down = (row + x + width) * 3
            centre = (buf[base] * 299 + buf[base + 1] * 587 + buf[base + 2] * 114) // 1000
            lap = (
                4 * centre
                - (buf[left] * 299 + buf[left + 1] * 587 + buf[left + 2] * 114) // 1000
                - (buf[right] * 299 + buf[right + 1] * 587 + buf[right + 2] * 114) // 1000
                - (buf[up] * 299 + buf[up + 1] * 587 + buf[up + 2] * 114) // 1000
                - (buf[down] * 299 + buf[down + 1] * 587 + buf[down + 2] * 114) // 1000
            )
            edge += abs(lap)
            total += 1
    return edge / total if total else 0.0


MEASURE_LONG_SIDE = 720


def _measure_size(width: int, height: int, target: int = MEASURE_LONG_SIDE) -> tuple[int, int]:
    """Frame size to measure at, keeping the aspect ratio.

    A 3840x2160 frame and a 720x406 frame of the same picture produce the same
    grid shares, so the smaller one is measured.
    """
    if not width or not height or max(width, height) <= target:
        return width, height
    if width >= height:
        return target, max(2, round(target * height / width))
    return max(2, round(target * width / height)), target


def measure_composition(
    video: Path,
    display_width: int,
    display_height: int,
    sample_seconds: list[float],
    bars: dict | None = None,
) -> dict:
    """Measure where the person is and where the dense content is.

    A 6x6 grid per sampled frame, aggregated by median across samples. Two
    signals: skin share (a face) and edge density (UI text, slides, chat panels).

    The frame is measured at a capped resolution. Every metric here is a *share*
    of a cell, so scaling the frame does not change them, but the pixel loops run
    in pure Python: measuring a 3840x2160 frame directly costs about nine times a
    720p one and took over two minutes, which is not a cost worth paying for the
    same answer.
    """
    width, height = _measure_size(display_width, display_height)
    skin_cells: list[list[float]] = []
    edge_cells: list[list[float]] = []
    for at in sample_seconds:
        buf = grab_frame(video, at, width, height)
        skins, edges = [], []
        for row in range(GRID_ROWS):
            for col in range(GRID_COLS):
                x0 = round(col * width / GRID_COLS)
                x1 = round((col + 1) * width / GRID_COLS)
                y0 = round(row * height / GRID_ROWS)
                y1 = round((row + 1) * height / GRID_ROWS)
                skins.append(_skin_share(buf, width, height, x0, y0, x1, y1))
                edges.append(_edge_density(buf, width, height, x0, y0, x1, y1))
        skin_cells.append(skins)
        edge_cells.append(edges)

    def median_grid(samples: list[list[float]]) -> list[float]:
        return [round(statistics.median(column), 4) for column in zip(*samples)]

    skin = median_grid(skin_cells)
    edge = median_grid(edge_cells)

    def grid_slice(rows: range, cols: range) -> list[float]:
        return [skin[r * GRID_COLS + c] for r in rows for c in cols]

    def mean(values: list[float]) -> float:
        return round(sum(values) / len(values), 4) if values else 0.0

    bands = {
        "top": mean(grid_slice(range(0, 2), range(0, GRID_COLS))),
        "middle": mean(grid_slice(range(2, 4), range(0, GRID_COLS))),
        "bottom": mean(grid_slice(range(4, 6), range(0, GRID_COLS))),
        "left": mean(grid_slice(range(0, GRID_ROWS), range(0, 2))),
        "right": mean(grid_slice(range(0, GRID_ROWS), range(4, 6))),
    }
    skin_total = mean(skin)
    edge_total = mean(edge)

    # A face is a cluster, not a sprinkle: require a cell clearly above the rest.
    peak = max(skin) if skin else 0.0
    peak_row, peak_col = divmod(skin.index(peak), GRID_COLS) if skin else (0, 0)

    # Coverage, not a cell count. Counting cells above a threshold put a
    # full-frame talking head (11 cells) and a corner webcam in the same bucket
    # on different days, because the cut-off was arbitrary. The share of the grid
    # that is skin separates them: a face filling the frame covers roughly a
    # third of it, a webcam inset covers under a tenth.
    coverage = sum(1 for value in skin if value > PERSON_CELL) / len(skin) if skin else 0.0

    # Absence is a local test, not a global average. A webcam inset covering 2%
    # of the frame pulled the total skin share to 1.5% on the 4K recording, which
    # a whole-frame threshold reads as "no person" even though the face is right
    # there in one cell. One dense skin cell is enough to prove a person.
    if peak < PERSON_CELL:
        layout = "no-person"
    elif coverage >= FULL_FRAME_COVERAGE:
        layout = "full-frame-person"
    else:
        layout = "person-in-region"

    person_band = None
    if layout != "no-person":
        vertical = {
            "top": bands["top"], "middle": bands["middle"], "bottom": bands["bottom"],
        }
        person_band = max(vertical, key=vertical.get)

    return {
        "layout": layout,
        "coverage": round(coverage, 4),
        "skin_total": skin_total,
        "skin_peak": round(peak, 4),
        "skin_peak_cell": {"row": peak_row, "col": peak_col},
        "edge_total": round(edge_total, 3),
        "bands_skin": bands,
        "person_band": person_band,
        "grid": {"cols": GRID_COLS, "rows": GRID_ROWS, "skin": skin, "edge": edge},
        "bars": bars or {},
        "frame": {"width": display_width, "height": display_height},
        "measured_at": {"width": width, "height": height},
    }


def recommend_placement(composition: dict, bars: dict | None = None) -> dict:
    """Pick where the subtitles go, from the measured composition.

    The decision is spatial, not stylistic: find the lowest row that still holds
    the person, then check whether the free space under it fits a two-line block.
    If it does, the text goes there. If it does not, the text moves above the
    person instead of being stacked on their chest.
    """
    height = composition["frame"]["height"]
    bars = bars or composition.get("bars") or {}
    bottom_bar = float(bars.get("bottom") or 0)

    grid = composition["grid"]
    rows = grid["rows"]
    cols = grid["cols"]
    skin = grid["skin"]

    # Row occupancy: the share of that row's width that is skin.
    row_share = [
        sum(skin[row * cols + col] for col in range(cols)) / cols for row in range(rows)
    ]
    occupied = [row for row, share in enumerate(row_share) if share >= PERSON_ROW]
    lowest = max(occupied) if occupied else -1

    # Free space below the person, as a share of the frame.
    free_below = (rows - 1 - lowest) / rows if lowest >= 0 else 1.0
    if bottom_bar > 0.02:
        free_below = max(0.0, free_below - bottom_bar)

    layout = composition["layout"]
    # A two-line block at the default size needs about 12% of the height,
    # including the margin under it.
    needed = 0.12

    if layout == "no-person":
        anchor = "bottom"
        reason = "no face detected, bottom safe area is free"
    elif free_below >= needed:
        anchor = "bottom"
        reason = (
            f"person ends at row {lowest + 1}/{rows}, "
            f"{free_below:.0%} of the frame is free below"
        )
    else:
        anchor = "above-person"
        reason = (
            f"person reaches row {lowest + 1}/{rows}, only {free_below:.0%} free below, "
            "text moves above them"
        )

    if anchor == "bottom":
        margin_ratio = 0.06 if bottom_bar <= 0.02 else max(0.06, bottom_bar + 0.04)
    else:
        # Sit just above the lowest occupied row, minus a small gap.
        margin_ratio = 1.0 - (lowest / rows) + 0.02

    margin_ratio = min(0.45, max(0.04, margin_ratio))
    margin_v = round(height * margin_ratio)

    # Free space is not the same as clean space. On a screen recording the band
    # under the webcam inset is empty of people but full of UI text, and white
    # subtitles land on top of it. The edge density of the band the text will
    # occupy decides whether the style needs an opaque box behind it.
    edge = grid.get("edge") or []
    if anchor == "bottom":
        band_rows = range(max(0, rows - 2), rows)
    else:
        band_rows = range(max(0, lowest - 1), max(1, lowest + 1))
    band_cells: list[float] = []
    if len(edge) >= rows * cols:
        band_cells = [
            edge[row * cols + col]
            for row in band_rows
            for col in range(cols)
        ]
    band_edge = sum(band_cells) / len(band_cells) if band_cells else 0.0
    needs_box = band_edge >= DENSE_EDGE

    return {
        "alignment": 2,
        "anchor": anchor,
        "margin_v": margin_v,
        "margin_v_ratio": round(margin_ratio, 3),
        "person_last_row": lowest,
        "free_below": round(free_below, 3),
        "reason": reason,
        "layout": layout,
        "person_band": composition.get("person_band"),
        "background_edge": round(band_edge, 2),
        "needs_box": needs_box,
    }
