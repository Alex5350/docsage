"""Image extraction: Pillow verify/re-encode plus EXIF seed caption."""

import io
from pathlib import Path

from PIL import Image

from docsage_api.services.extraction.base import ExtractedPart, ExtractionResult

MAX_EDGE = 2048
EXIF_IMAGE_DESCRIPTION = 270


def extract(path: Path, mime: str) -> ExtractionResult:
    # verify() validates the file but leaves the image unusable — reopen afterwards.
    with Image.open(path) as probe:
        probe.verify()
    with Image.open(path) as img:
        exif_description = ""
        try:
            raw = img.getexif().get(EXIF_IMAGE_DESCRIPTION)
            if isinstance(raw, str) and raw.strip():
                exif_description = raw.strip()
        except Exception:
            exif_description = ""

        if img.width > MAX_EDGE or img.height > MAX_EDGE:
            img.thumbnail((MAX_EDGE, MAX_EDGE))
        rgb = img.convert("RGB")

    output_mime = "image/png" if mime == "image/png" else "image/jpeg"
    buffer = io.BytesIO()
    rgb.save(buffer, format="PNG" if output_mime == "image/png" else "JPEG", quality=85)
    return ExtractionResult(
        parts=[
            ExtractedPart(
                kind="image",
                content=exif_description,
                image_bytes=buffer.getvalue(),
                mime=output_mime,
                filename=path.name,
            )
        ]
    )
