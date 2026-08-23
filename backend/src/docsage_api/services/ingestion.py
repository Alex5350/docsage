"""Ingestion pipeline state machine: queued -> extracting -> enriching -> embedding -> ready.

Runs in a background task with its OWN database session — never the request
session — committing each state transition so progress (and failures) are
visible while the pipeline moves on.
"""

import uuid

from sqlalchemy.orm import Session

from docsage_api.core.config import get_settings
from docsage_api.db.models import Chunk, Document, Enrichment
from docsage_api.db.session import session_factory
from docsage_api.services import storage
from docsage_api.services.embeddings.base import get_provider
from docsage_api.services.enrichment import EnrichmentResult, EnrichmentService
from docsage_api.services.extraction.base import ExtractedPart, extract

# Chunk geometry: ~1100 tokens estimated at 4 chars/token, capped at 4000 chars
# (hard provider ceiling), with ~150 tokens (600 chars) of overlap between
# consecutive chunks from the same part.
CHUNK_MAX_CHARS = 4_000
CHUNK_OVERLAP_CHARS = 600
EMBED_BATCH_SIZE = 32


def _set_status(db: Session, document: Document, status: str, error: str | None = None) -> None:
    document.status = status
    document.status_error = error
    db.add(document)
    db.commit()


def _chunk_text(content: str) -> list[str]:
    """Fixed-size windows with overlap; whole parts shorter than the cap pass through."""
    if len(content) <= CHUNK_MAX_CHARS:
        return [content]
    step = CHUNK_MAX_CHARS - CHUNK_OVERLAP_CHARS
    return [content[start : start + CHUNK_MAX_CHARS] for start in range(0, len(content), step)]


def _build_chunks(parts: list[ExtractedPart], enrichment: EnrichmentResult) -> list[dict]:
    """Parts -> chunk dicts (kind, content, page, image_bytes/mime for image parts)."""
    chunks: list[dict] = []
    for index, part in enumerate(parts):
        if part.kind == "image":
            caption = enrichment.captions.get(index) if enrichment else None
            caption = caption or (
                f"Image {part.filename or 'attachment'} extracted from the document."
            )
            chunks.append(
                {
                    "kind": "image_description",
                    "content": caption,  # always embedded as text -> every provider retrieves it
                    "page": part.page,
                    "image_bytes": part.image_bytes,
                    "mime": part.mime,
                }
            )
            continue

        content = part.content
        preamble = enrichment.table_preambles.get(index) if enrichment else None
        for piece in _chunk_text(content):
            body = f"{preamble}\n\n{piece}" if part.kind == "table" and preamble else piece
            chunks.append({"kind": part.kind, "content": body, "page": part.page})
    return chunks


def _persist_enrichments(db: Session, document_id: uuid.UUID, enrichment: EnrichmentResult) -> None:
    db.add(Enrichment(document_id=document_id, kind="summary", content=enrichment.summary))
    if enrichment.keywords:
        db.add(
            Enrichment(
                document_id=document_id,
                kind="keywords",
                content=", ".join(enrichment.keywords),
            )
        )
    if enrichment.questions:
        for question in enrichment.questions:
            db.add(Enrichment(document_id=document_id, kind="questions", content=question))


def run_ingestion(document_id: uuid.UUID) -> None:
    """Process one document end to end; failures mark the row ``failed``."""
    settings = get_settings()
    db = session_factory()()
    try:
        document = db.get(Document, document_id)
        if document is None:
            return

        try:
            provider = get_provider(document.embedding_provider, settings)
        except ValueError as exc:
            _set_status(db, document, "failed", str(exc))
            return

        # ------------------------------------------------------------ extract
        _set_status(db, document, "extracting")
        try:
            path = storage.upload_path(document.id, document.source_filename)
            result = extract(path, document.mime_type)
            parts = result.parts
        except Exception as exc:
            _set_status(db, document, "failed", f"extraction failed: {exc}")
            return

        # ------------------------------------------------------------- enrich
        _set_status(db, document, "enriching")
        try:
            enrichment = EnrichmentService(settings).enrich(
                document.title, parts, document.embedding_provider
            )
            _persist_enrichments(db, document.id, enrichment)
            db.commit()
        except Exception as exc:
            db.rollback()
            _set_status(db, document, "failed", f"enrichment failed: {exc}")
            return
        for part_index, caption in enrichment.captions.items():
            if part_index < len(parts):  # caption artifacts are stored as enrichments too
                db.add(Enrichment(document_id=document.id, kind="caption", content=caption))
        db.commit()

        # ------------------------------------------------------------- embed
        _set_status(db, document, "embedding")
        try:
            chunks = _build_chunks(parts, enrichment)
            header = (
                f"{document.title} | {enrichment.summary[:120]} | "
                f"keywords: {', '.join(enrichment.keywords[:6])}"
            )
            rows: list[Chunk] = []
            pending_texts: list[tuple[int, str]] = []  # (position in rows, embedding text)
            for position, chunk in enumerate(chunks):
                row = Chunk(
                    document_id=document.id,
                    ordinal=position,
                    content=chunk["content"],
                    kind=chunk["kind"],
                    page=chunk["page"],
                    token_count=len(chunk["content"]) // 4,
                )
                if chunk["kind"] == "image_description" and chunk.get("image_bytes"):
                    native = provider.embed_image(
                        chunk["image_bytes"], chunk["mime"] or "image/png"
                    )
                    if native is not None:  # gemini: embed pixels directly, keep caption
                        row.embedding = native
                rows.append(row)
                if row.embedding is None:
                    pending_texts.append((position, f"{header}\n{chunk['content']}"))

            for start in range(0, len(pending_texts), EMBED_BATCH_SIZE):
                batch = pending_texts[start : start + EMBED_BATCH_SIZE]
                texts = [text for _, text in batch]
                vectors = provider.embed_documents(texts, title=document.title)
                if len(vectors) != len(batch):
                    raise ValueError(
                        f"provider returned {len(vectors)} vectors for {len(batch)} inputs"
                    )
                for (position, _), vector in zip(batch, vectors, strict=True):
                    rows[position].embedding = vector

            db.add_all(rows)
            document.chunk_count = len(rows)
            document.page_count = result.page_count
            document.embedding_model = provider.model_id
            if document.scope == "library":
                document.review_status = "pending_sme"
            document.status = "ready"
            document.status_error = None
            db.add(document)
            db.commit()
        except Exception as exc:
            db.rollback()
            _set_status(db, document, "failed", f"embedding failed: {exc}")
            return
    finally:
        db.close()
