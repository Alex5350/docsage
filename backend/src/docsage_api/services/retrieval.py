"""Provider-qualified vector retrieval per docs/CONTRACT.md chat rules."""

import uuid
from dataclasses import dataclass

from sqlalchemy import ColumnExpressionArgument, select
from sqlalchemy.orm import Session

from docsage_api.core.config import Settings, get_settings
from docsage_api.db.models import Chunk, Document, User
from docsage_api.services.embeddings.base import get_provider

TOP_K = 6
# Noise floor for real provider scores. Demo vectors are hash noise whose
# pairwise cosine similarities concentrate around 0 (sigma ~ 1/sqrt(1536) ≈
# 0.026), so the same floor would always empty demo results — demo ranking is
# top-k only, with no cutoff.
REAL_PROVIDER_CUTOFF = 0.15


@dataclass
class RetrievedChunk:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    content: str
    page: int | None
    similarity: float
    provider: str


def candidate_filter(user: User, scope: str) -> ColumnExpressionArgument[bool]:
    """Visibility predicate for chat retrieval (personal | admin scopes)."""
    if scope == "admin":
        return Document.status != "failed"
    return (
        (Document.scope == "personal") & (Document.owner_id == user.id)
    ) | ((Document.scope == "library") & (Document.review_status == "approved"))


def retrieve(
    db: Session,
    user: User,
    scope: str,
    question: str,
    k: int = TOP_K,
    settings: Settings | None = None,
) -> list[RetrievedChunk]:
    """Top-k chunks over the visible corpus, merged across provider spaces."""
    settings = settings or get_settings()
    visibility = candidate_filter(user, scope)

    providers = list(
        db.scalars(
            select(Document.embedding_provider)
            .where(visibility)
            .distinct()
            .order_by(Document.embedding_provider)
        )
    )[:2]

    merged: list[RetrievedChunk] = []
    for provider_name in providers:
        provider = get_provider(provider_name, settings)
        query_vector = provider.embed_query(question)
        distance = Chunk.embedding.cosine_distance(query_vector)
        rows = db.execute(
            select(Chunk, Document, distance.label("dist"))
            .join(Document, Document.id == Chunk.document_id)
            .where(
                visibility,
                Document.embedding_provider == provider_name,
                Chunk.embedding.is_not(None),
            )
            .order_by(distance)
            .limit(k)
        ).all()
        cutoff = REAL_PROVIDER_CUTOFF if provider_name != "demo" else -1.0
        for chunk, document, dist in rows:
            similarity = 1.0 - float(dist)
            if similarity < cutoff:
                continue
            merged.append(
                RetrievedChunk(
                    chunk_id=chunk.id,
                    document_id=document.id,
                    document_title=document.title,
                    content=chunk.content,
                    page=chunk.page,
                    similarity=similarity,
                    provider=provider_name,
                )
            )

    merged.sort(key=lambda r: r.similarity, reverse=True)
    return merged[:k]
