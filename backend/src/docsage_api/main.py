"""Application factory and entry point."""

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from docsage_api.routers import auth, health

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
        openapi_tags=TAGS_METADATA,
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
    return app


app = create_app()


def run() -> None:
    uvicorn.run("docsage_api.main:app", host="0.0.0.0", port=8000)


if __name__ == "__main__":
    run()
