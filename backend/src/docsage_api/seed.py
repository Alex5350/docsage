"""Demo data seeder: `uv run python -m docsage_api.seed --fresh` (backend dir).

Wipes the data tables, creates the demo users/topics/SME designations, pushes
every seed-corpus file through the REAL ingestion pipeline with provider
'demo', waits for ready, records the SME approvals, and leaves riley with one
seeded chat exchange produced by the real demo answer path.
"""

import argparse
import mimetypes
import sys
import time
import uuid
from pathlib import Path

from sqlalchemy import text

from docsage_api.core.config import get_settings
from docsage_api.core.security import hash_password
from docsage_api.db.models import (
    Approval,
    ChatMessage,
    ChatSession,
    Document,
    SmeDesignation,
    Topic,
    User,
)
from docsage_api.db.session import session_factory
from docsage_api.services import storage
from docsage_api.services.answer import AnswerService
from docsage_api.services.ingestion import run_ingestion
from docsage_api.services.retrieval import retrieve

SEED_CORPUS = Path(__file__).resolve().parents[3] / "db" / "seed-corpus"
DEMO_PASSWORD = "docsage-demo"

# Children-first so a single TRUNCATE respects FK dependency order.
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

USERS = [
    ("admin@docsage.dev", "Alex Admin", "admin"),
    ("riley@docsage.dev", "Riley Regular", "user"),
    ("morgan@docsage.dev", "Morgan SME", "user"),
    ("casey@docsage.dev", "Casey SME", "user"),
]

TOPICS = [
    ("Workplace Policy", "Telework, conduct, and day-to-day agency policy.", "morgan@docsage.dev"),
    ("Security", "Information system security and incident response.", "casey@docsage.dev"),
    ("Budget & Finance", "IT budget planning and procurement.", "morgan@docsage.dev"),
    ("Records Management", "Retention schedules and records handling.", "casey@docsage.dev"),
]

LIBRARY_UPLOADS = [
    ("telework-policy.docx", "Workplace Policy", "Telework and Remote Access Policy",
     "Confirmed current as of October release"),
    ("security-handbook.docx", "Security", "Information System Security Handbook",
     "Confirmed current as of October release"),
    ("fy2027-it-budget.xlsx", "Budget & Finance", "FY2027 IT Budget",
     "Reviewed against the October CFO workbook"),
    ("records-retention-schedule.pdf", "Records Management", "Records Retention Schedule",
     "Verified schedule matches the NARA supplement"),
]

PERSONAL_UPLOADS = [
    ("riley@docsage.dev", "migration-notes.md", "Platform Migration Notes — Sprint 12"),
    ("riley@docsage.dev", "ticket-volume-chart.png", "Ticket Volume Chart"),
    ("casey@docsage.dev", "facilities-call-notes.txt", "Facilities Coordination Call Notes"),
    ("casey@docsage.dev", "equipment-inventory.csv", "Equipment Inventory"),
]

SEEDED_QUESTION = "How many remote days are allowed per week?"


def _upload(
    db, owner: User, filename: str, *, scope: str, title: str, topic: Topic | None
) -> Document:
    """Store the file and run the real ingestion pipeline synchronously."""
    data = (SEED_CORPUS / filename).read_bytes()
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    document_id = uuid.uuid4()
    document = Document(
        id=document_id,
        owner_id=owner.id,
        scope=scope,
        title=title,
        source_filename=filename,
        mime_type=mime,
        storage_path="",
        size_bytes=len(data),
        checksum_sha256=storage.checksum_sha256(data),
        embedding_provider="demo",
        embedding_model="demo-v1",
        topic_id=topic.id if topic else None,
    )
    document.storage_path = str(storage.save_upload(document_id, filename, data))
    db.add(document)
    db.commit()
    run_ingestion(document_id)
    return document


def _wait_ready(db, document: Document, timeout_s: float = 60.0) -> Document:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        db.expire_all()
        row = db.get(Document, document.id)
        if row is None or row.status in ("ready", "failed"):
            return row
        time.sleep(0.2)
    raise TimeoutError(f"document {document.id} did not finish within {timeout_s}s")


def main(fresh: bool) -> int:
    if not fresh:
        print("refusing to run without --fresh (it resets all data tables)")
        return 2
    if not SEED_CORPUS.is_dir():
        print(f"seed corpus missing: {SEED_CORPUS}")
        return 1

    settings = get_settings()
    db = session_factory()()
    try:
        db.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))
        db.commit()
        print(f"truncated {len(TABLES)} tables")

        password_hash = hash_password(DEMO_PASSWORD)
        users: dict[str, User] = {}
        for email, display_name, role in USERS:
            user = User(
                email=email,
                password_hash=password_hash,
                display_name=display_name,
                role=role,
            )
            db.add(user)
            users[email] = user
        db.commit()

        admin = users["admin@docsage.dev"]
        topics: dict[str, Topic] = {}
        for name, description, _sme in TOPICS:
            topic = Topic(name=name, description=description, created_by=admin.id)
            db.add(topic)
            topics[name] = topic
        db.commit()
        for name, _, sme_email in TOPICS:
            db.add(
                SmeDesignation(
                    topic_id=topics[name].id, user_id=users[sme_email].id, designated_by=admin.id
                )
            )
        db.commit()
        print(f"created {len(users)} users, {len(topics)} topics with SME designations")

        documents: list[Document] = []
        for filename, topic_name, title, _note in LIBRARY_UPLOADS:
            doc = _upload(
                db, admin, filename, scope="library", title=title, topic=topics[topic_name]
            )
            documents.append(_wait_ready(db, doc))
        for owner_email, filename, title in PERSONAL_UPLOADS:
            doc = _upload(
                db, users[owner_email], filename, scope="personal", title=title, topic=None
            )
            documents.append(_wait_ready(db, doc))
        failed = [d for d in documents if d.status != "ready"]
        for doc in failed:
            print(f"FAILED: {doc.title}: {doc.status_error}")
        if failed:
            return 1
        print(f"ingested {len(documents)} documents through the real pipeline (provider=demo)")

        for filename, topic_name, _title, note in LIBRARY_UPLOADS:
            doc = next(d for d in documents if d.source_filename == filename)
            sme_email = next(s for n, _, s in TOPICS if n == topic_name)
            db.add(
                Approval(
                    document_id=doc.id,
                    reviewer_id=users[sme_email].id,
                    decision="approved",
                    note=note,
                )
            )
            doc.review_status = "approved"
            db.add(doc)
        db.commit()
        print("SMEs approved the four library documents")

        # Seeded chat exchange: real retrieval + real demo answer path, persisted.
        riley = users["riley@docsage.dev"]
        chat_session = ChatSession(user_id=riley.id, scope="personal", title="Telework question")
        db.add(chat_session)
        db.flush()  # chat_session.id is generated at flush, not at construction
        db.add(ChatMessage(session_id=chat_session.id, role="user", content=SEEDED_QUESTION))
        db.commit()

        retrieved = retrieve(db, riley, "personal", SEEDED_QUESTION, settings=settings)
        assistant_id = uuid.uuid4()
        answer_service = AnswerService(settings)
        text_parts: list[str] = []
        citations: list[dict] = []
        events = answer_service.stream(SEEDED_QUESTION, retrieved, message_id=str(assistant_id))
        for event in events:
            if event["type"] == "delta":
                text_parts.append(event["text"])
            elif event["type"] == "citations":
                citations = event["citations"]
        db.add(
            ChatMessage(
                id=assistant_id,
                session_id=chat_session.id,
                role="assistant",
                content="".join(text_parts),
                citations=citations,
            )
        )
        db.commit()

        print()
        print("Seed summary")
        print("=" * 78)
        for _email, display_name, role in USERS:
            print(f"user  {display_name:<18} {role}")
        print()
        for name, _description, sme_email in TOPICS:
            count = len([d for d in documents if d.topic_id == topics[name].id])
            print(f"topic {name:<24} SME {users[sme_email].display_name:<14} docs {count}")
        print()
        for doc in sorted(documents, key=lambda d: (d.scope, d.title)):
            review = doc.review_status if doc.scope == "library" else "-"
            print(
                f"doc   {doc.title[:40]:<42} {doc.scope:<9} {doc.status:<7} "
                f"{review:<9} chunks {doc.chunk_count}"
            )
        print()
        cited_titles = [c["document_title"] for c in citations]
        print(f"chat  session {chat_session.id} (riley, personal)")
        print(f"      user:      {SEEDED_QUESTION}")
        print(f"      assistant: {''.join(text_parts)[:96]}…")
        print(f"      citations: {len(citations)} -> {', '.join(cited_titles) or 'none'}")
        print("=" * 78)
        print("demo login:", " | ".join(u[0] for u in USERS), "/", DEMO_PASSWORD)
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed DocSage demo data through the real pipeline")
    parser.add_argument("--fresh", action="store_true", help="truncate data tables before seeding")
    args = parser.parse_args()
    sys.exit(main(fresh=args.fresh))
