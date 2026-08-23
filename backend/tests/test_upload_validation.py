"""Server-side upload validation: the declared mime must be in the allowlist
AND the bytes must match the family (magic bytes for binaries, UTF-8 for
text). A renamed zip must never persist as a PDF."""

from pathlib import Path

from tests.helpers import register

SEED_CORPUS = Path(__file__).resolve().parents[2] / "db" / "seed-corpus"


def _upload(client, *, filename: str, content_type: str, data: bytes):
    return client.post(
        "/api/documents",
        data={"provider": "demo", "scope": "personal", "title": "validation probe"},
        files={"file": (filename, data, content_type)},
    )


def test_renamed_zip_declared_as_pdf_is_rejected(client):
    register(client, f"magic-{__import__('uuid').uuid4().hex[:8]}@docsage.dev")
    zip_bytes = b"PK\x03\x04" + b"\x00" * 64  # minimal zip local-file header
    response = _upload(
        client, filename="evil.pdf", content_type="application/pdf", data=zip_bytes
    )
    assert response.status_code == 422
    assert "not a PDF" in response.json()["detail"]


def test_text_bytes_declared_as_png_are_rejected(client):
    register(client, f"magic-{__import__('uuid').uuid4().hex[:8]}@docsage.dev")
    response = _upload(
        client, filename="notes.png", content_type="image/png", data=b"just plain text, not pixels"
    )
    assert response.status_code == 422
    assert "not a PNG" in response.json()["detail"]


def test_non_utf8_text_upload_is_rejected(client):
    register(client, f"magic-{__import__('uuid').uuid4().hex[:8]}@docsage.dev")
    utf16 = "résumé of incidents".encode("utf-16")
    response = _upload(
        client, filename="notes.txt", content_type="text/plain", data=utf16
    )
    assert response.status_code == 422
    assert "UTF-8" in response.json()["detail"]


def test_genuine_binary_from_the_seed_corpus_is_accepted(client):
    register(client, f"magic-{__import__('uuid').uuid4().hex[:8]}@docsage.dev")
    response = _upload(
        client,
        filename="ticket-volume-chart.png",
        content_type="image/png",
        data=(SEED_CORPUS / "ticket-volume-chart.png").read_bytes(),
    )
    assert response.status_code == 202, response.text
    assert response.json()["status"] == "queued"


def test_unknown_declared_mime_is_rejected_before_sniffing(client):
    register(client, f"magic-{__import__('uuid').uuid4().hex[:8]}@docsage.dev")
    response = _upload(
        client, filename="payload.zip", content_type="application/zip", data=b"PK\x03\x04junk"
    )
    assert response.status_code == 422
    assert "unsupported file type" in response.json()["detail"]
