"""``files/{fil_*}`` metadata (bytes live in Cloud Storage)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.repositories.base import C, doc_ref, get_doc


async def get(file_id: str) -> dict[str, Any] | None:
    return await get_doc(C.files, file_id)


async def create(doc: dict[str, Any]) -> None:
    await doc_ref(C.files, doc["id"]).create(doc)


async def set_status(file_id: str, status: str, now: datetime) -> None:
    await doc_ref(C.files, file_id).update({"status": status, "updatedAt": now})
