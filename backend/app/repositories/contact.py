"""``contactMessages/{msg_*}`` (landing-page contact form)."""

from __future__ import annotations

from typing import Any

from app.repositories.base import C, doc_ref


async def create(doc: dict[str, Any]) -> None:
    await doc_ref(C.contact_messages, doc["id"]).create(doc)
