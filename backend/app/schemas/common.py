"""Shared API primitives and DTO building blocks (contract §0.1, §1). Owner: D2.

All API models inherit ``CamelModel`` (camelCase JSON, snake_case Python). Field validators raise
``PydanticCustomError`` so messages match today's zod copy; the validation handler maps them to
``{"error": {"code": "invalid_request", "fields": {path: msg}}}``.

A model-level validator that wants to attach its error to a field raises
``PydanticCustomError("field:<camelPath>", "<message>")`` (see ``field_error``).
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
)
from pydantic.alias_generators import to_camel
from pydantic_core import PydanticCustomError

from app.core.constants import PASSWORD_MAX, PASSWORD_MIN
from app.core.time import iso_z
from app.domain.phone import PHONE_MESSAGE, to_e164
from app.models.enums import StateCode


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class StrictCamelModel(CamelModel):
    """Rejects unknown fields (used where a body must match exactly one shape)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


def field_error(path: str, message: str) -> PydanticCustomError:
    return PydanticCustomError(f"field:{path}", message)


# ── Output ────────────────────────────────────────────────────────────────────
UtcDateTime = Annotated[datetime, PlainSerializer(lambda d: iso_z(d), return_type=str)]


# ── Phone ─────────────────────────────────────────────────────────────────────
def _phone(v: Any) -> str:
    e164 = to_e164(v if isinstance(v, str) else "")
    if not e164:
        raise PydanticCustomError("phone", PHONE_MESSAGE)
    return e164


Phone = Annotated[str, BeforeValidator(_phone)]


def _optional_phone(v: Any) -> str:
    if v is None or (isinstance(v, str) and v.strip() == ""):
        return ""
    return _phone(v)


OptionalPhone = Annotated[str, BeforeValidator(_optional_phone)]


# ── Password ──────────────────────────────────────────────────────────────────
def _password(v: str) -> str:
    if len(v) < PASSWORD_MIN:
        raise PydanticCustomError("password", f"Use at least {PASSWORD_MIN} characters")
    if len(v) > PASSWORD_MAX:
        raise PydanticCustomError("password", f"Use at most {PASSWORD_MAX} characters")
    if not re.search(r"[A-Za-z]", v):
        raise PydanticCustomError("password", "Include a letter")
    if not re.search(r"\d", v):
        raise PydanticCustomError("password", "Include a number")
    return v


Password = Annotated[str, AfterValidator(_password)]


# ── Names ─────────────────────────────────────────────────────────────────────
def Name(label: str, max_len: int = 60) -> Any:  # noqa: N802 - type factory
    def _check(v: Any) -> str:
        if not isinstance(v, str):
            raise PydanticCustomError("name", f"Enter {label}")
        s = re.sub(r"\s+", " ", v.strip())
        if len(s) < 2:
            raise PydanticCustomError("name", f"Enter {label}")
        if len(s) > max_len:
            raise PydanticCustomError("name", f"Use at most {max_len} characters")
        return s

    return Annotated[str, BeforeValidator(_check)]


# ── Dates ─────────────────────────────────────────────────────────────────────
def _iso_date(v: Any) -> str:
    if isinstance(v, date) and not isinstance(v, datetime):
        return v.isoformat()
    if not isinstance(v, str) or not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
        raise PydanticCustomError("date", "Enter a valid date (YYYY-MM-DD)")
    try:
        date.fromisoformat(v)
    except ValueError as e:
        raise PydanticCustomError("date", "Enter a valid date (YYYY-MM-DD)") from e
    return v


IsoDate = Annotated[str, BeforeValidator(_iso_date)]


def _dob(v: Any) -> str:
    try:
        s = _iso_date(v)
    except PydanticCustomError as e:
        raise PydanticCustomError("dob", "Enter your date of birth") from e
    if s < "1900-01-01":
        raise PydanticCustomError("dob", "Enter a valid date of birth")
    return s


# Format + range only; the 18+ check runs in the service (422 ``underage``, contract §0.1).
Dob = Annotated[str, BeforeValidator(_dob)]


def _accept_terms(v: Any) -> Literal[True]:
    if v is not True:
        raise PydanticCustomError("terms", "Accept the Terms to continue")
    return True


AcceptTerms = Annotated[bool, BeforeValidator(_accept_terms)]


def _pincode(v: Any) -> str:
    s = v.strip() if isinstance(v, str) else ""
    if not re.match(r"^[1-9]\d{5}$", s):
        raise PydanticCustomError("pincode", "Enter a 6-digit pincode")
    return s


Pincode = Annotated[str, BeforeValidator(_pincode)]

PlaceId = Annotated[str, Field(min_length=10, max_length=300, pattern=r"^[A-Za-z0-9_-]+$")]


def _reason(v: Any) -> str:
    s = v.strip() if isinstance(v, str) else ""
    if len(s) < 3:
        raise PydanticCustomError("reason", "Give a short reason (at least 3 characters)")
    if len(s) > 300:
        raise PydanticCustomError("reason", "Use at most 300 characters")
    return s


Reason = Annotated[str, BeforeValidator(_reason)]

AgencyId = Annotated[str, Field(pattern=r"^agc_[a-z0-9]{20}$")]
InviteId = Annotated[str, Field(pattern=r"^inv_[a-z0-9]{20}$")]
FileId = Annotated[str, Field(pattern=r"^fil_[a-z0-9]{20}$")]
Uid = Annotated[str, Field(pattern=r"^[A-Za-z0-9]{1,128}$")]

StatesCovered = Annotated[list[StateCode], Field(min_length=1, max_length=5)]


# ── Places ────────────────────────────────────────────────────────────────────
class PlaceInput(CamelModel):
    place_id: PlaceId


class PlaceDTO(CamelModel):
    place_id: str
    name: str
    formatted_address: str
    lat: float
    lng: float
    locality: str | None = None
    district: str | None = None
    state: str
    state_name: str
    pincode: str | None = None


def place_dto(place: dict[str, Any] | None) -> PlaceDTO | None:
    """Firestore ``PlaceRef`` (camelCase map) → ``PlaceDTO``."""
    if not place:
        return None
    loc = place.get("location") or {}
    return PlaceDTO(
        place_id=place.get("placeId", ""),
        name=place.get("name", ""),
        formatted_address=place.get("formattedAddress", ""),
        lat=float(loc.get("lat", 0.0)),
        lng=float(loc.get("lng", 0.0)),
        locality=place.get("locality"),
        district=place.get("district"),
        state=place.get("state", ""),
        state_name=place.get("stateName", ""),
        pincode=place.get("pincode"),
    )


def district_name_of(place: dict[str, Any] | None) -> str:
    if not place:
        return ""
    return str(place.get("district") or place.get("locality") or place.get("name") or "")


# ── Files ─────────────────────────────────────────────────────────────────────
class FileRefDTO(CamelModel):
    file_id: str
    url: str


class FileDTO(FileRefDTO):
    content_type: str
    size_bytes: int
    kind: str
    expires_at: UtcDateTime


# ── Paging ────────────────────────────────────────────────────────────────────
class Page[T](CamelModel):
    items: list[T]
    next_cursor: str | None = None


class Items[T](CamelModel):
    items: list[T]


class Ok(CamelModel):
    ok: bool = True
