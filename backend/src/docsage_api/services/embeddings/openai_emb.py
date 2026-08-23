"""OpenAI embedding provider (text-embedding-3-small, dimensions=1536)."""

import openai

from docsage_api.core.config import Settings
from docsage_api.services.embeddings.base import EMBEDDING_DIMENSIONS
from docsage_api.services.retry import call_with_retries

_RETRYABLE_CODES = {408, 429, 500, 502, 503, 504}
_HTTP_TIMEOUT_S = 60.0


def _is_retryable(exc: Exception) -> bool:
    return isinstance(exc, openai.APIStatusError) and exc.status_code in _RETRYABLE_CODES


class OpenAIEmbeddingProvider:
    """Embeds via ``client.embeddings.create``; text-only (images ride on captions)."""

    name = "openai"

    def __init__(self, settings: Settings) -> None:
        self._client = openai.OpenAI(
            api_key=settings.openai_api_key or None,
            base_url=settings.openai_base_url or None,
            timeout=_HTTP_TIMEOUT_S,
        )
        self.model_id = settings.openai_embedding_model

    def _embed(self, inputs: list[str]) -> list[list[float]]:
        response = call_with_retries(
            lambda: self._client.embeddings.create(
                model=self.model_id,
                input=[t.replace("\n", " ") for t in inputs],
                dimensions=EMBEDDING_DIMENSIONS,
            ),
            is_retryable=_is_retryable,
        )
        ordered = sorted(response.data, key=lambda d: d.index)
        return [list(d.embedding) for d in ordered]

    def embed_documents(self, texts: list[str], title: str) -> list[list[float]]:
        return self._embed(texts)  # no task prefixing needed on this family

    def embed_query(self, text: str) -> list[float]:
        return self._embed([text])[0]

    def embed_image(self, data: bytes, mime: str) -> list[float] | None:
        return None  # text-only embedding model; images enter via caption chunks
