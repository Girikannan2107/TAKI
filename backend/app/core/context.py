"""Request principal types shared by deps, services and views."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class CurrentUser:
    """An authenticated session user (session token + ``users/{uid}``)."""

    uid: str
    role: str
    phone: str
    name: str
    agency_id: str | None = None
    claims: dict[str, Any] = field(default_factory=dict, repr=False, compare=False)


@dataclass(frozen=True)
class PhoneProof:
    """A verified, fresh phone-OTP token (accepted only by signup/reset/phone change)."""

    uid: str
    phone: str  # E.164
    auth_time: int
