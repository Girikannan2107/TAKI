"""FastAPI dependencies (P2 §5.4): settings, clock, authentication and authorisation.

* ``get_current_user``  — session token (``sign_in_provider == "custom"``) + ``users/{uid}``
  (source of truth for role, status and revocation). Phone-proof tokens → 403
  ``password_login_required``.
* ``require_role(*roles)`` — 403 ``forbidden`` for any other role.
* ``get_optional_user`` — public endpoints; ``None`` when no/invalid token (never raises).
* ``require_phone_proof`` — Bearer phone-OTP token (provider ``phone``, ≤ 10 min old).
* ``phone_proof_header`` — the same, from ``X-Phone-Proof`` (phone change).
* ``get_place_resolver`` — Google place id → ``PlaceRef`` (implemented by D5's maps integration).
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Annotated, Any, Protocol

from fastapi import Depends, Header, Request

from app.core.clock import Clock, get_clock
from app.core.config import Settings, get_settings
from app.core.constants import PHONE_PROOF_MAX_AGE_SECONDS
from app.core.context import CurrentUser, PhoneProof
from app.core.errors import AppError
from app.domain.phone import to_e164
from app.integrations.firebase import auth as fb_auth
from app.repositories import users as users_repo

__all__ = [
    "Clock",
    "CurrentUser",
    "PhoneProof",
    "Settings",
    "get_clock",
    "get_current_user",
    "get_optional_user",
    "get_place_resolver",
    "get_settings",
    "phone_proof_header",
    "require_phone_proof",
    "require_role",
]


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def _provider(claims: dict[str, Any]) -> str | None:
    fb = claims.get("firebase") or {}
    return fb.get("sign_in_provider") if isinstance(fb, dict) else None


async def user_from_claims(claims: dict[str, Any]) -> CurrentUser:
    """Load ``users/{uid}`` and apply status + revocation checks."""
    if _provider(claims) != "custom":
        raise AppError("password_login_required")
    uid = str(claims.get("uid") or claims.get("sub") or "")
    user = await users_repo.get_user(uid) if uid else None
    if not user:
        raise AppError("unauthenticated")
    if user.get("status") == "disabled":
        raise AppError("account_disabled")
    valid_after = user.get("sessionsValidAfter")
    auth_time = int(claims.get("auth_time") or 0)
    if valid_after is not None and auth_time < int(valid_after.timestamp()):
        raise AppError("session_revoked")
    return CurrentUser(
        uid=uid,
        role=str(user["role"]),
        phone=str(user.get("phone", "")),
        name=str(user.get("displayName", "")),
        agency_id=user.get("agencyId"),
        claims=claims,
    )


async def get_current_user(request: Request, authorization: Annotated[str | None, Header()] = None) -> CurrentUser:
    token = bearer_token(authorization)
    if not token:
        raise AppError("unauthenticated")
    claims = await fb_auth.verify_id_token(token)
    user = await user_from_claims(claims)
    request.state.uid = user.uid
    return user


async def get_optional_user(
    request: Request, authorization: Annotated[str | None, Header()] = None
) -> CurrentUser | None:
    token = bearer_token(authorization)
    if not token:
        return None
    try:
        claims = await fb_auth.verify_id_token(token)
        user = await user_from_claims(claims)
    except AppError:
        return None
    request.state.uid = user.uid
    return user


def require_role(*roles: str) -> Callable[..., Awaitable[CurrentUser]]:
    """``Depends(require_role("agency"))`` → the current user, or 403 ``forbidden``."""

    async def _dep(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
        if user.role not in roles:
            raise AppError("forbidden")
        return user

    return _dep


async def _phone_proof_from_token(token: str | None) -> PhoneProof:
    if not token:
        raise AppError("phone_proof_required")
    try:
        claims = await fb_auth.verify_id_token(token)
    except AppError as e:
        raise AppError("phone_proof_required") from e
    phone = to_e164(str(claims.get("phone_number") or ""))
    auth_time = int(claims.get("auth_time") or 0)
    if _provider(claims) != "phone" or not phone:
        raise AppError("phone_proof_required")
    if time.time() - auth_time > PHONE_PROOF_MAX_AGE_SECONDS:
        raise AppError("phone_proof_required", "Your phone verification expired. Verify again.")
    return PhoneProof(uid=str(claims.get("uid") or claims.get("sub")), phone=phone, auth_time=auth_time)


async def require_phone_proof(
    authorization: Annotated[str | None, Header()] = None,
) -> PhoneProof:
    return await _phone_proof_from_token(bearer_token(authorization))


async def phone_proof_header(
    x_phone_proof: Annotated[str | None, Header(alias="X-Phone-Proof")] = None,
) -> PhoneProof:
    return await _phone_proof_from_token(x_phone_proof.strip() if x_phone_proof else None)


# ── Maps (place id → PlaceRef) ────────────────────────────────────────────────
class PlaceResolver(Protocol):
    async def resolve_place_id(self, place_id: str) -> dict[str, Any]:
        """Return a Firestore ``PlaceRef`` map (P2 §6.2, camelCase):
        ``{placeId, name, formattedAddress, location: {lat, lng}, locality, district,
        state, stateName, pincode, geohash, geocodedAt}``.
        Raise ``AppError("address_not_found" | "maps_unavailable" | "maps_not_configured")``."""
        ...


class _UnconfiguredResolver:
    async def resolve_place_id(self, place_id: str) -> dict[str, Any]:
        raise AppError("maps_not_configured")


def get_place_resolver() -> PlaceResolver:
    """D5 provides ``app.integrations.maps.place_resolver.get_place_resolver()`` implementing
    ``PlaceResolver``; until then (or without a server key) place lookups return 503."""
    try:
        from app.integrations.maps.place_resolver import (  # type: ignore[import-not-found]
            get_place_resolver as _maps_resolver,
        )
    except ImportError:
        return _UnconfiguredResolver()
    return _maps_resolver()  # type: ignore[no-any-return]


SettingsDep = Annotated[Settings, Depends(get_settings)]
ClockDep = Annotated[Clock, Depends(get_clock)]
UserDep = Annotated[CurrentUser, Depends(get_current_user)]
OptionalUserDep = Annotated[CurrentUser | None, Depends(get_optional_user)]
PhoneProofDep = Annotated[PhoneProof, Depends(require_phone_proof)]
PlaceResolverDep = Annotated[PlaceResolver, Depends(get_place_resolver)]
AdminDep = Annotated[CurrentUser, Depends(require_role("admin"))]
