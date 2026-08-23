"""Application factory and entry point."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import OperationalError

from docsage_api.db.session import session_factory
from docsage_api.routers import admin, auth, chat, documents, health, reviews, topics
from docsage_api.services.recovery import recover_on_startup


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Fail documents stranded in transient pipeline states by a previous
    # crash/restart, and purge expired sessions (see services/recovery.py).
    # Recovery must never kill startup: hosts like the E2E harness boot the
    # API before its database exists, and /api/health reports db state anyway.
    try:
        with session_factory()() as db:
            recover_on_startup(db)
    except OperationalError as exc:
        logging.getLogger(__name__).warning("startup recovery skipped: %s", exc)
    yield

DESCRIPTION = (
    "Agentic RAG document intelligence: ingestion, enrichment, review, and "
    "grounded chat over personal and agency-library documents."
)

TAGS_METADATA = [
    {"name": "health", "description": "Liveness and provider availability."},
    {"name": "auth", "description": "Register, login, logout, current user."},
    {
        "name": "documents",
        "description": "Upload/list/detail/delete documents (ingestion pipeline).",
    },
    {"name": "topics", "description": "Topics and SME designations."},
    {"name": "reviews", "description": "SME library-document review queue."},
    {"name": "chat", "description": "Grounded chat sessions with streamed answers."},
    {"name": "admin", "description": "Admin overview statistics."},
]


def create_app() -> FastAPI:
    app = FastAPI(
        title="DocSage API",
        description=DESCRIPTION,
        version="0.1.0",
        openapi_tags=TAGS_METADATA,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(topics.router, prefix="/api")
    app.include_router(reviews.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")
    app.include_router(admin.router, prefix="/api")
    return app


app = create_app()


def run() -> None:
    uvicorn.run("docsage_api.main:app", host="0.0.0.0", port=8000)


if __name__ == "__main__":
    run()
