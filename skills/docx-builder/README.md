# DOCX Builder

This skill creates reproducible, anonymized DOCX documents from a small Markdown draft. It supports text-only documents and optional PNG figures, while keeping diagram generation separate from document assembly.

## Files

- `SKILL.md`: agent-facing instructions, input contract, workflow, privacy rules, and limits.
- `scripts/build_docx.py`: converts the supported Markdown subset into an Open XML DOCX and embeds any supplied PNG figures.
- `scripts/generate_diagrams.py`: optional Pillow-based example generator for a flow diagram and a phase diagram.
- `examples/plain_document.md`: text-only input example.
- `examples/sample_document.md`: input example with two optional figure markers.

## Quick test

Run from this directory:

```bash
python scripts/generate_diagrams.py --output-dir docx-output
python scripts/build_docx.py --input examples/sample_document.md --image docx-output/example-flow.png --image docx-output/example-phases.png --output docx-output/example-report.docx
python scripts/build_docx.py --input examples/plain_document.md --output docx-output/plain-report.docx
```

The commands are idempotent for the same output directory. They print human-readable status lines followed by JSON reports. The output directory is ignored by the repository and should not be committed.

## Implementation notes

The optional drawing code uses Pillow primitives such as rounded rectangles, text, lines, and arrowheads. The DOCX writer uses only Python's standard library (`zipfile`, XML escaping, and PNG header inspection); it does not require Word or `python-docx`.

The builder matches `Figure <number>.` lines to repeated `--image` arguments in order of appearance. It accepts zero or more figures and rejects missing, extra, or invalid image arguments instead of silently producing incomplete output.

The generated package should still be opened in a compatible document viewer for visual review. A successful script run confirms file creation and package assembly, not page layout quality.
