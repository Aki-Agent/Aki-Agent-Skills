"""Generate optional generic PNG diagrams for the DOCX builder example."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any


def load_pillow() -> tuple[Any, Any, Any, str]:
    """Import Pillow, installing it only when the sandbox does not have it."""
    try:
        from PIL import Image, ImageDraw, ImageFont

        return Image, ImageDraw, ImageFont, "available"
    except ImportError:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--user", "Pillow>=10,<13"],
            check=True,
        )
        from PIL import Image, ImageDraw, ImageFont

        return Image, ImageDraw, ImageFont, "installed"


def choose_font(
    image_font: Any,
    size: int,
    bold: bool,
    explicit_path: str | None,
    explicit_bold_path: str | None,
) -> Any:
    if bold and explicit_bold_path:
        candidates = [explicit_bold_path]
    elif not bold and explicit_path:
        candidates = [explicit_path]
    elif bold:
        candidates = [
            "Arial Bold.ttf",
            "arialbd.ttf",
            "DejaVuSans-Bold.ttf",
            "LiberationSans-Bold.ttf",
        ]
    else:
        candidates = [
            "Arial.ttf",
            "arial.ttf",
            "DejaVuSans.ttf",
            "LiberationSans-Regular.ttf",
        ]

    for candidate in candidates:
        try:
            return image_font.truetype(candidate, size)
        except OSError:
            continue

    try:
        return image_font.load_default(size=size)
    except TypeError:
        return image_font.load_default()


def centered_text(
    draw: Any,
    text: str,
    center_x: float,
    top_y: float,
    font: Any,
    fill: str,
    spacing: int = 5,
) -> None:
    bounds = draw.multiline_textbbox(
        (0, 0), text, font=font, align="center", spacing=spacing
    )
    width = bounds[2] - bounds[0]
    draw.multiline_text(
        (center_x - width / 2, top_y),
        text,
        font=font,
        fill=fill,
        align="center",
        spacing=spacing,
    )


def draw_box(
    draw: Any,
    xy: tuple[int, int, int, int],
    title: str,
    subtitle: str,
    fill: str,
    regular_font: Any,
    bold_font: Any,
) -> None:
    draw.rounded_rectangle(xy, radius=18, fill=fill, outline="#C5D0DA", width=2)
    x1, y1, x2, _ = xy
    center_x = (x1 + x2) / 2
    centered_text(draw, title, center_x, y1 + 18, bold_font, "#12293D")
    centered_text(draw, subtitle, center_x, y1 + 60, regular_font, "#334D61")


def draw_arrow_head(draw: Any, start: tuple[int, int], end: tuple[int, int], color: str) -> None:
    start_x, start_y = start
    end_x, end_y = end
    angle = math.atan2(end_y - start_y, end_x - start_x)
    length = 14
    half_width = 8
    base_x = end_x - length * math.cos(angle)
    base_y = end_y - length * math.sin(angle)
    normal_x = -math.sin(angle)
    normal_y = math.cos(angle)
    left = (base_x + half_width * normal_x, base_y + half_width * normal_y)
    right = (base_x - half_width * normal_x, base_y - half_width * normal_y)
    draw.polygon([end, left, right], fill=color)


def draw_polyline_arrow(
    draw: Any, points: list[tuple[int, int]], color: str = "#44718D"
) -> None:
    draw.line(points, fill=color, width=5, joint="curve")
    draw_arrow_head(draw, points[-2], points[-1], color)


def make_fonts(
    image_font: Any, regular_path: str | None, bold_path: str | None
) -> tuple[Any, Any, Any, Any]:
    return (
        choose_font(image_font, 29, False, regular_path, bold_path),
        choose_font(image_font, 29, True, regular_path, bold_path),
        choose_font(image_font, 27, False, regular_path, bold_path),
        choose_font(image_font, 22, True, regular_path, bold_path),
    )


def create_flow_diagram(
    image: Any,
    image_draw: Any,
    fonts: tuple[Any, Any, Any, Any],
    output: Path,
) -> None:
    regular_font, bold_font, body_font, label_font = fonts
    canvas = image.new("RGB", (1600, 660), "white")
    draw = image_draw.Draw(canvas)

    draw_box(draw, (35, 255, 260, 405), "User", "Request", "#EDF3F7", regular_font, bold_font)
    draw_box(
        draw,
        (320, 255, 605, 405),
        "Entry point",
        "Shared routing",
        "#E1EDF3",
        regular_font,
        bold_font,
    )
    draw_box(
        draw,
        (765, 65, 1090, 210),
        "New service",
        "Target path",
        "#E2F1EC",
        regular_font,
        bold_font,
    )
    draw_box(
        draw,
        (765, 450, 1090, 595),
        "Existing service",
        "Current path",
        "#F2EDE5",
        regular_font,
        bold_font,
    )
    draw_box(
        draw,
        (1270, 255, 1560, 405),
        "Data store",
        "Read and write",
        "#EDF3F7",
        regular_font,
        bold_font,
    )

    draw_polyline_arrow(draw, [(260, 330), (320, 330)])
    draw_polyline_arrow(draw, [(605, 330), (680, 330), (680, 137), (765, 137)])
    draw_polyline_arrow(draw, [(605, 330), (680, 330), (680, 522), (765, 522)])
    draw_polyline_arrow(draw, [(1090, 137), (1180, 137), (1180, 330), (1270, 330)])
    draw.line([(1090, 522), (1180, 522), (1180, 330)], fill="#44718D", width=5)

    centered_text(draw, "Shared routing", 930, 235, label_font, "#33576A")
    centered_text(draw, "target and current paths", 930, 273, regular_font, "#526A78")
    canvas.save(output)


def create_phase_diagram(
    image: Any,
    image_draw: Any,
    fonts: tuple[Any, Any, Any, Any],
    output: Path,
) -> None:
    regular_font, bold_font, body_font, _ = fonts
    canvas = image.new("RGB", (1600, 410), "white")
    draw = image_draw.Draw(canvas)

    draw_box(
        draw,
        (20, 50, 500, 335),
        "Phase 1",
        "Core screens\nShared access\nBasic validation",
        "#E2F1EC",
        regular_font,
        bold_font,
    )
    draw_box(
        draw,
        (560, 50, 1040, 335),
        "Phase 2",
        "Transactions\nNotifications\nExternal boundaries",
        "#E1EDF3",
        regular_font,
        bold_font,
    )
    draw_box(
        draw,
        (1100, 50, 1580, 335),
        "Phase 3",
        "Background work\nInternal services\nOpen decisions",
        "#F2EDE5",
        regular_font,
        bold_font,
    )
    draw_polyline_arrow(draw, [(500, 195), (560, 195)])
    draw_polyline_arrow(draw, [(1040, 195), (1100, 195)])
    canvas.save(output)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        default="docx-output",
        help="Directory for the generated PNG files.",
    )
    parser.add_argument("--font", help="Optional path to a regular TrueType font.")
    parser.add_argument("--bold-font", help="Optional path to a bold TrueType font.")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    image, image_draw, image_font, pillow_status = load_pillow()
    fonts = make_fonts(image_font, args.font, args.bold_font)
    example_flow = output_dir / "example-flow.png"
    example_phases = output_dir / "example-phases.png"

    create_flow_diagram(image, image_draw, fonts, example_flow)
    create_phase_diagram(image, image_draw, fonts, example_phases)

    report = {
        "status": "ok",
        "pillow": pillow_status,
        "files": [str(example_flow), str(example_phases)],
        "dimensions": {
            "example-flow.png": [1600, 660],
            "example-phases.png": [1600, 410],
        },
    }
    print(f"Generated 2 example PNG diagrams in {output_dir}")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
