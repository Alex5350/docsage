"""PDF extraction: pypdf page text + pdfplumber tables, deduplicated."""

import re
from pathlib import Path

import pdfplumber
from pypdf import PdfReader

from docsage_api.services.extraction.base import ExtractedPart, ExtractionResult, markdown_table


def _normalize(value: object) -> str:
    return re.sub(r"\s+", " ", str(value if value is not None else "")).strip()


def _is_duplicate_table(rows: list[list[object]], page_text: str) -> bool:
    """True when the table's cell values already appear in the page's plain text."""
    flat = _normalize(" ".join(_normalize(cell) for row in rows for cell in row))
    page = _normalize(page_text)
    if not flat:
        return True
    cells = [_normalize(cell) for row in rows for cell in row]
    cells = [c for c in cells if len(c) >= 3]
    if not cells:
        return False
    present = sum(1 for c in cells if c in page)
    return present / len(cells) >= 0.8


def extract(path: Path) -> ExtractionResult:
    reader = PdfReader(str(path))
    pages_text: list[str] = []
    for page in reader.pages:
        try:
            pages_text.append(page.extract_text() or "")
        except Exception:
            pages_text.append("")  # one unreadable page must not kill the pipeline

    result = ExtractionResult(page_count=len(reader.pages))
    with pdfplumber.open(path) as plumber:
        for number, text in enumerate(pages_text, start=1):
            if _normalize(text):
                result.parts.append(ExtractedPart(kind="text", content=text, page=number))
            plumber_page = plumber.pages[number - 1] if number <= len(plumber.pages) else None
            if plumber_page is None:
                continue
            for table in plumber_page.extract_tables():
                rows = [list(row) for row in table]
                serialized = markdown_table(rows)
                if serialized and not _is_duplicate_table(rows, text):
                    result.parts.append(
                        ExtractedPart(kind="table", content=serialized, page=number)
                    )
    return result
