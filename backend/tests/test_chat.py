"""Chat SSE tests plus demo PRNG unit tests (contract appendix, hand-followed)."""

import hashlib
import json
import math

from fastapi.testclient import TestClient

from tests.helpers import register, upload, wait_ready


def parse_sse(body: str) -> list[dict]:
    events = []
    for line in body.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: "):]))
    return events


def test_chat_stream_deltas_citations_done(client: TestClient):
    register(client, "chatter@example.com")
    doc = upload(
        client,
        "telework.txt",
        b"Telework policy. Employees may work remotely up to three days per week "
        b"with supervisor approval. Requests go through the portal. " * 10,
        "text/plain",
        title="Telework Policy",
    )
    wait_ready(client, doc["id"])

    session = client.post("/api/chat/sessions", json={"scope": "personal"}).json()
    resp = client.post(
        f"/api/chat/sessions/{session['id']}/messages", json={"content": "telework?"}
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")

    events = parse_sse(resp.text)
    types = [e["type"] for e in events]
    assert types[0] == "delta"
    assert "citations" in types and "done" in types
    assert types[-1] == "done"

    deltas = [e for e in events if e["type"] == "delta"]
    assert all(d["text"] for d in deltas)
    assert "".join(d["text"] for d in deltas).startswith("Demo mode")

    citations_event = next(e for e in events if e["type"] == "citations")
    assert citations_event["citations"], "demo retrieval keeps top-k"
    for citation in citations_event["citations"]:
        assert citation["document_title"]
        assert isinstance(citation["score"], float)
        assert {"chunk_id", "document_id", "snippet"} <= set(citation)

    done = events[-1]
    assert done["message_id"]

    messages = client.get(f"/api/chat/sessions/{session['id']}/messages").json()["items"]
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assistant = messages[1]
    assert assistant["id"] == done["message_id"]
    assert assistant["citations"] == citations_event["citations"]


def test_personal_scope_isolation(client: TestClient):
    register(client, "alice2@example.com", "Alice")
    alice_doc = upload(
        client,
        "alice-notes.txt",
        b"Alice private notes. " * 30,
        "text/plain",
        title="Alice Notes",
    )
    wait_ready(client, alice_doc["id"])

    bob = TestClient(client.app)
    register(bob, "bobchat@example.com")
    bob_doc = upload(
        bob,
        "bob-notes.txt",
        b"Bob private notes. " * 30,
        "text/plain",
        title="Bob Notes",
    )
    wait_ready(bob, bob_doc["id"])

    bob_session = bob.post("/api/chat/sessions", json={"scope": "personal"}).json()
    resp = bob.post(f"/api/chat/sessions/{bob_session['id']}/messages", json={"content": "notes"})
    citations = next(e for e in parse_sse(resp.text) if e["type"] == "citations")["citations"]
    cited_ids = {c["document_id"] for c in citations}
    # Bob's personal scope may cite his own docs only — never Alice's.
    assert alice_doc["id"] not in cited_ids
    assert cited_ids <= {bob_doc["id"]}


def test_admin_scope_requires_admin(client: TestClient):
    register(client, "plain@example.com")
    assert client.post("/api/chat/sessions", json={"scope": "admin"}).status_code == 403
    sessions = client.get("/api/chat/sessions").json()["items"]
    assert sessions == []


def test_session_ownership(client: TestClient):
    register(client, "owner@example.com")
    session = client.post("/api/chat/sessions", json={"scope": "personal"}).json()

    intruder = TestClient(client.app)
    register(intruder, "intruder@example.com")
    assert intruder.get(f"/api/chat/sessions/{session['id']}/messages").status_code == 404
    posted = intruder.post(
        f"/api/chat/sessions/{session['id']}/messages", json={"content": "hi"}
    )
    assert posted.status_code == 404


# --------------------------------------------------------------------------
# Demo embedding PRNG — the appendix, hand-followed as an independent check.
# --------------------------------------------------------------------------

MASK = (1 << 64) - 1


def _hand_followed_vector(text: str) -> list[float]:
    """Independent implementation of docs/CONTRACT.md appendix steps 1-4."""
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    seed0 = int.from_bytes(digest[0:8], "big")
    seed1 = int.from_bytes(digest[8:16], "big")

    states = [seed0, seed1]

    def next_out(gen: int) -> int:
        state = states[gen]
        state ^= state >> 12
        state ^= (state << 25) % (1 << 64)
        state ^= state >> 27
        states[gen] = state
        return (state * 0x2545F4914F6CDD1D) % (1 << 64)

    raw = []
    for i in range(1536):
        gen = 0 if i % 2 == 0 else 1  # even -> generator A (seed0), odd -> B (seed1)
        double = (next_out(gen) >> 11) / (2 ** 53)
        raw.append(double - 0.5)
    norm = math.sqrt(sum(v * v for v in raw))
    return [
        math.copysign(math.floor(abs(v / norm) * 1e7 + 0.5), v / norm) / 1e7 for v in raw
    ]


def test_demo_embedding_matches_hand_followed_appendix():
    from docsage_api.services.embeddings.demo import embed_text

    for text in ("docsage", "How many remote days are allowed per week?", ""):
        assert embed_text(text) == _hand_followed_vector(text)


def test_demo_embedding_deterministic_and_unit_norm():
    from docsage_api.services.embeddings.demo import embed_text

    first = embed_text("determinism check")
    second = embed_text("determinism check")
    assert first == second
    assert first != embed_text("determinism check!")

    norm = math.sqrt(math.fsum(v * v for v in first))
    assert abs(norm - 1.0) < 1e-6


def test_demo_embedding_rounding_is_exact_7_decimals():
    from docsage_api.services.embeddings.demo import embed_text

    vector = embed_text("rounding check")
    assert len(vector) == 1536
    for component in vector:
        scaled = component * 1e7
        assert abs(scaled - round(scaled)) < 1e-6, "components are exact multiples of 1e-7"
        assert len(str(abs(component)).split(".")[-1]) <= 8
