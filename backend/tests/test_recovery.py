"""Startup recovery: stale transient documents fail, fresh ones survive,
expired sessions purge (startup sweep and opportunistic login purge)."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session as OrmSession
from sqlalchemy.orm import sessionmaker

from docsage_api.core.security import new_session_token
from docsage_api.db.models import Document, User
from docsage_api.db.models import Session as DbSession
from docsage_api.services.recovery import recover_on_startup


def _db(db_engine) -> OrmSession:
    return sessionmaker(bind=db_engine)()


def _register_user(client) -> str:
    email = f"recovery-{uuid.uuid4().hex[:10]}@docsage.dev"
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "docsage-demo", "display_name": "Recovery Tester"},
    )
    assert response.status_code == 201
    return email


def _make_document(db, user_id, status, updated_at, title):
    doc = Document(
        owner_id=user_id,
        scope="personal",
        title=title,
        source_filename=f"{title}.txt",
        mime_type="text/plain",
        storage_path=f"var/uploads/x/{title}.txt",
        size_bytes=10,
        checksum_sha256="0" * 64,
        status=status,
        embedding_provider="demo",
        embedding_model="demo-v1",
        updated_at=updated_at,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def test_stale_transient_documents_fail_but_fresh_ones_survive(client, db_engine):
    email = _register_user(client)
    with _db(db_engine) as db:
        user = db.query(User).filter(User.email == email).one()
        now = datetime.now(UTC)

        stale = _make_document(db, user.id, "extracting", now - timedelta(minutes=30), "stale-doc")
        fresh = _make_document(db, user.id, "enriching", now - timedelta(minutes=2), "fresh-doc")
        ready = _make_document(db, user.id, "ready", now - timedelta(hours=3), "ready-doc")

        failed, _ = recover_on_startup(db)

        assert failed == 1
        db.refresh(stale)
        db.refresh(fresh)
        db.refresh(ready)
        assert stale.status == "failed"
        assert stale.status_error == "interrupted by server restart — re-upload"
        assert fresh.status == "enriching"  # still actively processing — untouched
        assert ready.status == "ready"  # terminal states are never touched


def test_expired_sessions_purge_on_startup(client, db_engine):
    email = _register_user(client)
    with _db(db_engine) as db:
        user = db.query(User).filter(User.email == email).one()
        now = datetime.now(UTC)
        db.add_all(
            [
                DbSession(
                    token=new_session_token(), user_id=user.id, expires_at=now - timedelta(days=1)
                ),
                DbSession(
                    token=new_session_token(),
                    user_id=user.id,
                    expires_at=now - timedelta(seconds=5),
                ),
                DbSession(
                    token=new_session_token(), user_id=user.id, expires_at=now + timedelta(days=30)
                ),
            ]
        )
        db.commit()

        before = db.query(DbSession).filter(DbSession.user_id == user.id).count()
        _, purged = recover_on_startup(db)

        assert purged == 2  # registration's own session is still live, hence 'before'
        after = db.query(DbSession).filter(DbSession.user_id == user.id).count()
        assert after == before - 2
        assert all(
            row.expires_at > now
            for row in db.query(DbSession).filter(DbSession.user_id == user.id).all()
        )


def test_login_purges_expired_sessions(client, db_engine):
    email = _register_user(client)
    with _db(db_engine) as db:
        user = db.query(User).filter(User.email == email).one()
        user_id = user.id
        db.add(
            DbSession(
                token=new_session_token(),
                user_id=user.id,
                expires_at=datetime.now(UTC) - timedelta(minutes=1),
            )
        )
        db.commit()

    response = client.post("/api/auth/login", json={"email": email, "password": "docsage-demo"})
    assert response.status_code == 200

    with _db(db_engine) as db:
        sessions = db.query(DbSession).filter(DbSession.user_id == user_id).all()
        assert sessions, "login created a fresh session"
        assert all(s.expires_at > datetime.now(UTC) for s in sessions)
