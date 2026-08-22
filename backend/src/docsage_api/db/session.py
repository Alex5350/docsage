"""Database engine and session management.

Sync SQLAlchemy (psycopg3) is a deliberate choice: the ingestion pipeline runs
in background threads (extract -> enrich -> embed) and sync sessions are simple
to use there without event-loop plumbing, while FastAPI request handling just
yields the session in a dependency. Async would only pay off for high-concurrency
I/O-bound endpoints, which this API does not have.

The engine is created lazily from settings so that tests can point
``DOCSAGE_DATABASE_URL`` at a scratch database before the app is imported.
"""

from collections.abc import Generator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from docsage_api.core.config import get_settings

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        _engine = create_engine(get_settings().database_url, pool_pre_ping=True)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def session_factory() -> sessionmaker[Session]:
    get_engine()
    assert _SessionLocal is not None
    return _SessionLocal


def get_db() -> Generator[Session]:
    db = session_factory()()
    try:
        yield db
    finally:
        db.close()
