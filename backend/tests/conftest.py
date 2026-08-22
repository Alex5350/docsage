"""Integration test fixtures against the dockerized pgvector instance.

The suite runs real HTTP requests through TestClient against a scratch
``docsage_test`` database on the compose db (port 5433). The environment is
pointed at that database BEFORE any docsage_api import so the lazily-created
engine and the cached Settings both pick it up.
"""

import os
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from alembic import command

ADMIN_URL = "postgresql://docsage:docsage@localhost:5433/docsage"
TEST_DATABASE_URL = "postgresql+psycopg://docsage:docsage@localhost:5433/docsage_test"

os.environ["DOCSAGE_DATABASE_URL"] = TEST_DATABASE_URL

# Tables listed children-first so a single TRUNCATE respects FK dependency order.
TABLES = (
    "chat_messages",
    "chat_sessions",
    "approvals",
    "enrichments",
    "chunks",
    "documents",
    "sme_designations",
    "topics",
    "sessions",
    "users",
)

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _admin_connect() -> psycopg.Connection:
    try:
        return psycopg.connect(ADMIN_URL, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError as exc:
        pytest.skip(
            f"dockerized pgvector unreachable at {ADMIN_URL} "
            f"(run `docker compose up db`): {exc}"
        )


@pytest.fixture(scope="session")
def db_engine():
    admin = _admin_connect()
    try:
        admin.execute("DROP DATABASE IF EXISTS docsage_test WITH (FORCE)")
        admin.execute("CREATE DATABASE docsage_test")
    finally:
        admin.close()

    # Run the real migrations (not create_all) so schema drift is caught here.
    alembic_cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    command.upgrade(alembic_cfg, "head")

    engine = create_engine(TEST_DATABASE_URL)
    yield engine
    engine.dispose()

    admin = _admin_connect()
    try:
        admin.execute("DROP DATABASE IF EXISTS docsage_test WITH (FORCE)")
    finally:
        admin.close()


@pytest.fixture(autouse=True)
def clean_db(db_engine):
    with db_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))


@pytest.fixture
def client(db_engine) -> Iterator[TestClient]:
    from docsage_api.main import app

    with TestClient(app) as c:
        yield c
