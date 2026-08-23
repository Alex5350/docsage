"""Shared helpers for the integration tests (users, uploads, polling)."""

import time
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import Engine

from docsage_api.core.security import hash_password

PASSWORD = "test-pass-123"


def register(client: TestClient, email: str, name: str | None = None) -> dict:
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": PASSWORD, "display_name": name or email.split("@")[0]},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def create_admin(
    engine: Engine, email: str = "root@example.com", name: str = "Root Admin"
) -> uuid.UUID:
    """Insert an admin directly (registration only creates regular users)."""
    user_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, email, password_hash, display_name, role) "
                "VALUES (:id, :email, :hash, :name, 'admin')"
            ),
            {"id": str(user_id), "email": email, "hash": hash_password(PASSWORD), "name": name},
        )
    return user_id


def login(client: TestClient, email: str) -> dict:
    resp = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    return resp.json()


def upload(client: TestClient, filename: str, content: bytes, mime: str, **fields) -> dict:
    data = {"provider": fields.pop("provider", "demo"), "scope": fields.pop("scope", "personal")}
    if "title" in fields:
        data["title"] = fields.pop("title")
    if "topic_id" in fields and fields["topic_id"] is not None:
        data["topic_id"] = str(fields.pop("topic_id"))
    resp = client.post(
        "/api/documents",
        data=data,
        files={"file": (filename, content, mime)},
    )
    assert resp.status_code == 202, resp.text
    return resp.json()


def wait_ready(client: TestClient, document_id: str, timeout_s: float = 30.0) -> dict:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        resp = client.get(f"/api/documents/{document_id}")
        assert resp.status_code == 200, resp.text
        doc = resp.json()
        if doc["status"] in ("ready", "failed"):
            assert doc["status"] == "ready", f"pipeline failed: {doc.get('status_error')}"
            return doc
        time.sleep(0.15)
    raise TimeoutError(f"document {document_id} not ready within {timeout_s}s")


def _as_vector(value: object) -> list[float]:
    """pgvector comes back as its text format '[a,b,...]' through raw SQL."""
    if isinstance(value, (list, tuple)):
        return list(value)
    return [float(component) for component in str(value).strip("[]").split(",")]


def chunks_of(engine: Engine, document_id: str) -> list[dict]:
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                "SELECT ordinal, kind, page, token_count, embedding FROM chunks "
                "WHERE document_id = :id ORDER BY ordinal"
            ),
            {"id": document_id},
        ).mappings()
        return [
            {
                "ordinal": r["ordinal"],
                "kind": r["kind"],
                "page": r["page"],
                "token_count": r["token_count"],
                "embedding": _as_vector(r["embedding"]),
            }
            for r in rows
        ]
