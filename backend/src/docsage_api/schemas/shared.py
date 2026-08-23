"""Shared DTOs for documents, topics, reviews, chat, and admin endpoints.

Shapes follow docs/CONTRACT.md so future routers (documents, topics, reviews,
chat, admin) serialize consistently.
"""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class OwnerRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str


class TopicRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class TopicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    smes: list["SmeRef"] = []


class SmeRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    email: str


class EnrichmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: str
    content: str


class ApprovalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    reviewer: str  # reviewer display name (matches the .NET parity DTO)
    decision: str
    note: str
    decided_at: datetime


class DocumentSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    source_filename: str
    mime_type: str
    scope: str
    status: str
    status_error: str | None
    embedding_provider: str
    embedding_model: str
    topic: TopicRef | None
    review_status: str
    chunk_count: int
    size_bytes: int
    created_at: datetime
    owner: OwnerRef | None = None
    pending_reviewer: bool = False


class DocumentDetail(DocumentSummary):
    enrichments: list[EnrichmentOut] = []
    approvals: list[ApprovalOut] = []


class DocumentListOut(BaseModel):
    items: list[DocumentSummary]


class TopicListOut(BaseModel):
    items: list[TopicOut]


class ReviewDecisionIn(BaseModel):
    decision: str  # "approved" | "rejected" — validated by the router literal
    note: str = ""


class TopicCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2_000)


class SmeDesignationIn(BaseModel):
    user_id: uuid.UUID


class ChatSessionCreateIn(BaseModel):
    scope: str = "personal"  # "personal" | "admin" — validated by the router literal


class ChatMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=8_000)


class ChatSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    scope: str
    title: str
    created_at: datetime


class ChatSessionListOut(BaseModel):
    items: list[ChatSessionOut]


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str
    content: str
    citations: list[Any]
    created_at: datetime


class ChatMessageListOut(BaseModel):
    items: list[ChatMessageOut]


class Citation(BaseModel):
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    snippet: str
    score: float
    page: int | None = None


class AdminOverview(BaseModel):
    users: int
    total_documents: int
    personal_documents: int
    library_documents: int
    pending_reviews: int
    pipeline: dict[str, int]
