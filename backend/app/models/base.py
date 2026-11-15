"""Firestore document model base (P2 §6.1): snake_case in Python, camelCase in Firestore."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Self

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class DocModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="allow", arbitrary_types_allowed=True
    )

    id: str

    def to_firestore(self) -> dict[str, Any]:
        """camelCase dict with native datetimes (Firestore Timestamps)."""
        return self.model_dump(by_alias=True, mode="python")

    @classmethod
    def from_firestore(cls, data: dict[str, Any] | None) -> Self | None:
        return None if data is None else cls.model_validate(data)


class TimestampedDoc(DocModel):
    created_at: datetime
    updated_at: datetime
