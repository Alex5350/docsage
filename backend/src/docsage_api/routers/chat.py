"""Chat sessions and the SSE message endpoint (grounded RAG answers)."""

import json
import uuid
from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from docsage_api.core.config import Settings, get_settings
from docsage_api.db.models import ChatMessage, ChatSession, User
from docsage_api.db.session import get_db, session_factory
from docsage_api.dependencies import get_current_user
from docsage_api.schemas.shared import (
    ChatMessageIn,
    ChatMessageListOut,
    ChatMessageOut,
    ChatSessionCreateIn,
    ChatSessionListOut,
    ChatSessionOut,
)
from docsage_api.services.answer import AnswerService
from docsage_api.services.retrieval import retrieve

router = APIRouter(prefix="/chat", tags=["chat"])


def _own_session(db: Session, session_id: uuid.UUID, user: User) -> ChatSession:
    chat_session = db.get(ChatSession, session_id)
    if chat_session is None or chat_session.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")
    return chat_session


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, separators=(',', ':'))}\n\n"


@router.post("/sessions", response_model=ChatSessionOut, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: ChatSessionCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ChatSession:
    if payload.scope not in ("personal", "admin"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="scope must be 'personal' or 'admin'",
        )
    if payload.scope == "admin" and user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin chat scope requires the admin role"
        )
    chat_session = ChatSession(user_id=user.id, scope=payload.scope)
    db.add(chat_session)
    db.commit()
    db.refresh(chat_session)
    return chat_session


@router.get("/sessions", response_model=ChatSessionListOut)
def list_sessions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ChatSessionListOut:
    sessions = db.scalars(
        select(ChatSession)
        .where(ChatSession.user_id == user.id)
        .order_by(ChatSession.created_at.desc())
    ).all()
    return ChatSessionListOut(items=[ChatSessionOut.model_validate(s) for s in sessions])


@router.get("/sessions/{session_id}/messages", response_model=ChatMessageListOut)
def list_messages(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ChatMessageListOut:
    chat_session = _own_session(db, session_id, user)
    messages = db.scalars(
        select(ChatMessage)
        .where(ChatMessage.session_id == chat_session.id)
        .order_by(ChatMessage.created_at, ChatMessage.id)
    ).all()
    return ChatMessageListOut(items=[ChatMessageOut.model_validate(m) for m in messages])


@router.post("/sessions/{session_id}/messages")
def post_message(
    session_id: uuid.UUID,
    payload: ChatMessageIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    chat_session = _own_session(db, session_id, user)
    if chat_session.scope == "admin" and user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin chat scope requires the admin role"
        )

    db.add(ChatMessage(session_id=chat_session.id, role="user", content=payload.content))
    db.commit()

    retrieved = retrieve(db, user, chat_session.scope, payload.content)
    assistant_message_id = uuid.uuid4()
    answer_service = AnswerService(settings)

    def event_stream() -> Iterator[str]:
        text_parts: list[str] = []
        citations: list[dict] = []
        completed = False
        try:
            for event in answer_service.stream(
                payload.content, retrieved, message_id=str(assistant_message_id)
            ):
                if event["type"] == "delta":
                    text_parts.append(event["text"])
                elif event["type"] == "citations":
                    citations = event["citations"]
                elif event["type"] == "done":
                    completed = True
                yield _sse(event)
        except Exception:
            yield _sse({"type": "error", "message": "answer generation failed"})
        finally:
            if completed:  # persist only fully-generated answers
                persist_db = session_factory()()
                try:
                    persist_db.add(
                        ChatMessage(
                            id=assistant_message_id,
                            session_id=chat_session.id,
                            role="assistant",
                            content="".join(text_parts),
                            citations=citations,
                        )
                    )
                    persist_db.commit()
                finally:
                    persist_db.close()

    return StreamingResponse(event_stream(), media_type="text/event-stream")
