"""Notification schemas (contract §12, E104–E106). Owner: D4."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field, model_validator
from pydantic_core import PydanticCustomError

from app.schemas.common import CamelModel

NotificationId = Annotated[str, Field(pattern=r"^ntf_[a-z0-9]{20}$")]


class NotificationDTO(CamelModel):
    id: str
    kind: str
    title: str
    body: str
    link: dict[str, Any] | None = None
    created_at: str
    read_at: str | None = None


class NotificationPage(CamelModel):
    items: list[NotificationDTO]
    next_cursor: str | None = None


class UnreadCount(CamelModel):
    count: int


class MarkReadBody(CamelModel):
    ids: list[NotificationId] | None = Field(None, min_length=1, max_length=50)
    all: bool | None = None

    @model_validator(mode="after")
    def _one_of(self) -> MarkReadBody:
        if bool(self.ids) == bool(self.all):
            raise PydanticCustomError("field:ids", "Send either ids or all: true")
        return self


__all__ = ["MarkReadBody", "NotificationDTO", "NotificationId", "NotificationPage", "UnreadCount"]
