"""E104–E106: in-app notifications (list, unread count, mark read). Owner: D4."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response

from app.core.clock import Clock, get_clock
from app.core.context import CurrentUser
from app.deps import get_current_user
from app.schemas.errors import error_responses
from app.schemas.notifications import MarkReadBody, NotificationPage, UnreadCount
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])

UserDep = Annotated[CurrentUser, Depends(get_current_user)]


@router.get("", response_model=NotificationPage, responses=error_responses(400, 401))
async def list_notifications(
    user: UserDep,
    unread_only: Annotated[bool, Query(alias="unreadOnly")] = False,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> dict[str, Any]:
    return await notification_service.list_page(user, limit=limit, cursor=cursor, unread_only=unread_only)


@router.get("/unread-count", response_model=UnreadCount, responses=error_responses(401))
async def unread_count(user: UserDep) -> dict[str, int]:
    return {"count": await notification_service.unread_count(user)}


@router.post("/read", status_code=204, responses=error_responses(400, 401))
async def mark_read(body: MarkReadBody, user: UserDep, clock: Annotated[Clock, Depends(get_clock)]) -> Response:
    await notification_service.mark_read(user, ids=body.ids, all_=bool(body.all), now=clock.now())
    return Response(status_code=204)
