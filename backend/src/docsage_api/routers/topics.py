"""Topic and SME designation endpoints (admin-managed)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from docsage_api.db.models import SmeDesignation, Topic, User
from docsage_api.db.session import get_db
from docsage_api.dependencies import get_current_user, require_admin
from docsage_api.schemas.shared import (
    SmeDesignationIn,
    SmeRef,
    TopicCreateIn,
    TopicListOut,
    TopicOut,
)

router = APIRouter(prefix="/topics", tags=["topics"])


def _topic_out(db: Session, topic: Topic) -> TopicOut:
    smes = [
        SmeRef.model_validate(user)
        for user in db.scalars(
            select(User)
            .join(SmeDesignation, SmeDesignation.user_id == User.id)
            .where(SmeDesignation.topic_id == topic.id)
            .order_by(User.display_name)
        )
    ]
    return TopicOut(
        id=topic.id, name=topic.name, description=topic.description, smes=smes
    )


@router.get("", response_model=TopicListOut)
def list_topics(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TopicListOut:
    topics = db.scalars(select(Topic).order_by(Topic.name)).all()
    return TopicListOut(items=[_topic_out(db, topic) for topic in topics])


@router.post("", response_model=TopicOut, status_code=status.HTTP_201_CREATED)
def create_topic(
    payload: TopicCreateIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> TopicOut:
    name = payload.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="name is required"
        )
    if db.scalar(select(Topic).where(Topic.name == name)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Topic name already exists"
        )

    topic = Topic(name=name, description=payload.description.strip(), created_by=admin.id)
    db.add(topic)
    db.commit()
    db.refresh(topic)
    return _topic_out(db, topic)


@router.post("/{topic_id}/smes", response_model=SmeRef, status_code=status.HTTP_201_CREATED)
def add_sme(
    topic_id: uuid.UUID,
    payload: SmeDesignationIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> SmeRef:
    topic = db.get(Topic, topic_id)
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found")
    user = db.get(User, payload.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if db.scalar(
        select(SmeDesignation).where(
            SmeDesignation.topic_id == topic_id, SmeDesignation.user_id == payload.user_id
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already an SME for this topic",
        )

    db.add(
        SmeDesignation(topic_id=topic_id, user_id=payload.user_id, designated_by=admin.id)
    )
    db.commit()
    return SmeRef.model_validate(user)


@router.delete("/{topic_id}/smes/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_sme(
    topic_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    designation = db.scalar(
        select(SmeDesignation).where(
            SmeDesignation.topic_id == topic_id, SmeDesignation.user_id == user_id
        )
    )
    if designation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="SME designation not found"
        )
    db.delete(designation)
    db.commit()
