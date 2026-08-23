"""Startup recovery.

A server restart (or dev ``--reload``) kills in-flight ingestion tasks and
leaves documents stranded in transient pipeline states forever — nothing
else moves them. The startup sweep fails documents that have sat in a
transient state past the staleness window, and purges expired session rows
that would otherwise accumulate indefinitely (expiry is otherwise enforced
only at read time).
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from docsage_api.db.models import Document
from docsage_api.db.models import Session as DbSession

STALE_TRANSIENT_AFTER = timedelta(minutes=15)

TRANSIENT_STATUSES = ("queued", "extracting", "enriching", "embedding")

INTERRUPTED_MESSAGE = "interrupted by server restart — re-upload"


def fail_stale_documents(db: Session, now: datetime | None = None) -> int:
    """Mark transient-state documents older than the window as failed."""
    cutoff = (now or datetime.now(UTC)) - STALE_TRANSIENT_AFTER
    return db.execute(
        update(Document)
        .where(Document.status.in_(TRANSIENT_STATUSES), Document.updated_at < cutoff)
        .values(status="failed", status_error=INTERRUPTED_MESSAGE)
    ).rowcount


def purge_expired_sessions(db: Session, now: datetime | None = None) -> int:
    return db.execute(
        delete(DbSession).where(DbSession.expires_at <= (now or datetime.now(UTC)))
    ).rowcount


def recover_on_startup(db: Session) -> tuple[int, int]:
    """Run both sweeps and commit; returns (documents failed, sessions purged)."""
    failed = fail_stale_documents(db)
    purged = purge_expired_sessions(db)
    db.commit()
    return failed, purged
