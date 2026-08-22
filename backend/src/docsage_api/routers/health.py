"""Health endpoint: database reachability, demo mode, provider availability."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from docsage_api.core.config import Settings, get_settings
from docsage_api.db.session import get_db

router = APIRouter(tags=["health"])


class ProvidersOut(BaseModel):
    gemini: bool
    openai: bool


class HealthOut(BaseModel):
    status: str
    database: str
    demo_mode: bool
    providers: ProvidersOut


@router.get("/health", response_model=HealthOut)
def health(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> HealthOut:
    try:
        db.execute(text("SELECT 1"))
        database = "up"
    except Exception:
        database = "down"
    ok = database == "up"
    return HealthOut(
        status="ok" if ok else "degraded",
        database=database,
        demo_mode=settings.demo_mode,
        providers=ProvidersOut(gemini=settings.gemini_enabled, openai=settings.openai_enabled),
    )
