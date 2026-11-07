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

Ask for permission before installing packages or downloading language data when the user's environment requires it. Do not disable TLS verification or conceal the underlying error.

## Usage

```bash
python3 scripts/extract.py <INPUT_FILE> \
  --output-dir /workspace/document-ocr-output \
  --lang spa
```

`<INPUT_FILE>` may be a PDF or an image supported by PyMuPDF. Images are treated as a single page. The default language is `eng`; use the Tesseract language codes supplied by the user, such as `spa` or `eng+spa`.

| Option | Purpose |
|---|---|
| `--pages 1,3-5` | Process the selected 1-based document pages. |
| `--force-ocr` | Run OCR on every selected page, including pages with native text. |
| `--min-chars 40` | Minimum count of non-whitespace native text characters before OCR is skipped. |
| `--dpi 180` | Resolution used to render pages for OCR. |
| `--cache-dir <PATH>` | Override the cache; the default is `$WORKSPACE/.cache/document-ocr`, or `/workspace/.cache/document-ocr` if unset. |
| `--no-bootstrap` | Do not install packages or download missing OCR language data. |

The output directory receives `document.txt` and `document.json`; an existing output with those names is replaced. The JSON records each page's method, status, text, native character count, embedded-image count, and errors. Page status `empty` means OCR returned no text; it does not prove a page is blank. A partial or empty result exits nonzero. Input files are not modified.

## Workflow

1. Confirm the input and requested pages. Distinguish the PDF page index from printed page numbers, especially when a scan contains two printed pages on one PDF page.
2. Run extraction, keeping input, output, and cache in locations permitted by the environment. If the document contains private information, do not publish it or send its images to an external service without authorization.
3. Inspect the JSON report. A page with enough native text uses that text; otherwise the script renders it and uses OCR. This character-count heuristic cannot detect missing text embedded in images alongside native text. Inspect mixed pages and rerun with `--force-ocr` or review the image when needed.
4. Check failed or empty pages against the original. For important quotations, names, numbers, formulas, tables, or multi-column pages, compare the extracted text with a full-resolution image of the relevant page. A contact sheet can help locate pages, but thumbnails may be unreadable.
5. Preserve page references in the answer. Mark uncertain or illegible passages; never fill gaps by guessing. A completed OCR call and a nonempty output do not establish accuracy.
6. If a vision capability is available and permitted, use individual high-resolution pages to resolve uncertain passages. Treat its output as another interpretation to verify, not as proof.

## Limits

- Tables, multi-column layouts, handwriting, low-quality scans, mixed text and images, and page order can be misread. OCR text alone is not a verified quotation.
- This extracts text; it does not produce a searchable PDF or verify printed page numbers.
- OCR requires Node.js, npm, compatible Tesseract.js dependencies, and the requested language data. Report real installation, network, language-data, and per-page errors.
