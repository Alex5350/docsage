"""Ingestion pipeline tests: real background run against Postgres (demo provider)."""

import math

from fastapi.testclient import TestClient

from tests.helpers import chunks_of, register, upload, wait_ready

TXT = (
    "Quarterly operations summary. The platform team completed the migration "
    "with zero downtime incidents. Ticket volume dropped eighteen percent after "
    "the self-service portal launch. Leadership asked for a follow-up review of "
    "on-call rotation coverage before the next quarter begins."
)


def test_txt_ingestion_ready_with_normalized_vectors(client: TestClient, db_engine):
    register(client, "ingest@example.com")
    doc = upload(client, "ops-summary.txt", TXT.encode(), "text/plain", title="Ops Summary")
    assert doc["status"] in ("queued", "extracting", "enriching", "embedding")
    assert doc["embedding_provider"] == "demo"
    assert doc["embedding_model"] == "demo-v1"
    assert doc["review_status"] == "not_required"

    ready = wait_ready(client, doc["id"])
    assert ready["chunk_count"] >= 1
    assert ready["topic"] is None

    rows = chunks_of(db_engine, doc["id"])
    assert len(rows) == ready["chunk_count"]
    for row in rows:
        assert row["kind"] == "text"
        assert row["token_count"] > 0
        vector = row["embedding"]
        assert len(vector) == 1536
        norm = math.sqrt(math.fsum(v * v for v in vector))
        assert abs(norm - 1.0) < 1e-5, f"demo vectors must be unit length, got {norm}"

    detail = client.get(f"/api/documents/{doc['id']}").json()
    kinds = {e["kind"] for e in detail["enrichments"]}
    assert {"summary", "keywords", "questions"} <= kinds
    summary = next(e["content"] for e in detail["enrichments"] if e["kind"] == "summary")
    assert summary.startswith("Quarterly operations summary.")


def test_unsupported_mime_rejected(client: TestClient):
    register(client, "mime@example.com")
    resp = client.post(
        "/api/documents",
        data={"provider": "demo", "scope": "personal"},
        files={"file": ("malware.exe", b"MZ...", "application/x-msdownload")},
    )
    assert resp.status_code in (400, 422)
    assert "unsupported" in resp.json()["detail"].lower()


def test_openai_provider_without_key_suggests_demo(client: TestClient):
    register(client, "nokey@example.com")
    resp = client.post(
        "/api/documents",
        data={"provider": "openai", "scope": "personal"},
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert resp.status_code == 400
    assert "demo" in resp.json()["detail"].lower()


def test_unknown_provider_rejected(client: TestClient):
    register(client, "badprov@example.com")
    resp = client.post(
        "/api/documents",
        data={"provider": "voyageai", "scope": "personal"},
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert resp.status_code == 422
