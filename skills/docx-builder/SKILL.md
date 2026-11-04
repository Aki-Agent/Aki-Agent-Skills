---
name: docx-builder
description: Creates reproducible DOCX documents from a small Markdown draft with optional PNG figures. Use when a user needs a locally generated Word document and the supported plain-text, heading, bullet, and image layout is sufficient; extend the scripts for richer layouts.
---

# DOCX Builder

Create a Word document from verified content without requiring Word, a remote service, or project-specific data. The current implementation is deliberately small so it can be extended with tables, styles, headers, and other Open XML features later.

## Use this skill when

- The user needs a `.docx` file generated locally and reproducibly.
- The source can be expressed as headings, paragraphs, simple bullets, and optional figure captions.
- Images are supplied as PNG files or can be generated as PNGs before document assembly.
- A minimal Open XML document is preferable to a full office-document conversion stack.

Do not present the current implementation as a full Markdown-to-Word converter. Extend it or use a document-specific tool when the input needs tables, rich inline formatting, links, complex templates, tracked changes, editable charts, headers and footers, or strict pagination.

## Capabilities

`scripts/build_docx.py` currently supports:

- `# `, `## `, and `### ` headings.
- Plain non-empty paragraph lines.
- `- ` simple bullet paragraphs.
- Any number of figure markers whose lines begin with `Figure <number>.`.
- Optional PNG images, matched to figure markers in their order of appearance.
- Documents with no figures at all.
- A human-readable result followed by a JSON report.

Blank lines and indented lines are ignored. The parser intentionally does not convert tables, links, emphasis, nested lists, inline images, or arbitrary Markdown blocks.

## Method

- `scripts/build_docx.py` converts the supported draft into a minimal Open XML package with `zipfile` and the Python standard library.
- PNG dimensions are read from the image header and converted to Word EMUs before embedding the files under `word/media/`.
- `scripts/generate_diagrams.py` is an optional example producer. It uses Pillow primitives to create generic flow and phase PNGs; it is not required for text-only documents.
- Prefer Mermaid for diagrams when it is suitable, then render the result to PNG before passing it to the builder. Use Pillow or another raster renderer when custom deterministic drawing is more appropriate.
- No Word installation, API key, credentials, or remote document service is required. The optional Pillow bootstrap may use `pip` if Pillow is not already installed.

## Workflow

1. Collect and verify the document content. Remove personal data, credentials, tokens, private URLs, production identifiers, and local machine paths unless the user explicitly requires them in the output.
2. Copy `examples/plain_document.md` or `examples/sample_document.md` to a working location and replace its generic text with the verified content.
3. Add one line beginning with `Figure <number>.` for each image that should appear. The marker order, not the number value, determines which `--image` argument is used.
4. Use existing PNGs or generate generic example PNGs:

   ```bash
   python scripts/generate_diagrams.py --output-dir docx-output
   ```

5. Build the document. Omit `--image` for a text-only document, or repeat it once per figure marker:

   ```bash
   python scripts/build_docx.py \
     --input examples/sample_document.md \
     --image docx-output/example-flow.png \
     --image docx-output/example-phases.png \
     --output docx-output/example-report.docx
   ```

   A text-only document can be built with:

   ```bash
   python scripts/build_docx.py \
     --input examples/plain_document.md \
     --output docx-output/plain-report.docx
   ```

   On Windows, use `py -3` instead of `python` when needed.

6. Validate that the DOCX is a readable ZIP package and inspect it in a compatible viewer. Check every page for clipped text, unreadable labels, incorrect image order, unexpected page breaks, and missing content.
7. Keep generated files in `docx-output/` or another ignored/external directory. Do not commit generated DOCX, PNG, temporary, or cache files.

## Figure contract

The builder accepts figures only through explicit command-line arguments:

```text
Figure 1. Example flow.
Figure 2. Example phases.
```

For the two markers above, provide two arguments in the same order:

```text
--image path/to/flow.png --image path/to/phases.png
```

Each image must be a valid, non-empty PNG. A missing image, invalid PNG, missing figure argument, or extra image argument is a real input error and must be reported as a failure rather than silently ignored.

## Extending the skill

Keep the current plain-text path working while adding capabilities incrementally:

- Add a parser branch and matching Open XML for tables or richer inline runs.
- Add style options as explicit arguments rather than hard-coding user-specific values.
- Add a reusable relationship allocator when adding more media types.
- Add a dedicated template path only when the document requires an existing Word template.
- Keep image generation separate from DOCX assembly so users can supply Mermaid renders, screenshots, charts, or other verified PNGs.

After each extension, test both a document with no figures and one with multiple figures.

## Privacy requirements

- Use generic placeholders such as `<PROJECT_NAME>`, `<SERVICE_NAME>`, and `<DATE>` in committed examples.
- Do not place names, email addresses, credentials, tokens, private URLs, production identifiers, IP addresses, or personal file paths in drafts, scripts, or documentation.
- Do not copy source documents or generated artifacts into the repository unless they are demonstrably anonymized.
- Review the full diff and source text before publishing.

## Verification checklist

- Run the relevant script end-to-end on a real local draft.
- Run it a second time with the same arguments to verify idempotence.
- Measure the runtime of the actual commands when documenting performance.
- Test a failure path, such as a missing image or an invalid PNG, and preserve the underlying error.
- Inspect the DOCX ZIP entries, XML parts, relationships, and embedded images programmatically.
- Review the rendered document visually when a compatible viewer is available; structural validation does not prove page layout quality.
