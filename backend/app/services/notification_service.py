"""In-app notifications (P2 §13.2). Owner: D4.

``notify(tx, …)`` writes the notification **inside** the caller's business transaction, so a state
change and its notification commit together. Writes only (safe after the transaction's reads).
No SMS or push in v3; FCM can be added here later without API changes.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.ids import new_id
from app.core.pagination import decode_cursor, encode_cursor
from app.core.time import iso_z
from app.repositories import notifications as repo


@dataclass(frozen=True)
class Note:
    user_id: str
    role: str
    kind: str
    title: str
    body: str
    link: dict[str, str] | None = None


def build(
    *, user_id: str, role: str, kind: str, title: str, body: str, link: dict[str, str] | None, now: datetime
) -> dict[str, Any]:
    nid = new_id("ntf")
    return {
        "id": nid,
        "userId": user_id,
        "role": role,
        "kind": kind,
        "title": title,
        "body": body,
        "link": link,
        "createdAt": now,
        "readAt": None,
    }


def notify(
    tx: AsyncTransaction,
    *,
    user_id: str,
    role: str,
    kind: str,
    title: str,
    body: str,
    link: dict[str, str] | None = None,
    now: datetime,
) -> str:
    """Queue one notification write on ``tx``. Returns its id."""
    doc = build(user_id=user_id, role=role, kind=kind, title=title, body=body, link=link, now=now)
    repo.tx_create(tx, doc)
    return str(doc["id"])


def notify_many(tx: AsyncTransaction, notes: Iterable[Note], now: datetime) -> int:
    """One notification per (recipient, kind) per transaction."""
    seen: set[tuple[str, str]] = set()
    n = 0
    for x in notes:
        if not x.user_id or (x.user_id, x.kind) in seen:
            continue
        seen.add((x.user_id, x.kind))
        notify(tx, user_id=x.user_id, role=x.role, kind=x.kind, title=x.title, body=x.body, link=x.link, now=now)
        n += 1
    return n


def to_dto(n: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": n["id"],
        "kind": n.get("kind"),
        "title": n.get("title", ""),
        "body": n.get("body", ""),
        "link": n.get("link"),
        "createdAt": iso_z(n.get("createdAt")),
        "readAt": iso_z(n.get("readAt")),
    }


async def list_page(
    user: CurrentUser, *, limit: int = 20, cursor: str | None = None, unread_only: bool = False
) -> dict[str, Any]:
    c = decode_cursor(cursor)
    after = str(c.get("id", "")) if c else None
    if c is not None and not (after or "").startswith("ntf_"):
        raise AppError("invalid_request", "Invalid cursor.", fields={"cursor": "Invalid cursor"})
    rows = await repo.list_for_user(user.uid, limit=limit + 1, unread_only=unread_only, after_id=after)
    page = rows[:limit]
    nxt = encode_cursor({"id": page[-1]["id"]}) if len(rows) > limit and page else None
    return {"items": [to_dto(n) for n in page], "nextCursor": nxt}


async def recent(user_id: str, limit: int = 5) -> list[dict[str, Any]]:
    return [to_dto(n) for n in await repo.list_for_user(user_id, limit=limit)]


async def unread_count(user: CurrentUser) -> int:
    return await repo.unread_count(user.uid)


async def mark_read(user: CurrentUser, *, ids: Sequence[str] | None, all_: bool, now: datetime) -> int:
    if all_:
        return await repo.mark_all_read(user.uid, now)
    return await repo.mark_read_ids(user.uid, list(ids or []), now)


__all__ = ["Note", "build", "list_page", "mark_read", "notify", "notify_many", "recent", "to_dto", "unread_count"]
