"""DOCX extraction: body-ordered paragraphs and tables, plus inline images."""

from pathlib import Path

from docx import Document
from docx.document import Document as DocumentObject
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph

from docsage_api.services.extraction.base import ExtractedPart, ExtractionResult, markdown_table


def _iter_body(document: DocumentObject):
    """Yield (paragraph | table) in stored body order (skips sectPr etc.)."""
    for child in document.element.body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, document)
        elif isinstance(child, CT_Tbl):
            yield Table(child, document)


def extract(path: Path) -> ExtractionResult:
    document = Document(str(path))
    result = ExtractionResult()

    for item in _iter_body(document):
        if isinstance(item, Paragraph):
            text = item.text.strip()
            if text:
                result.parts.append(ExtractedPart(kind="text", content=text))
        else:
            rows = [[cell.text for cell in row.cells] for row in item.rows]
            serialized = markdown_table(rows)
            if serialized:
                result.parts.append(ExtractedPart(kind="table", content=serialized))

    # Inline images ride on the package relationships; external targets have no bytes here.
    for rel in document.part.rels.values():
        if "image" not in rel.reltype or rel.is_external:
            continue
        image_part = rel.target_part
        filename = str(image_part.partname).rsplit("/", 1)[-1]
        result.parts.append(
            ExtractedPart(
                kind="image",
                image_bytes=image_part.blob,
                mime=image_part.content_type,
                filename=filename,
            )
        )
    return result
