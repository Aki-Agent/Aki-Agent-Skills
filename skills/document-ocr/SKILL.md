---
name: document-ocr
description: Extracts page-labeled text from native, scanned, or mixed PDFs and image files using local OCR when needed. Use when a user needs to read, search, summarize, or quote a document whose pages contain text, scanned images, or both.
---

# Document OCR

Extract text page by page before interpreting a document. Use the PDF page number as the stable reference; printed page numbers can differ.

## Requirements

- Python 3 with venv support and PyMuPDF. If PyMuPDF is missing, the script installs it into a virtual environment in the cache directory and reruns itself.
- Node.js and npm for pages that need OCR. The script installs `tesseract.js@5.1.1` in its cache when missing. Tesseract downloads language data on first use.
- Network access is needed only for missing dependencies or language data. Installations remain in the cache directory. Use `--no-bootstrap` to prevent dependency installation and require cached OCR language data.

Install missing dependencies and download the required language data directly, then continue. Do not disable TLS verification or conceal the underlying error.

## Page count and OCR scope

Before running OCR, check the PDF's total page count and whether the relevant pages have usable extractable text. Use an available PDF inspection tool or PyMuPDF; inspect representative pages when the document may be mixed. Do not claim that every page lacks text based only on a sample.

- For a document of 30 pages or fewer, proceed with the requested extraction without asking about the page count.
- For a document with more than 30 pages that needs OCR, explain clearly that the affected pages lack usable extractable text and OCR may take a long time. Ask whether to extract specific pages or ranges, or all pages. Wait for the user's choice before starting extraction. If the user has already specified the scope, follow it without asking again.
- For many pages, use `--pages` to process consecutive, bounded ranges in separate runs instead of sending all pages to one call. For example, start with `--pages 1-5 --output-dir /workspace/document-ocr-output/batch-1`, then use `--pages 6-10 --output-dir /workspace/document-ocr-output/batch-2` and continue through the selected scope. Adjust batch size to the environment and reduce it if a run times out or exhausts resources. A separate output directory prevents results from being overwritten; retain the original PDF page numbers and check each batch's status. Batching limits the work in each call, but does not necessarily reduce total processing time.

## Usage

```bash
python3 scripts/extract.py <INPUT_FILE> \
  --output-dir /workspace/document-ocr-output \
  --lang <LANG>
```

`<INPUT_FILE>` may be a PDF or an image supported by PyMuPDF. Images are treated as a single page. Before OCR, identify the document's most likely language from the user's description, any extractable text, or a visual sample of its pages. The user's conversational language is a useful initial clue, but the document may differ. Set `<LANG>` to the corresponding Tesseract language code, such as `spa` or `eng`; for multilingual documents use combined codes such as `eng+spa`. If uncertain, inspect a small OCR sample and adjust the language before processing the rest. The script defaults to `eng` when `--lang` is omitted.

| Option | Purpose |
|---|---|
| `--pages 1,3-5` | Process the selected 1-based document pages. |
| `--force-ocr` | Run OCR on every selected page, including pages with native text. |
| `--min-chars 40` | Minimum count of non-whitespace native text characters before OCR is skipped. |
| `--dpi 180` | Resolution used to render pages for OCR. |
| `--cache-dir <PATH>` | Override the cache; the default is `$WORKSPACE/.cache/document-ocr`, or `/workspace/.cache/document-ocr` if unset. |
| `--no-bootstrap` | Do not install packages or download missing OCR language data. |

The output directory receives `document.txt` and `document.json`; an existing output with those names is replaced. The JSON records each page's method, status, text, native character count, embedded-image count, and errors. Page status `empty` means OCR returned no text; it does not prove a page is blank. A partial or empty result exits nonzero. Input files are not modified.

## Batch recovery and troubleshooting

- **Timeout or interruption:** both scripts write their result files only after finishing the selected batch. There are no per-page checkpoints or resume support. Progress messages do not mean that text has been saved; the Python wrapper also buffers the OCR helper's stderr until it exits. A killed call may leave no final output, or old files from an earlier run in the same directory. Use a fresh output directory for each attempt and rerun only the interrupted range, reducing its size if needed. Keep completed batches; do not restart the entire document.
- **Resource pressure before OCR starts:** the extractor renders all selected OCR pages before starting recognition. Large batches can therefore consume substantial temporary disk space. Reduce the page range first rather than repeatedly retrying the same call.
- **Nonzero exit with output files:** `extract.py` returns exit code `1` for both partial results and results with no successful pages, including batches containing only `empty` pages. Inspect `document.json` and each page's `status` and `error`; a nonzero code alone does not mean the OCR engine crashed. If no valid report exists, inspect stderr and treat the attempt as incomplete. Review `empty` pages against their full-resolution originals before accepting them as blank.

Capture the exit code without aborting a batch workflow before inspecting its report:

```bash
if python3 scripts/extract.py <INPUT_FILE> --pages 1-5 \
  --lang <LANG> --output-dir /workspace/document-ocr-output/batch-1; then
  rc=0
else
  rc=$?
fi
printf 'Extractor exit code: %s\n' "$rc"
```

### Consolidating completed batches

Do not concatenate JSON files or renumber pages. List only the accepted batch directories explicitly; do not include both an interrupted attempt and its replacement. Check that every report refers to the same input and language, and that its page records cover the requested scope exactly once. Keep `empty` and `error` records rather than silently dropping them.

The following standard-library example combines `batch-1` (pages `1-5`) and `batch-2` (pages `6-10`). Run it only after both reports are available. Edit `batches` and `expected` to match the actual requested scope; `expected` contains original PDF page indices, not printed page numbers. The input-path comparison assumes the batches used the same source path; if the source was moved, verify its identity before changing the metadata.

```python
import json
from collections import Counter
from pathlib import Path

root = Path("/workspace/document-ocr-output")
batches = [root / "batch-1", root / "batch-2"]
expected = list(range(1, 11))
reports = [json.loads((folder / "document.json").read_text(encoding="utf-8"))
           for folder in batches]
if len({(r["input"], r["language"]) for r in reports}) != 1:
    raise SystemExit("Batch input or language mismatch")
pages = [page for report in reports for page in report["pages"]]
numbers = [page["page"] for page in pages]
if sorted(numbers) != sorted(expected) or len(set(expected)) != len(expected):
    raise SystemExit("Missing, duplicate, or unexpected pages; no output written")
if any(page["status"] not in {"ok", "empty", "error"} for page in pages):
    raise SystemExit("Unknown page status; no output written")
pages.sort(key=lambda page: page["page"])
counts = Counter(page["status"] for page in pages)
succeeded = counts["ok"]
summary = dict(reports[0], pages=pages, pages_requested=len(pages),
               pages_succeeded=succeeded,
               status="ok" if succeeded == len(pages) else
                      "partial" if succeeded else "error")
lines = []
for page in pages:
    text = (page["text"] if page["status"] == "ok" else
            "[EMPTY: no text recognized]" if page["status"] == "empty" else
            "[ERROR] " + str(page.get("error")))
    lines.append("===== PAGE %s [%s] =====\n%s" %
                 (page["page"], page["method"], text))
output = root / "combined"
output.mkdir(parents=True, exist_ok=True)
(output / "document.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(output / "document.txt").write_text("\n\n".join(lines) + "\n", encoding="utf-8")
print(json.dumps({"pages": len(pages), "statuses": dict(counts),
                  "output_dir": str(output)}))
```

Consolidation checks coverage and metadata, not recognition accuracy. A combined report can legitimately remain `partial` because it retains empty or failed pages. For a retry, select the affected original page numbers with `--pages`, write to a new directory, and rebuild the accepted batch list without overlapping earlier records.

## Workflow

1. Confirm the input and requested pages. Distinguish the PDF page index from printed page numbers, especially when a scan contains two printed pages on one PDF page.
2. Prefer native text extraction and OCR for substantial content. For a small amount of content, an available and permitted image interpreter may be used first. Keep input, output, and cache in locations permitted by the environment. If the document contains private information, do not publish it or send its images to an external service without authorization.
3. If using the extraction script, inspect its JSON report. A page with enough native text uses that text; otherwise the script renders it and uses OCR. This character-count heuristic cannot detect missing text embedded in images alongside native text. Inspect mixed pages and rerun with `--force-ocr` or review the image when needed.
4. Check failed or empty pages against the original. For important quotations, names, numbers, formulas, tables, or multi-column pages, compare the extracted text with a full-resolution image of the relevant page. A contact sheet can help locate pages, but thumbnails may be unreadable.
5. Preserve page references in the answer. Mark uncertain or illegible passages; never fill gaps by guessing. A completed OCR call and a nonempty output do not establish accuracy.
6. If OCR is unavailable, fails, or leaves uncertain content, use an available and permitted image interpreter as a fallback to extract text and information. Render or provide individual high-resolution images of the relevant pages. The interpreter can also help verify uncertain passages; treat its output as an interpretation to check against the original, not as proof.

## Limits

- Tables, multi-column layouts, handwriting, low-quality scans, mixed text and images, and page order can be misread. OCR text alone is not a verified quotation.
- This extracts text; it does not produce a searchable PDF or verify printed page numbers.
- OCR requires Node.js, npm, compatible Tesseract.js dependencies, and the requested language data. Report real installation, network, language-data, and per-page errors.
