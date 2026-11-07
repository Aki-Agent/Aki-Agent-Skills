#!/usr/bin/env python3
"""Extract text from native, scanned, or mixed PDFs and image files."""
import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PINNED_OCR = "tesseract.js@5.1.1"


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="PDF or image file")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, default=Path(os.environ.get("WORKSPACE", "/workspace")) / ".cache" / "document-ocr")
    parser.add_argument("--lang", default="eng", help="Tesseract language codes, e.g. eng or eng+spa")
    parser.add_argument("--pages", help="1-based PDF page numbers and ranges, e.g. 1,3-5")
    parser.add_argument("--min-chars", type=int, default=40, help="minimum non-whitespace native text characters")
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument("--force-ocr", action="store_true", help="OCR all selected pages")
    parser.add_argument("--no-bootstrap", action="store_true", help="do not install missing dependencies")
    return parser.parse_args()


def page_numbers(value, count):
    if not value:
        return list(range(1, count + 1))
    selected = set()
    for token in value.split(","):
        match = re.fullmatch(r"\s*(\d+)(?:\s*-\s*(\d+))?\s*", token)
        if not match:
            raise ValueError("Invalid page selection: " + token)
        start, end = int(match.group(1)), int(match.group(2) or match.group(1))
        if start < 1 or end < start or end > count:
            raise ValueError("Page selection is outside the document: " + token)
        selected.update(range(start, end + 1))
    return sorted(selected)


def ensure_pymupdf(args):
    if importlib.util.find_spec("pymupdf") or importlib.util.find_spec("fitz"):
        return
    if args.no_bootstrap:
        raise RuntimeError("PyMuPDF is unavailable and --no-bootstrap was requested")
    env_dir = args.cache_dir / "python"
    python = env_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        subprocess.run([sys.executable, "-m", "venv", str(env_dir)], check=True)
    subprocess.run([str(python), "-m", "pip", "install", "PyMuPDF>=1.24,<2"], check=True)
    result = subprocess.run([str(python), str(Path(__file__).resolve()), *sys.argv[1:]])
    sys.exit(result.returncode)


def ensure_ocr(args):
    node, npm = shutil.which("node"), shutil.which("npm")
    package = args.cache_dir / "node" / "node_modules" / "tesseract.js" / "package.json"
    if not node:
        raise RuntimeError("Node.js is required for OCR")
    if not package.is_file():
        if args.no_bootstrap:
            raise RuntimeError("tesseract.js is unavailable and --no-bootstrap was requested")
        if not npm:
            raise RuntimeError("npm is required to install tesseract.js")
        prefix = package.parents[2]
        prefix.mkdir(parents=True, exist_ok=True)
        subprocess.run([npm, "install", "--no-audit", "--no-fund", "--prefix", str(prefix), PINNED_OCR], check=True)
    version = json.loads(package.read_text(encoding="utf-8")).get("version")
    if args.no_bootstrap:
        missing = [lang for lang in args.lang.split("+") if not (args.cache_dir / "languages" / (lang + ".traineddata")).is_file()]
        if missing:
            raise RuntimeError("OCR language data unavailable with --no-bootstrap: " + ", ".join(missing))
    if version != PINNED_OCR.split("@")[1]:
        raise RuntimeError("Unexpected tesseract.js version in cache: " + str(version))
    return node, package.parent


def main():
    args = arguments()
    if args.min_chars < 1 or not 72 <= args.dpi <= 600:
        raise ValueError("--min-chars must be positive and --dpi must be between 72 and 600")
    if not re.fullmatch(r"[A-Za-z0-9_]+(?:\+[A-Za-z0-9_]+)*", args.lang):
        raise ValueError("Invalid OCR language code")
    if not args.input.is_file():
        raise FileNotFoundError("Input file not found: " + str(args.input))
    args.input = args.input.resolve()
    args.output_dir = args.output_dir.resolve()
    args.cache_dir = args.cache_dir.resolve()
    if args.input in [(args.output_dir / "document.txt"), (args.output_dir / "document.json")]:
        raise ValueError("Input must not be one of the output files")
    ensure_pymupdf(args)
    try:
        import pymupdf as fitz
    except ImportError:
        import fitz

    doc = fitz.open(str(args.input))
    pages = page_numbers(args.pages, len(doc))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix="ocr-", dir=str(args.cache_dir)) as temp:
        jobs = []
        for number in pages:
            record = {"page": number, "method": None, "status": "error", "text": "", "error": None}
            results.append(record)
            try:
                page = doc[number - 1]
                text = page.get_text("text").strip()
                record["native_characters"] = len(re.sub(r"\s", "", text))
                record["embedded_images"] = len(page.get_images(full=True))
                if not args.force_ocr and record["native_characters"] >= args.min_chars:
                    record.update(method="native", status="ok", text=text)
                else:
                    png = Path(temp) / ("page-%04d.png" % number)
                    page.get_pixmap(dpi=args.dpi, alpha=False).save(str(png))
                    jobs.append({"page": number, "image": str(png)})
                    record["method"] = "ocr"
            except Exception as exc:
                record["error"] = str(exc)

        if jobs:
            try:
                node, package = ensure_ocr(args)
                manifest = Path(temp) / "jobs.json"
                output = Path(temp) / "results.json"
                manifest.write_text(json.dumps(jobs), encoding="utf-8")
                helper = Path(__file__).with_name("ocr.cjs")
                run = subprocess.run([node, str(helper), str(package), str(manifest), str(output), args.lang, str(args.cache_dir / "languages")], capture_output=True, text=True)
                if run.stderr:
                    print(run.stderr, file=sys.stderr, end="")
                if run.returncode != 0 or not output.is_file():
                    raise RuntimeError("OCR process failed (exit %s): %s" % (run.returncode, run.stderr.strip()))
                ocr = {item["page"]: item for item in json.loads(output.read_text(encoding="utf-8"))}
                for record in results:
                    if record["method"] == "ocr":
                        item = ocr.get(record["page"])
                        if item is None:
                            record["error"] = "OCR did not return a result for this page"
                        else:
                            record.update(status=item["status"], text=item.get("text", ""), error=item.get("error"))
            except (OSError, RuntimeError, subprocess.CalledProcessError, ValueError) as exc:
                for record in results:
                    if record["method"] == "ocr":
                        record["error"] = str(exc)

    doc.close()
    succeeded = sum(item["status"] == "ok" for item in results)
    summary = {"status": "ok" if succeeded == len(results) else "partial" if succeeded else "error",
               "input": str(args.input), "language": args.lang, "pages_requested": len(results),
               "pages_succeeded": succeeded, "pages": results}
    (args.output_dir / "document.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.output_dir / "document.txt").write_text("\n\n".join(
        "===== PAGE %s [%s] =====\n%s" % (r["page"], r["method"], r["text"] if r["status"] == "ok" else "[EMPTY: no text recognized]" if r["status"] == "empty" else "[ERROR] " + str(r["error"]))
        for r in results) + "\n", encoding="utf-8")
    print("Pages processed: %d/%d (%s)" % (succeeded, len(results), summary["status"]))
    print(json.dumps({"status": summary["status"], "pages_requested": len(results), "pages_succeeded": succeeded,
                      "text_file": str(args.output_dir / "document.txt"), "json_file": str(args.output_dir / "document.json")}))
    return 0 if summary["status"] == "ok" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as exc:
        print("Error: " + str(exc), file=sys.stderr)
        sys.exit(1)
