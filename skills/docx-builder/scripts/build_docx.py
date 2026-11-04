"""Build a minimal Open XML DOCX from a Markdown draft and optional PNG files."""

from __future__ import annotations

import argparse
import json
import re
import struct
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
from xml.sax.saxutils import escape

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
EMU_PER_PIXEL_AT_96_DPI = 9525
MAX_IMAGE_WIDTH_EMU = 6032500
FIGURE_MARKER = re.compile(r"^Figure\s+(\d+)\.")


def paragraph(text: str, style: str | None = None) -> str:
    properties = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return (
        "<w:p>"
        + properties
        + '<w:r><w:t xml:space="preserve">'
        + escape(text)
        + "</w:t></w:r></w:p>"
    )


def image_paragraph(rel_id: str, width_emu: int, height_emu: int, number: int) -> str:
    return f"""<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{width_emu}" cy="{height_emu}"/><wp:docPr id="{number}" name="Figure {number}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="{number}" name="Figure {number}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{width_emu}" cy="{height_emu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"""


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:8] != PNG_SIGNATURE or len(data) < 24 or data[12:16] != b"IHDR":
        raise ValueError(f"Not a valid PNG file: {path}")
    width, height = struct.unpack(">II", data[16:24])
    if width == 0 or height == 0:
        raise ValueError(f"PNG has an invalid size: {path}")
    return width, height


def image_size_emu(path: Path) -> tuple[int, int]:
    width, height = png_size(path)
    natural_width = width * EMU_PER_PIXEL_AT_96_DPI
    scale = min(1.0, MAX_IMAGE_WIDTH_EMU / natural_width)
    return round(natural_width * scale), round(height * EMU_PER_PIXEL_AT_96_DPI * scale)


def required_image(path_value: str, marker: str) -> Path:
    path = Path(path_value)
    if not path.is_file():
        raise FileNotFoundError(f"Image for {marker} does not exist: {path}")
    png_size(path)
    return path


def build_body(
    markdown: Path,
    image_values: list[str],
) -> tuple[list[str], list[tuple[str, Path, str]], dict[str, int]]:
    images: list[tuple[str, Path, str]] = []
    body: list[str] = []
    counts = {"paragraphs": 0, "figures": 0}
    figure_index = 0

    for raw_line in markdown.read_text(encoding="utf-8").splitlines():
        line = raw_line.rstrip()
        if not line.strip() or line.startswith("    "):
            continue

        figure_match = FIGURE_MARKER.match(line)
        if figure_match:
            if figure_index >= len(image_values):
                raise ValueError(
                    f"{line} has no matching --image argument; provide one --image for each figure marker"
                )
            source = required_image(image_values[figure_index], line)
            relation_id = f"rId{figure_index + 2}"
            archive_name = f"image-{figure_index + 1}.png"
            images.append((relation_id, source, archive_name))
            width, height = image_size_emu(source)
            body.append(paragraph(line, "Caption"))
            body.append(image_paragraph(relation_id, width, height, figure_index + 1))
            counts["paragraphs"] += 1
            counts["figures"] += 1
            figure_index += 1
        elif line.startswith("# "):
            body.append(paragraph(line[2:], "Title"))
            counts["paragraphs"] += 1
        elif line.startswith("### "):
            body.append(paragraph(line[4:], "Heading2"))
            counts["paragraphs"] += 1
        elif line.startswith("## "):
            body.append(paragraph(line[3:], "Heading1"))
            counts["paragraphs"] += 1
        elif line.startswith("- "):
            body.append(paragraph("•  " + line[2:], "Bullet"))
            counts["paragraphs"] += 1
        else:
            body.append(paragraph(line))
            counts["paragraphs"] += 1

    if figure_index != len(image_values):
        raise ValueError(
            f"Received {len(image_values)} --image argument(s), but the draft contains {figure_index} figure marker(s)"
        )

    return body, images, counts


def document_xml(body: list[str]) -> str:
    namespaces = (
        'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
    )
    section = (
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
        '<w:pgMar w:top="1100" w:right="1200" w:bottom="1100" '
        'w:left="1200" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f"<w:document {namespaces}><w:body>"
        + "".join(body)
        + section
        + "</w:body></w:document>"
    )


def styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="202A31"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="260"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="46"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="130"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="31"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="170" w:after="85"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="25"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Bullet"><w:name w:val="Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="260" w:hanging="220"/><w:spacing w:after="80"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="100" w:after="70"/></w:pPr><w:rPr><w:b/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>"""


def content_types_xml(images: list[tuple[str, Path, str]]) -> str:
    image_default = (
        '<Default Extension="png" ContentType="image/png"/>' if images else ""
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        + image_default
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        + "</Types>"
    )


def root_relationships_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"""


def document_relationships_xml(images: list[tuple[str, Path, str]]) -> str:
    relationships = [
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    ]
    for relation_id, _, archive_name in images:
        relationships.append(
            f'<Relationship Id="{relation_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{archive_name}"/>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(relationships)
        + "</Relationships>"
    )


def write_docx(
    output: Path,
    body: list[str],
    images: list[tuple[str, Path, str]],
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    if temporary.exists():
        temporary.unlink()

    try:
        with ZipFile(temporary, "w", ZIP_DEFLATED) as archive:
            entries = [
                ("[Content_Types].xml", content_types_xml(images)),
                ("_rels/.rels", root_relationships_xml()),
                ("word/document.xml", document_xml(body)),
                ("word/styles.xml", styles_xml()),
                ("word/_rels/document.xml.rels", document_relationships_xml(images)),
            ]
            for name, data in entries:
                archive.writestr(name, data)
            for _, source, archive_name in images:
                archive.write(source, f"word/media/{archive_name}")
        temporary.replace(output)
    finally:
        if temporary.exists():
            temporary.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Markdown draft to convert.")
    parser.add_argument(
        "--image",
        action="append",
        default=[],
        metavar="PNG",
        help="PNG matched to the next Figure marker; repeat once per figure.",
    )
    parser.add_argument("--output", required=True, help="Destination DOCX path.")
    args = parser.parse_args()

    markdown = Path(args.input)
    if not markdown.is_file():
        raise FileNotFoundError(f"Markdown input does not exist: {markdown}")

    body, images, counts = build_body(markdown, args.image)
    output = Path(args.output)
    write_docx(output, body, images)

    report = {
        "status": "ok",
        "output": str(output),
        "images": [str(source) for _, source, _ in images],
        **counts,
    }
    print(f"Built DOCX: {output}")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
