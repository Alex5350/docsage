"""Access control and SME review workflow tests."""

import uuid

from fastapi.testclient import TestClient

from tests.helpers import create_admin, login, register, upload, wait_ready

PASSWORD = "test-pass-123"


def _user_client(app, email: str) -> TestClient:
    fresh = TestClient(app)
    resp = fresh.post(
        "/api/auth/register",
        json={"email": email, "password": PASSWORD, "display_name": email.split("@")[0].title()},
    )
    assert resp.status_code == 201, resp.text
    return fresh


def _admin_client(app, db_engine) -> TestClient:
    create_admin(db_engine, email="chief@example.com")
    fresh = TestClient(app)
    login(fresh, "chief@example.com")
    return fresh


def _topic(client: TestClient, name: str = "Workplace Policy") -> dict:
    resp = client.post("/api/topics", json={"name": name, "description": f"{name} docs"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_personal_document_invisible_to_others(client: TestClient):
    register(client, "alice@example.com", "Alice")
    doc = upload(
        client,
        "diary.txt",
        b"Private working notes. " * 20,
        "text/plain",
        title="Alice Diary",
    )
    wait_ready(client, doc["id"])

    other = _user_client(client.app, "bob@example.com")
    listing = other.get("/api/documents?scope=personal").json()["items"]
    assert all(item["id"] != doc["id"] for item in listing)
    assert other.get(f"/api/documents/{doc['id']}").status_code == 404

    mine = client.get("/api/documents?scope=personal").json()["items"]
    assert any(item["id"] == doc["id"] for item in mine)


def test_library_review_flow(client: TestClient, db_engine):
    admin = _admin_client(client.app, db_engine)
    topic = _topic(admin)
    sme_designation = admin.post(
        f"/api/topics/{topic['id']}/smes", json={"user_id": None}  # filled after registration
    )
    assert sme_designation.status_code == 422  # user_id must be a uuid

    morgan = _user_client(client.app, "morgan@example.com")
    riley = _user_client(client.app, "riley@example.com")
    morgan_id = morgan.get("/api/auth/me").json()["id"]
    added = admin.post(f"/api/topics/{topic['id']}/smes", json={"user_id": morgan_id})
    assert added.status_code == 201
    assert added.json()["email"] == "morgan@example.com"

    approve_me = upload(
        admin,
        "approve-me.txt",
        b"Policy one. Remote work is capped at three days per week. " * 15,
        "text/plain",
        scope="library",
        title="Approve Me Policy",
        topic_id=topic["id"],
    )
    reject_me = upload(
        admin,
        "reject-me.txt",
        b"Policy two. Superseded content pending removal. " * 15,
        "text/plain",
        scope="library",
        title="Reject Me Policy",
        topic_id=topic["id"],
    )
    assert wait_ready(admin, approve_me["id"])["review_status"] == "pending_sme"
    assert wait_ready(admin, reject_me["id"])["review_status"] == "pending_sme"

    # Regular users cannot see unapproved library documents (list or detail).
    assert all(
        item["id"] != approve_me["id"]
        for item in riley.get("/api/documents?scope=library").json()["items"]
    )
    assert riley.get(f"/api/documents/{approve_me['id']}").status_code == 404

    # SMEs see pending documents and are flagged as eligible reviewers.
    morgan_library = morgan.get("/api/documents?scope=library").json()["items"]
    pending = {item["id"]: item for item in morgan_library if item["id"] == approve_me["id"]}
    assert pending[approve_me["id"]]["pending_reviewer"] is True

    # Non-SME review attempts are forbidden.
    denied = riley.post(
        f"/api/reviews/{approve_me['id']}", json={"decision": "approved", "note": "nope"}
    )
    assert denied.status_code == 403

    # SME queue lists pending documents; the regular user's queue is empty.
    morgan_queue = morgan.get("/api/reviews/pending").json()["items"]
    assert {item["id"] for item in morgan_queue} == {approve_me["id"], reject_me["id"]}
    assert riley.get("/api/reviews/pending").json()["items"] == []

    approved = morgan.post(
        f"/api/reviews/{approve_me['id']}",
        json={"decision": "approved", "note": "Confirmed current as of October release"},
    )
    assert approved.status_code == 200
    assert approved.json()["review_status"] == "approved"

    riley_library = riley.get("/api/documents?scope=library").json()["items"]
    assert any(item["id"] == approve_me["id"] for item in riley_library)
    detail = riley.get(f"/api/documents/{approve_me['id']}").json()
    assert detail["approvals"][0]["decision"] == "approved"
    assert "October" in detail["approvals"][0]["note"]

    rejected = morgan.post(
        f"/api/reviews/{reject_me['id']}", json={"decision": "rejected", "note": "superseded"}
    )
    assert rejected.status_code == 200
    assert all(
        item["id"] != reject_me["id"]
        for item in riley.get("/api/documents?scope=library").json()["items"]
    )
    # Rejected documents remain visible to admins (fix-and-resubmit workflow).
    admin_library = admin.get("/api/documents?scope=library").json()["items"]
    assert {item["id"] for item in admin_library} >= {approve_me["id"], reject_me["id"]}

    # Already-decided documents cannot be reviewed again.
    redecide = morgan.post(f"/api/reviews/{approve_me['id']}", json={"decision": "rejected"})
    assert redecide.status_code == 409


def test_topics_are_admin_managed(client: TestClient, db_engine):
    admin = _admin_client(client.app, db_engine)
    regular = _user_client(client.app, "peon@example.com")

    assert regular.post("/api/topics", json={"name": "Nope"}).status_code == 403
    created = admin.post("/api/topics", json={"name": "Security", "description": "sec docs"})
    assert created.status_code == 201
    assert created.json()["smes"] == []
    duplicate = admin.post("/api/topics", json={"name": "Security"})
    assert duplicate.status_code == 409

    listed = regular.get("/api/topics").json()["items"]
    assert any(t["name"] == "Security" for t in listed)

    random_user_id = str(uuid.uuid4())
    missing_sme = admin.post(
        f"/api/topics/{created.json()['id']}/smes", json={"user_id": random_user_id}
    )
    assert missing_sme.status_code == 404


def test_library_upload_requires_admin_and_topic(client: TestClient, db_engine):
    admin = _admin_client(client.app, db_engine)
    regular = _user_client(client.app, "peon2@example.com")

    topic = _topic(admin)
    forbidden = regular.post(
        "/api/documents",
        data={"provider": "demo", "scope": "library", "topic_id": topic["id"]},
        files={"file": ("a.txt", b"content", "text/plain")},
    )
    assert forbidden.status_code == 403

    missing_topic = admin.post(
        "/api/documents",
        data={"provider": "demo", "scope": "library"},
        files={"file": ("a.txt", b"content", "text/plain")},
    )
    assert missing_topic.status_code == 422

    unknown_topic = admin.post(
        "/api/documents",
        data={"provider": "demo", "scope": "library", "topic_id": str(uuid.uuid4())},
        files={"file": ("a.txt", b"content", "text/plain")},
    )
    assert unknown_topic.status_code == 404
