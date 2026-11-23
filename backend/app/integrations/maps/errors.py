"""Maps domain errors (D5). Subclasses of ``AppError`` so the global handler renders the envelope."""

from __future__ import annotations

from typing import Literal

from app.core.errors import AppError

UnavailableReason = Literal["quota", "denied", "timeout", "upstream", "invalid_request"]


class MapsNotConfigured(AppError):
    """503: no server key (and the fake is not allowed in this environment)."""

    def __init__(self) -> None:
        super().__init__("maps_not_configured")


class MapsUnavailable(AppError):
    """502: Google errored, timed out, refused the key or ran out of quota."""

    def __init__(self, reason: UnavailableReason = "upstream") -> None:
        super().__init__("maps_unavailable", details={"reason": reason})
        self.reason = reason


class AddressNotFound(AppError):
    """422: geocoding returned no result (or the place id is unknown)."""

    def __init__(self) -> None:
        super().__init__("address_not_found")
