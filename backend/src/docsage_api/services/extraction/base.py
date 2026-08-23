"""Extraction dispatch: a stored file becomes an ordered list of document parts."""

from dataclasses import dataclass, field
from pathlib import Path

MAX_PARTS = 400
MAX_CONTENT_CHARS = 100_000

ALLOWED_MIME_TYPES = frozenset(
    {
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "image/png",
        "image/jpeg",
        "text/plain",
        "text/markdown",
        "text/csv",
        "application/csv",
    }
)


@dataclass
class ExtractedPart:
    """One ordered piece of a document: prose, a table, or an image."""

    kind: str  # 'text' | 'table' | 'image'
    content: str = ""
    image_bytes: bytes | None = None
    mime: str = ""
    filename: str = ""
    page: int | None = None


@dataclass
class ExtractionResult:
    """Extracted parts plus housekeeping derived during the pass."""

    parts: list[ExtractedPart] = field(default_factory=list)
    page_count: int | None = None


def markdown_table(rows: list[list[str]]) -> str:
    """Serialize rows (first row = header) as a GitHub-style markdown table."""
    if not rows:
        return ""

    def cell(value: object) -> str:
        return str(value if value is not None else "").replace("\n", " ").replace("|", "\\|")

    lines = [f"| {' | '.join(cell(c) for c in rows[0])} |"]
    lines.append(f"| {' | '.join('---' for _ in rows[0])} |")
    for row in rows[1:]:
        lines.append(f"| {' | '.join(cell(c) for c in row)} |")
    return "\n".join(lines)


def _cap_parts(parts: list[ExtractedPart]) -> list[ExtractedPart]:
    if len(parts) <= MAX_PARTS:
        return parts
    return parts[:MAX_PARTS]


def _cap_content(part: ExtractedPart) -> ExtractedPart:
    if len(part.content) <= MAX_CONTENT_CHARS:
        return part
    note = f"\n\n[content truncated at {MAX_CONTENT_CHARS} characters]"
    part.content = part.content[:MAX_CONTENT_CHARS] + note
    return part


def extract(path: Path, mime: str) -> ExtractionResult:
    """Dispatch extraction by mime type; ValueError for unsupported types."""
    from docsage_api.services.extraction import docx, image, pdf, text, xlsx

    result = ExtractionResult()
    if mime == "application/pdf":
        result = pdf.extract(path)
    elif mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        result = docx.extract(path)
    elif mime == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        result = xlsx.extract(path)
    elif mime in ("image/png", "image/jpeg"):
        result = image.extract(path, mime)
    elif mime in ("text/plain", "text/markdown", "text/csv", "application/csv"):
        result = text.extract(path, mime)
    else:
        raise ValueError(f"unsupported type: {mime}")

    result.parts = _cap_parts([_cap_content(p) for p in result.parts])
    return result
