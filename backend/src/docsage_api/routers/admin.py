"""Admin overview statistics."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from docsage_api.db.models import Document, User
from docsage_api.db.session import get_db
from docsage_api.dependencies import require_admin
from docsage_api.schemas.shared import AdminOverview

router = APIRouter(prefix="/admin", tags=["admin"])

PIPELINE_STATUSES = ("queued", "extracting", "enriching", "embedding", "ready", "failed")


@router.get("/overview", response_model=AdminOverview)
def overview(db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> AdminOverview:
    users = db.scalar(select(func.count()).select_from(User)) or 0
    total = db.scalar(select(func.count()).select_from(Document)) or 0
    personal = db.scalar(
        select(func.count()).select_from(Document).where(Document.scope == "personal")
    ) or 0
    library = db.scalar(
        select(func.count()).select_from(Document).where(Document.scope == "library")
    ) or 0
    pending = db.scalar(
        select(func.count())
        .select_from(Document)
        .where(Document.review_status == "pending_sme")
    ) or 0
    by_status = dict(
        db.execute(select(Document.status, func.count()).group_by(Document.status)).all()
    )
    pipeline = {s: int(by_status.get(s, 0)) for s in PIPELINE_STATUSES}
    return AdminOverview(
        users=users,
        total_documents=total,
        personal_documents=personal,
        library_documents=library,
        pending_reviews=pending,
        pipeline=pipeline,
    )
