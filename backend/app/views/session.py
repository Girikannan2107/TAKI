"""SessionUserDTO projection (contract §1.1). Owned by D2 (part of the auth views)."""

from __future__ import annotations

from typing import Any

from app.core.constants import CLAIMS_VERSION
from app.domain.phone import mask_phone
from app.schemas.auth import SessionAgency, SessionAgencyLink, SessionDriver, SessionUserDTO
from app.views.common import ref_url


def session_user_dto(user: dict[str, Any], profile: dict[str, Any] | None) -> SessionUserDTO:
    """``profile`` is ``customers/{uid}``, ``agencies/{agencyId}`` or ``drivers/{uid}`` (or None)."""
    uid = str(user["id"])
    role = str(user["role"])
    dto = SessionUserDTO(
        id=uid,
        role=role,  # type: ignore[arg-type]
        name=str(user.get("displayName", "")),
        phone_masked=mask_phone(str(user.get("phone", ""))),
        photo_url=None,
        claims_version=CLAIMS_VERSION,
    )
    if not profile:
        return dto
    dto.photo_url = ref_url(profile.get("photo"), uid)
    if role == "customer":
        dto.name = profile.get("fullName", dto.name)
    elif role == "agency":
        v = profile.get("verification") or {}
        dto.name = profile.get("ownerName", dto.name)
        dto.agency = SessionAgency(
            id=profile["id"],
            name=profile.get("agencyName", ""),
            verification=v.get("status", "not_submitted"),
            reason=v.get("reason"),
        )
    elif role == "driver":
        v = profile.get("verification") or {}
        link = profile.get("agencyLink")
        dto.name = profile.get("fullName", dto.name)
        dto.driver = SessionDriver(
            agency_link=SessionAgencyLink(
                agency_id=link["agencyId"], agency_name=link.get("agencyName", ""), status=link["status"]
            )
            if link
            else None,
            verification=v.get("status", "not_submitted"),
        )
    return dto
