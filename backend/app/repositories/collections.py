"""Collection names and subcollection / composite-id helpers (P2 §6.3). Owner: D3."""

from __future__ import annotations

from typing import Literal

from app.repositories.base import C

ScheduleKind = Literal["driver", "vehicle"]


def schedule_id(kind: ScheduleKind, resource_id: str) -> str:
    """``schedules/driver:{uid}`` / ``schedules/vehicle:{veh_*}``."""
    return f"{kind}:{resource_id}"


def registration_key(normalized: str) -> str:
    """``registrationIndex`` id: the normalised registration without spaces."""
    return normalized.replace(" ", "")


TRIP_EVENTS = "events"  # trips/{id}/events/{tev_*}
BOOKING_EVENTS = "events"  # bookings/{id}/events/{bev_*}

__all__ = ["BOOKING_EVENTS", "TRIP_EVENTS", "C", "ScheduleKind", "registration_key", "schedule_id"]
