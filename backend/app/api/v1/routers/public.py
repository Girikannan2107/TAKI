"""E19–E20: public agency picker and the contact form."""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, status
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import Field, field_validator, model_validator

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.ids import new_id
from app.core.security import hmac_b64
from app.deps import ClockDep
from app.middleware.rate_limit import client_ip, rate_limit
from app.models.enums import ContactRole
from app.repositories import contact as contact_repo
from app.repositories.base import C, get_db, query_docs
from app.schemas.common import CamelModel, Items, OptionalPhone, UtcDateTime, district_name_of, field_error
from app.schemas.errors import error_responses

router = APIRouter(prefix="/public", tags=["public"])

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class PublicAgencyDTO(CamelModel):
    id: str
    agency_name: str
    district_name: str
    state: str


class ContactBody(CamelModel):
    name: str
    phone: OptionalPhone = ""
    email: str = ""
    role: ContactRole = "other"
    message: str
    website: str | None = Field(default=None, max_length=200)

    @field_validator("name", mode="before")
    @classmethod
    def check_name(cls, v: Any) -> str:
        s = v.strip() if isinstance(v, str) else ""
        if len(s) < 2:
            raise field_error("name", "Enter your name")
        if len(s) > 80:
            raise field_error("name", "Use at most 80 characters")
        return s

    @field_validator("email", mode="before")
    @classmethod
    def check_email(cls, v: Any) -> str:
        s = v.strip() if isinstance(v, str) else ""
        if not s:
            return ""
        if not _EMAIL.match(s) or len(s) > 120:
            raise field_error("email", "Enter a valid email")
        return s

    @field_validator("message", mode="before")
    @classmethod
    def check_message(cls, v: Any) -> str:
        s = v.strip() if isinstance(v, str) else ""
        if len(s) < 10:
            raise field_error("message", "Tell us a little more (at least 10 characters)")
        if len(s) > 2000:
            raise field_error("message", "Use at most 2000 characters")
        return s

    @model_validator(mode="after")
    def check_contact(self) -> ContactBody:
        if not self.phone and not self.email:
            raise field_error("phone", "Give a phone number or an email")
        return self


class ContactResultDTO(CamelModel):
    id: str
    received_at: UtcDateTime


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def _parse_near(near: str | None) -> tuple[float, float] | None:
    if not near:
        return None
    m = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$", near)
    if not m:
        raise AppError("invalid_request", fields={"near": "Use lat,lng"})
    lat, lng = float(m.group(1)), float(m.group(2))
    if not (6.0 <= lat <= 37.6 and 68.0 <= lng <= 97.5):
        raise AppError("invalid_request", fields={"near": "Location is outside India"})
    return lat, lng


@router.get("/agencies", response_model=Items[PublicAgencyDTO])
async def public_agencies(
    q: Annotated[str | None, Query(max_length=60)] = None,
    near: Annotated[str | None, Query(max_length=60)] = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 20,
) -> Items[PublicAgencyDTO]:
    """Verified agencies only (driver signup picker)."""
    point = _parse_near(near)
    query = (
        get_db().collection(C.agencies).where(filter=FieldFilter("verification.status", "==", "verified")).limit(500)
    )
    rows = await query_docs(query)
    words = [w for w in re.split(r"[^a-z0-9]+", (q or "").lower()) if w]
    if words:
        rows = [r for r in rows if all(w[:15] in (r.get("searchTokens") or []) for w in words)]
    if point:

        def _dist(r: dict[str, Any]) -> float:
            loc = ((r.get("base") or {}).get("location")) or {}
            if "lat" not in loc:
                return math.inf
            return _haversine_km(point, (float(loc["lat"]), float(loc["lng"])))

        rows.sort(key=_dist)
    else:
        rows.sort(key=lambda r: str(r.get("nameLower", "")))
    return Items[PublicAgencyDTO](
        items=[
            PublicAgencyDTO(
                id=r["id"],
                agency_name=r.get("agencyName", ""),
                district_name=district_name_of(r.get("base")),
                state=str((r.get("base") or {}).get("state", "")),
            )
            for r in rows[:limit]
        ]
    )


@router.post(
    "/contact",
    status_code=status.HTTP_201_CREATED,
    response_model=ContactResultDTO,
    responses=error_responses(400, 429),
    dependencies=[Depends(rate_limit("contact_ip", client_ip))],
)
async def contact(body: ContactBody, request: Request, clock: ClockDep) -> ContactResultDTO:
    now: datetime = clock.now()
    msg_id = new_id("msg")
    if body.website:  # honeypot: pretend success, store nothing
        return ContactResultDTO(id=msg_id, received_at=now)
    await contact_repo.create(
        {
            "id": msg_id,
            "name": body.name,
            "phone": body.phone or None,
            "email": body.email or None,
            "role": body.role,
            "message": body.message,
            "status": "new",
            "ipHash": hmac_b64(get_settings().pii_hash_key, client_ip(request)),
            "createdAt": now,
        }
    )
    return ContactResultDTO(id=msg_id, received_at=now)
