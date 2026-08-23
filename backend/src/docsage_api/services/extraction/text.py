"""Plain-text extraction: raw txt/md and csv rendered as a markdown table."""

import csv
from pathlib import Path

from docsage_api.services.extraction.base import ExtractedPart, ExtractionResult, markdown_table


def extract(path: Path, mime: str) -> ExtractionResult:
    raw = path.read_text(encoding="utf-8", errors="replace")
    if mime not in ("text/csv", "application/csv"):
        return ExtractionResult(parts=[ExtractedPart(kind="text", content=raw)])

    rows = [[cell for cell in row] for row in csv.reader(raw.splitlines())]
    return ExtractionResult(parts=[ExtractedPart(kind="table", content=markdown_table(rows))])
