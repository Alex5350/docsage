"""Shared FastAPI dependencies for authentication and authorization."""

import uuid
from datetime import UTC, datetime

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from docsage_api.db.models import Session as DbSession
from docsage_api.db.models import SmeDesignation, User
from docsage_api.db.session import get_db

SESSION_COOKIE = "docsage_session"


def get_current_user(
    request: Request, db: Session = Depends(get_db)
) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    session_row = db.get(DbSession, token)
    if session_row is None or session_row.expires_at <= datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    user = db.get(User, session_row.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def get_optional_user(
    request: Request, db: Session = Depends(get_db)
) -> User | None:
    """Resolve the user when a valid session cookie is present; None otherwise."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session_row = db.get(DbSession, token)
    if session_row is None or session_row.expires_at <= datetime.now(UTC):
        return None
    return db.get(User, session_row.user_id)


def is_sme_for_topic(db: Session, user_id: uuid.UUID, topic_id: uuid.UUID) -> bool:
    return (
        db.scalar(
            select(SmeDesignation).where(
                SmeDesignation.topic_id == topic_id, SmeDesignation.user_id == user_id
            )
        )
        is not None
    )
