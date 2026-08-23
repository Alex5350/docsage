"""Cookie-session auth: register, login, logout, me — per docs/CONTRACT.md."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from docsage_api.core.config import Settings, get_settings
from docsage_api.core.rate_limit import (
    REGISTER_LIMIT,
    client_ip,
    limiter,
)
from docsage_api.core.security import hash_password, new_session_token, verify_password
from docsage_api.db.models import Session as DbSession
from docsage_api.db.models import User
from docsage_api.db.session import get_db
from docsage_api.dependencies import SESSION_COOKIE, get_current_user
from docsage_api.schemas.auth import LoginIn, RegisterIn, UserOut
from docsage_api.services.recovery import purge_expired_sessions

router = APIRouter(prefix="/auth", tags=["auth"])

SESSION_TTL = timedelta(days=30)


def _set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=settings.env == "production",
        path="/",
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    register_key = f"register:{client_ip(request)}"
    retry_after = limiter.check(register_key, limit=REGISTER_LIMIT)
    if retry_after:
        wait = int(retry_after) + 1
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"too many registrations from this client; retry in {wait}s",
            headers={"Retry-After": str(wait)},
        )

    email = payload.email.lower()
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
        role="user",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Opportunistic purge: expiry is otherwise enforced only at read time.
    purge_expired_sessions(db)
    token = new_session_token()
    db.add(
        DbSession(
            token=token,
            user_id=user.id,
            expires_at=datetime.now(UTC) + SESSION_TTL,
        )
    )
    db.commit()
    _set_session_cookie(response, token, settings)
    return user


@router.post("/login", response_model=UserOut)
def login(
    payload: LoginIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    key = f"login:{client_ip(request)}:{payload.email.lower()}"
    retry_after = limiter.check(key)
    if retry_after:
        wait = int(retry_after) + 1
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"too many failed attempts; retry in {wait}s",
            headers={"Retry-After": str(wait)},
        )
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    limiter.clear(key)

    # Opportunistic purge: expiry is otherwise enforced only at read time.
    purge_expired_sessions(db)
    token = new_session_token()
    db.add(
        DbSession(
            token=token,
            user_id=user.id,
            expires_at=datetime.now(UTC) + SESSION_TTL,
        )
    )
    db.commit()
    _set_session_cookie(response, token, settings)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    db: Session = Depends(get_db),
    token: str | None = Cookie(default=None, include_in_schema=False),
) -> None:
    if token is not None:
        session_row = db.get(DbSession, token)
        if session_row is not None:
            db.delete(session_row)
            db.commit()
    response.delete_cookie(key=SESSION_COOKIE, path="/")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user
