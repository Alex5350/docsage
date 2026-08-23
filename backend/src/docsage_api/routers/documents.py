"""Document endpoints: upload (multipart), list, detail, delete — per docs/CONTRACT.md."""

import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from docsage_api.core.config import Settings, get_settings
from docsage_api.db.models import Approval, Document, Enrichment, SmeDesignation, Topic, User
from docsage_api.db.session import get_db
from docsage_api.dependencies import get_current_user
from docsage_api.schemas.shared import (
    ApprovalOut,
    DocumentDetail,
    DocumentListOut,
    DocumentSummary,
    EnrichmentOut,
)
from docsage_api.services import storage
from docsage_api.services.embeddings.base import PROVIDER_NAMES, get_provider, provider_available
from docsage_api.services.extraction.base import ALLOWED_MIME_TYPES, verify_magic_bytes
from docsage_api.services.ingestion import run_ingestion

router = APIRouter(prefix="/documents", tags=["documents"])

MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def sme_topic_ids(db: Session, user_id: uuid.UUID) -> set[uuid.UUID]:
    return set(
        db.scalars(select(SmeDesignation.topic_id).where(SmeDesignation.user_id == user_id))
    )


def pending_reviewer(db: Session, user: User, doc: Document, sme_topics: set[uuid.UUID]) -> bool:
    """True when ``user`` is an eligible reviewer for this pending library document."""
    return doc.review_status == "pending_sme" and (
        user.role == "admin" or doc.topic_id in sme_topics
    )


def summarize(
    db: Session, doc: Document, user: User, sme_topics: set[uuid.UUID] | None = None
) -> DocumentSummary:
    summary = DocumentSummary.model_validate(doc)
    summary.pending_reviewer = pending_reviewer(db, user, doc, sme_topics or set())
    return summary


def can_view_document(db: Session, user: User, doc: Document, sme_topics: set[uuid.UUID]) -> bool:
    if doc.owner_id == user.id or user.role == "admin":
        return True
    if doc.scope != "library":
        return False
    if doc.review_status == "approved":
        return True
    return doc.topic_id is not None and doc.topic_id in sme_topics


@router.post("", response_model=DocumentSummary, status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    provider: str = Form(...),
    scope: str = Form("personal"),
    title: str | None = Form(None),
    topic_id: uuid.UUID | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> DocumentSummary:
    if provider not in PROVIDER_NAMES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"provider must be one of {list(PROVIDER_NAMES)}",
        )
    if scope not in ("personal", "library"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="scope must be 'personal' or 'library'",
        )
    if scope == "library" and user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Library ingestion is restricted to admins",
        )
    if scope == "library" and topic_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="topic_id is required for library documents",
        )
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"unsupported file type {file.content_type!r}; "
                f"allowed: {sorted(ALLOWED_MIME_TYPES)}"
            ),
        )
    if not provider_available(provider, settings):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"embedding provider '{provider}' is unavailable (no API key configured "
                "or demo mode is on); use provider='demo' instead"
            ),
        )

    topic: Topic | None = None
    if topic_id is not None:
        topic = db.get(Topic, topic_id)
        if topic is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found")

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="file exceeds the 25MB upload limit",
        )
    mismatch = verify_magic_bytes(file.content_type, data)
    if mismatch is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{mismatch} (declared {file.content_type!r})",
        )
    if not data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="file is empty"
        )

    filename = file.filename or "upload"
    document_id = uuid.uuid4()  # needed before the row exists to place the file
    document = Document(
        id=document_id,
        owner_id=user.id,
        scope=scope,
        title=(title or storage_safe_stem(filename)).strip() or filename,
        source_filename=filename,
        mime_type=file.content_type,
        storage_path="",  # set below once the file is on disk
        size_bytes=len(data),
        checksum_sha256=storage.checksum_sha256(data),
        embedding_provider=provider,
        embedding_model=get_provider(provider, settings).model_id,
        topic_id=topic_id,
    )
    document.storage_path = str(storage.save_upload(document_id, filename, data))
    db.add(document)
    db.commit()
    db.refresh(document)

    background_tasks.add_task(run_ingestion, document.id)
    return summarize(db, document, user)


def storage_safe_stem(filename: str) -> str:
    stem = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    stem = stem.rsplit(".", 1)[0]
    return stem.replace("_", " ").replace("-", " ").strip().title() or filename


@router.get("", response_model=DocumentListOut)
def list_documents(
    scope: str = "personal",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DocumentListOut:
    if scope not in ("personal", "library"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="scope must be 'personal' or 'library'",
        )
    sme_topics = sme_topic_ids(db, user.id)
    query = (
        select(Document)
        .options(joinedload(Document.topic), joinedload(Document.owner))
        .order_by(Document.created_at.desc())
    )
    if scope == "personal":
        query = query.where(Document.owner_id == user.id)
    elif user.role != "admin":
        visible = (
            (Document.review_status == "approved")
            | ((Document.topic_id.is_not(None)) & (Document.topic_id.in_(sme_topics)))
        )
        query = query.where(Document.scope == "library", visible)

    documents = db.scalars(query).unique().all()
    return DocumentListOut(
        items=[summarize(db, doc, user, sme_topics) for doc in documents]
    )


@router.get("/{document_id}", response_model=DocumentDetail)
def document_detail(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DocumentDetail:
    doc = db.get(Document, document_id)
    sme_topics = sme_topic_ids(db, user.id)
    if doc is None or not can_view_document(db, user, doc, sme_topics):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    summary = summarize(db, doc, user, sme_topics)
    enrichments = [
        EnrichmentOut.model_validate(row)
        for row in db.scalars(
            select(Enrichment).where(Enrichment.document_id == document_id)
        )
    ]
    approvals = [
        ApprovalOut(
            reviewer=reviewer_name,
            decision=row.decision,
            note=row.note,
            decided_at=row.decided_at,
        )
        for row, reviewer_name in db.execute(
            select(Approval, User.display_name)
            .join(User, User.id == Approval.reviewer_id)
            .where(Approval.document_id == document_id)
            .order_by(Approval.decided_at)
        )
    ]
    return DocumentDetail(
        **summary.model_dump(),
        enrichments=enrichments,
        approvals=approvals,
    )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    doc = db.get(Document, document_id)
    sme_topics = sme_topic_ids(db, user.id)
    if doc is None or not can_view_document(db, user, doc, sme_topics):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if doc.owner_id != user.id and user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the owner or an admin can delete a document",
        )
    storage.delete_upload(doc.id)
    db.delete(doc)
    db.commit()
