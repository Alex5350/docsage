"""Gemini embedding provider (google-genai SDK, gemini-embedding-2 v2 conventions).

v2 has no ``task_type`` parameter — tasks are literal text prefixes that MUST
match on both sides of retrieval: documents as ``title: … | text: …``, queries
as ``task: search result | query: …``. Images embed natively from bytes, one
request per image (v2 aggregates multi-part requests into a single embedding).
"""

from google import genai
from google.genai import errors, types

from docsage_api.core.config import Settings
from docsage_api.services.embeddings.base import EMBEDDING_DIMENSIONS
from docsage_api.services.retry import call_with_retries

_RETRYABLE_CODES = {408, 429, 500, 502, 503, 504}
_HTTP_TIMEOUT_MS = 60_000


def _is_retryable(exc: Exception) -> bool:
    return isinstance(exc, errors.APIError) and exc.code in _RETRYABLE_CODES


class GeminiEmbeddingProvider:
    """Embeds via ``client.models.embed_content`` with output_dimensionality=1536."""

    name = "gemini"

    def __init__(self, settings: Settings) -> None:
        self._client = genai.Client(
            api_key=settings.gemini_api_key,
            http_options=types.HttpOptions(timeout=_HTTP_TIMEOUT_MS),
        )
        self.model_id = settings.gemini_embedding_model
        self._config = types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIMENSIONS)

    def _embed(self, contents: object) -> list[list[float]]:
        result = call_with_retries(
            lambda: self._client.models.embed_content(
                model=self.model_id, contents=contents, config=self._config
            ),
            is_retryable=_is_retryable,
        )
        return [list(e.values or []) for e in (result.embeddings or [])]

    def embed_documents(self, texts: list[str], title: str) -> list[list[float]]:
        contents = [f"title: {title} | text: {t}" for t in texts]
        return self._embed(contents)

    def embed_query(self, text: str) -> list[float]:
        vectors = self._embed(f"task: search result | query: {text}")
        return vectors[0]

    def embed_image(self, data: bytes, mime: str) -> list[float] | None:
        part = types.Part.from_bytes(data=data, mime_type=mime)
        vectors = self._embed(part)  # one part per call: separate embeddings under v2
        return vectors[0]
