"""SME review endpoints: the pending library-document queue and decisions."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from docsage_api.db.models import Approval, Document, User
from docsage_api.db.session import get_db
from docsage_api.dependencies import get_current_user
from docsage_api.routers.documents import sme_topic_ids, summarize
from docsage_api.schemas.shared import DocumentListOut, DocumentSummary, ReviewDecisionIn

router = APIRouter(prefix="/reviews", tags=["reviews"])

DECISIONS = ("approved", "rejected")


@router.get("/pending", response_model=DocumentListOut)
def pending_reviews(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DocumentListOut:
    sme_topics = sme_topic_ids(db, user.id)
    query = (
        select(Document)
        .options(joinedload(Document.topic), joinedload(Document.owner))
        .where(Document.review_status == "pending_sme")
        .order_by(Document.created_at.desc())
    )
    if user.role != "admin":
        if not sme_topics:
            return DocumentListOut(items=[])
        query = query.where(Document.topic_id.in_(sme_topics))

    documents = db.scalars(query).unique().all()
    return DocumentListOut(items=[summarize(db, doc, user, sme_topics) for doc in documents])


@router.post("/{document_id}", response_model=DocumentSummary)
def decide(
    document_id: uuid.UUID,
    payload: ReviewDecisionIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DocumentSummary:
    if payload.decision not in DECISIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="decision must be 'approved' or 'rejected'",
        )
    doc = db.get(Document, document_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    authorized = user.role == "admin" or (
        doc.topic_id is not None and doc.topic_id in sme_topic_ids(db, user.id)
    )
    if not authorized:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an SME of the document's topic or an admin can review it",
        )
    if doc.review_status != "pending_sme":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"document is not awaiting review (review_status={doc.review_status!r})",
        )

    db.add(
        Approval(
            document_id=doc.id,
            reviewer_id=user.id,
            decision=payload.decision,
            note=payload.note.strip(),
        )
    )
    doc.review_status = payload.decision
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return summarize(db, doc, user)
