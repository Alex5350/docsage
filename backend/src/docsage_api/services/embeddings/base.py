"""Embedding provider protocol and factory (gemini | openai | demo)."""

from typing import Protocol

from docsage_api.core.config import Settings

PROVIDER_NAMES = ("gemini", "openai", "demo")
EMBEDDING_DIMENSIONS = 1536


class EmbeddingProvider(Protocol):
    """A vector space: documents, queries, and (optionally) images embed into it."""

    name: str
    model_id: str

    def embed_documents(self, texts: list[str], title: str) -> list[list[float]]:
        """Embed document chunks (provider-defined title pairing) into this space."""
        ...  # pragma: no cover - protocol

    def embed_query(self, text: str) -> list[float]:
        """Embed a search query; MUST stay in the same space as ``embed_documents``."""
        ...  # pragma: no cover - protocol

    def embed_image(self, data: bytes, mime: str) -> list[float] | None:
        """Embed image bytes natively, or ``None`` when the provider is text-only."""
        ...  # pragma: no cover - protocol


def provider_available(name: str, settings: Settings) -> bool:
    """Whether ``name`` can be instantiated right now (demo is always available)."""
    if name == "demo":
        return True
    if name == "gemini":
        return settings.gemini_enabled
    if name == "openai":
        return settings.openai_enabled
    return False


def get_provider(name: str, settings: Settings) -> EmbeddingProvider:
    """Instantiate the provider ``name``; ValueError when it is unavailable."""
    if name == "demo":
        from docsage_api.services.embeddings.demo import DemoEmbeddingProvider

        return DemoEmbeddingProvider()
    if name == "gemini":
        if not settings.gemini_enabled:
            raise ValueError(
                "embedding provider 'gemini' is unavailable: no GEMINI_API_KEY is configured "
                "(or demo mode is on). Set GEMINI_API_KEY and DOCSAGE_DEMO_MODE=false, "
                "or upload with provider='demo'."
            )
        from docsage_api.services.embeddings.gemini import GeminiEmbeddingProvider

        return GeminiEmbeddingProvider(settings)
    if name == "openai":
        if not settings.openai_enabled:
            raise ValueError(
                "embedding provider 'openai' is unavailable: no OPENAI_API_KEY is configured "
                "(or demo mode is on). Set OPENAI_API_KEY and DOCSAGE_DEMO_MODE=false, "
                "or upload with provider='demo'."
            )
        from docsage_api.services.embeddings.openai_emb import OpenAIEmbeddingProvider

        return OpenAIEmbeddingProvider(settings)
    raise ValueError(f"unknown embedding provider: {name!r} (expected one of {PROVIDER_NAMES})")
