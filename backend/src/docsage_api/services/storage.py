"""Local file storage for uploaded documents: var/uploads/{id}/{filename}."""

import hashlib
import shutil
import uuid
from pathlib import Path

UPLOAD_ROOT = Path("var") / "uploads"


def upload_path(document_id: uuid.UUID, source_filename: str) -> Path:
    return UPLOAD_ROOT / str(document_id) / Path(source_filename).name


def save_upload(document_id: uuid.UUID, source_filename: str, data: bytes) -> Path:
    """Write the uploaded bytes under the storage root and return the path."""
    path = upload_path(document_id, source_filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def delete_upload(document_id: uuid.UUID) -> None:
    """Best-effort removal of the document's storage directory."""
    shutil.rmtree(UPLOAD_ROOT / str(document_id), ignore_errors=True)


def checksum_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
