#!/usr/bin/env python3
"""
Verifica las capturas y arma el PDF y el PPTX a partir del manifest de
export_slides.mjs. No redibuja layouts nativos: una captura = una pagina.

Uso:
  python scripts/export_pack.py --manifest /workspace/.cache/motion-presentations/export/manifest.json \
    --name Deck-Title

Dependencias (venv, porque pip global esta bloqueado por PEP 668):
  python3 -m venv /workspace/.venv && /workspace/.venv/bin/pip install pillow img2pdf python-pptx
"""
import argparse, json, sys
from pathlib import Path

import img2pdf
from PIL import Image, ImageStat
from pptx import Presentation
from pptx.util import Emu, Inches

W_IN, H_IN = 13.333333, 7.5

def fail(msg):
    print(f"error: {msg}")
    sys.exit(2)

ap = argparse.ArgumentParser()
ap.add_argument("--manifest", required=True)
ap.add_argument("--name", default="presentation")
ap.add_argument("--pptx", action="store_true", default=True)
ap.add_argument("--no-pptx", dest="pptx", action="store_false")
ap.add_argument("--no-pdf", dest="pdf", action="store_false", default=True)
ap.add_argument("--skip-vda", action="store_true", help="accept 1920x1080 captures when deviceScaleFactor 2 was not possible")
a = ap.parse_args()

mf = json.loads(Path(a.manifest).read_text(encoding="utf-8"))
files = [Path(f["png"]) for f in mf["files"]]
expected = (int(mf["width"]), int(mf["height"]))
if not files: fail("manifest has no captures")

report = []
for p in files:
    if not p.exists(): fail(f"missing capture {p}")
    im = Image.open(p)
    if im.size != expected: fail(f"{p.name} is {im.size}, expected {expected}")
    if p.stat().st_size < 50_000: fail(f"{p.name} is {p.stat().st_size} bytes, likely an empty slide")
    gray = im.convert("L")
    std = ImageStat.Stat(gray).stddev[0]
    if std < 1.5: fail(f"{p.name} looks blank (stddev {std:.2f}): no JS state or wrong active slide")
    report.append({"n": len(report) + 1, "png": str(p), "bytes": p.stat().st_size, "size": list(im.size), "stddev": round(std, 1)})

n = len(report)
out = Path("/workspace")
pdf_path = out / f"{a.name}.pdf"
pptx_path = out / f"{a.name}.pptx"

if a.pdf:
    layout = img2pdf.get_layout_fun((img2pdf.in_to_pt(W_IN), img2pdf.in_to_pt(H_IN)))
    pdf_path.write_bytes(img2pdf.convert([str(f) for f in files], layout_fun=layout))

if a.pptx:
    prs = Presentation()
    prs.slide_width = Inches(W_IN)
    prs.slide_height = Inches(H_IN)
    blank = prs.slide_layouts[6]
    for f, item in zip(files, mf["files"]):
        slide = prs.slides.add_slide(blank)
        slide.shapes.add_picture(str(f), Emu(0), Emu(0), width=prs.slide_width, height=prs.slide_height)
        note = slide.notes_slide.notes_text_frame
        note.text = f"Slide {item['n']}: {(item['data_sec'] or item['title'] or f'Diapositiva {item["n"]}')}".strip()
    prs.save(str(pptx_path))

summary = {
    "slides": n,
    "capture_size": list(expected),
    "page_inches": [W_IN, H_IN],
    "pdf": {"path": str(pdf_path), "pages": n, "bytes": pdf_path.stat().st_size} if a.pdf else None,
    "pptx": {"path": str(pptx_path), "slides": n, "bytes": pptx_path.stat().st_size} if a.pptx else None,
    "captures": report,
}
print(json.dumps(summary, indent=2))
