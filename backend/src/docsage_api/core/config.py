"""Application settings loaded from the environment (prefix ``DOCSAGE_``).

Provider API keys are read without the prefix (``GEMINI_API_KEY``,
``OPENAI_API_KEY``, ``OPENAI_BASE_URL``) to match the repo-root ``.env.example``.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="DOCSAGE_",
        env_file=".env",
        env_file_encoding="utf-8",
        populate_by_name=True,
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://docsage:docsage@localhost:5433/docsage"
    session_secret: str = "change-me-to-a-long-random-string"
    env: str = "development"
    demo_mode: bool = True

    gemini_api_key: str = Field(default="", validation_alias="GEMINI_API_KEY")
    openai_api_key: str = Field(default="", validation_alias="OPENAI_API_KEY")
    openai_base_url: str = Field(default="", validation_alias="OPENAI_BASE_URL")

    gemini_embedding_model: str = "gemini-embedding-001"
    gemini_vision_model: str = "gemini-2.5-flash"
    openai_embedding_model: str = "text-embedding-3-small"
    openai_chat_model: str = "gpt-5.1"

    @property
    def gemini_enabled(self) -> bool:
        return not self.demo_mode and bool(self.gemini_api_key)

    @property
    def openai_enabled(self) -> bool:
        return not self.demo_mode and bool(self.openai_api_key)

    @property
    def secure_cookies(self) -> bool:
        return self.env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
