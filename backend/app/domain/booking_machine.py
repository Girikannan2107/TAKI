"""Booking state machines (P2 §7.1–§7.4, §7.7). PURE. Owner: D4.

A booking carries four independent machines — ``approvalStatus``, ``paymentStatus``,
``reservationStatus``, ``fulfilmentStatus`` — plus a ``closure`` record. The legacy ``status`` and
the tab fields are produced **only** by :func:`derive`.

:func:`apply` decides one event and returns a :class:`Transition` with the field patch to write.
Re-applying an event whose target is already reached is a no-op (``changed=False``, no side
effects); any other inapplicable event raises ``AppError("invalid_transition")``.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal

from app.core.errors import AppError

# ── timing rules (P2 §7, v2 constants) ─────────────────────────────────────────
RESPOND_LEAD = timedelta(minutes=60)
PAYMENT_WINDOW = timedelta(minutes=120)
PAYMENT_CUTOFF_BEFORE_PICKUP = timedelta(minutes=30)
CHECKOUT_GRACE = timedelta(minutes=15)
PICKUP_WINDOW = timedelta(hours=24)
TRIP_START_WINDOW = timedelta(minutes=120)
OTP_ATTEMPTS = 5
MAX_OPEN_BOOKINGS_PER_TRIP = 50
MAX_PROOF_FILES = 3
STATUS_HISTORY_MAX = 30

Event = Literal[
    "accept",
    "reject",
    "expire_request",
    "checkout_started",
    "payment_failed",
    "payment_order_expired",
    "payment_succeeded",
    "expire_payment",
    "cancel",
    "trip_cancelled",
    "refuse_pickup",
    "pickup",
    "start_transit",
    "out_for_delivery",
    "deliver",
]

PAYABLE = frozenset({"due", "processing", "failed"})
PICKED_UP_OR_LATER = frozenset({"picked_up", "in_transit", "out_for_delivery", "delivered"})
ON_BOARD = frozenset({"picked_up", "in_transit", "out_for_delivery"})
# Legacy statuses of bookings that are still "open" (one per shipment; trip fan-out set).
OPEN_STATUSES = (
    "awaiting_agency",
    "pending_payment",
    "payment_failed",
    "confirmed",
    "picked_up",
    "in_transit",
    "out_for_delivery",
)
TERMINAL_STATUSES = ("delivered", "rejected", "cancelled")
CUSTOMER_TABS = ("pending", "confirmed", "picked_up", "in_transit", "delivered", "rejected", "cancelled")
AGENCY_TABS = ("pending", "accepted", "confirmed", "rejected", "cancelled")
DRIVER_TABS = ("pending_pickup", "in_transit", "delivered")

REJECT_REASONS = ("agency_rejected", "no_response_before_departure", "trip_cancelled")
CANCEL_REASONS = ("customer_cancelled", "payment_window_expired", "trip_cancelled", "pickup_refused")


def derive(b: Mapping[str, Any]) -> dict[str, Any]:
    """``{status, tab, agencyTab, driverTab}`` (§7.7, first match wins)."""
    closure = b.get("closure")
    approval = b.get("approvalStatus")
    payment = b.get("paymentStatus")
    fulfil = b.get("fulfilmentStatus")
    if closure and closure.get("kind") == "rejected":
        return {"status": "rejected", "tab": "rejected", "agencyTab": "rejected", "driverTab": None}
    if closure and closure.get("kind") == "cancelled":
        return {"status": "cancelled", "tab": "cancelled", "agencyTab": "cancelled", "driverTab": None}
    if approval == "pending":
        return {"status": "awaiting_agency", "tab": "pending", "agencyTab": "pending", "driverTab": None}
    if fulfil == "delivered":
        return {"status": "delivered", "tab": "delivered", "agencyTab": "confirmed", "driverTab": "delivered"}
    if fulfil == "picked_up":
        return {"status": "picked_up", "tab": "picked_up", "agencyTab": "confirmed", "driverTab": "in_transit"}
    if fulfil in ("in_transit", "out_for_delivery"):
        return {"status": fulfil, "tab": "in_transit", "agencyTab": "confirmed", "driverTab": "in_transit"}
    if payment == "paid":
        return {"status": "confirmed", "tab": "confirmed", "agencyTab": "confirmed", "driverTab": "pending_pickup"}
    if payment == "failed":
        return {"status": "payment_failed", "tab": "pending", "agencyTab": "accepted", "driverTab": None}
    return {"status": "pending_payment", "tab": "pending", "agencyTab": "accepted", "driverTab": None}


def is_closed(b: Mapping[str, Any]) -> bool:
    return bool(b.get("closure"))


def is_open(b: Mapping[str, Any]) -> bool:
    return derive(b)["status"] in OPEN_STATUSES


def state_of(b: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "approvalStatus": b.get("approvalStatus"),
        "paymentStatus": b.get("paymentStatus"),
        "reservationStatus": b.get("reservationStatus"),
        "fulfilmentStatus": b.get("fulfilmentStatus"),
        "closure": b.get("closure"),
    }


@dataclass
class Transition:
    changed: bool
    event: str
    patch: dict[str, Any] = field(default_factory=dict)
    booking: dict[str, Any] = field(default_factory=dict)
    prev: dict[str, Any] = field(default_factory=dict)

    @property
    def status(self) -> str:
        return str(self.booking.get("status"))


def _invalid(event: str, b: Mapping[str, Any], message: str | None = None) -> AppError:
    return AppError("invalid_transition", message, details={"event": event, "from": derive(b)["status"]})


def _closure(kind: str, reason: str, note: str | None, now: datetime, by: Mapping[str, Any]) -> dict[str, Any]:
    return {"kind": kind, "reason": reason, "note": note, "at": now, "by": dict(by)}


def _decide(
    b: Mapping[str, Any], event: str, note: str | None, now: datetime, by: Mapping[str, Any]
) -> dict[str, Any] | None:
    """Field changes for ``event`` or ``None`` when it is already applied. Raises when not allowed."""
    ap, pay, res, ful = (
        b.get("approvalStatus"),
        b.get("paymentStatus"),
        b.get("reservationStatus"),
        b.get("fulfilmentStatus"),
    )
    closure = b.get("closure")
    closed = bool(closure)

    def closed_with(kind: str, *reasons: str) -> bool:
        return bool(closure) and closure.get("kind") == kind and closure.get("reason") in reasons

    if event == "accept":
        if ap == "accepted" and not closed:
            return None
        if ap != "pending" or closed:
            raise _invalid(event, b)
        return {"approvalStatus": "accepted", "paymentStatus": "due", "reservationStatus": "held"}

    if event == "reject":
        if closed_with("rejected", "agency_rejected"):
            return None
        if ap != "pending" or closed:
            raise _invalid(event, b, "Only pending requests can be declined.")
        return {
            "approvalStatus": "rejected",
            "paymentStatus": "voided",
            "closure": _closure("rejected", "agency_rejected", note, now, by),
        }

    if event == "expire_request":
        if ap == "expired":
            return None
        if ap != "pending" or closed:
            raise _invalid(event, b)
        return {
            "approvalStatus": "expired",
            "paymentStatus": "voided",
            "closure": _closure("rejected", "no_response_before_departure", note, now, by),
        }

    if event == "checkout_started":
        if ap != "accepted" or closed:
            raise _invalid(event, b)
        if pay == "processing":
            return None
        if pay not in ("due", "failed"):
            raise _invalid(event, b)
        return {"paymentStatus": "processing"}

    if event == "payment_failed":
        if pay == "failed":
            return None
        if ap != "accepted" or closed or pay not in ("due", "processing"):
            raise _invalid(event, b)
        return {"paymentStatus": "failed"}

    if event == "payment_order_expired":
        if pay == "due":
            return None
        if ap != "accepted" or closed or pay not in ("processing", "failed"):
            raise _invalid(event, b)
        return {"paymentStatus": "due"}

    if event == "payment_succeeded":
        if pay == "paid":
            return None
        if ap != "accepted" or closed or pay not in PAYABLE:
            raise _invalid(event, b)
        return {"paymentStatus": "paid", "reservationStatus": "committed"}

    if event == "expire_payment":
        if closed_with("cancelled", "payment_window_expired"):
            return None
        if ap != "accepted" or closed or pay not in PAYABLE:
            raise _invalid(event, b)
        return {
            "paymentStatus": "expired",
            "reservationStatus": "released" if res in ("held", "committed") else res,
            "closure": _closure("cancelled", "payment_window_expired", note, now, by),
        }

    if event in ("cancel", "trip_cancelled"):
        reason = "customer_cancelled" if event == "cancel" else "trip_cancelled"
        if closed_with("cancelled", reason) or closed_with("rejected", reason):
            return None
        if closed or ful != "not_started":
            raise _invalid(event, b, "This booking can't be cancelled after pickup." if ful != "not_started" else None)
        if ap == "pending":
            kind = "cancelled" if event == "cancel" else "rejected"
            return {
                "approvalStatus": "withdrawn",
                "paymentStatus": "voided",
                "closure": _closure(kind, reason, note, now, by),
            }
        if ap != "accepted":
            raise _invalid(event, b)
        if pay == "paid":
            new_pay = "refund_pending"
        elif pay in PAYABLE or pay == "not_due":
            new_pay = "voided"
        else:
            new_pay = pay
        return {
            "paymentStatus": new_pay,
            "reservationStatus": "released" if res in ("held", "committed") else res,
            "closure": _closure("cancelled", reason, note, now, by),
        }

    if event == "refuse_pickup":
        if ful == "pickup_refused":
            return None
        if closed or pay != "paid" or ful != "not_started":
            raise _invalid(event, b)
        return {
            "paymentStatus": "refund_pending",
            "reservationStatus": "released",
            "fulfilmentStatus": "pickup_refused",
            "closure": _closure("cancelled", "pickup_refused", note, now, by),
        }

    if event == "pickup":
        if ful in PICKED_UP_OR_LATER:
            return None
        if closed or pay != "paid" or ful != "not_started":
            raise _invalid(event, b)
        return {"fulfilmentStatus": "picked_up"}

    if event == "start_transit":
        if ful in ("in_transit", "out_for_delivery", "delivered"):
            return None
        if closed or ful != "picked_up":
            raise _invalid(event, b)
        return {"fulfilmentStatus": "in_transit"}

    if event == "out_for_delivery":
        if ful in ("out_for_delivery", "delivered"):
            return None
        if closed or ful != "in_transit":
            raise _invalid(event, b)
        return {"fulfilmentStatus": "out_for_delivery"}

    if event == "deliver":
        if ful == "delivered":
            return None
        if closed or ful != "out_for_delivery":
            raise _invalid(event, b, "Mark the shipment out for delivery first.")
        return {"fulfilmentStatus": "delivered", "reservationStatus": "consumed"}

    raise ValueError(f"unknown event {event!r}")


def with_state(
    b: Mapping[str, Any], changes: Mapping[str, Any], *, now: datetime, by: Mapping[str, Any], note: str | None = None
) -> Transition:
    """Apply raw state ``changes`` (already validated) and recompute the derived fields."""
    nxt = {**b, **changes}
    derived = derive(nxt)
    patch: dict[str, Any] = {**changes, **derived, "updatedAt": now, "version": int(b.get("version", 0)) + 1}
    old_status = derive(b)["status"]
    if derived["status"] != old_status:
        entry: dict[str, Any] = {"status": derived["status"], "at": now, "by": dict(by)}
        if note:
            entry["note"] = note
        patch["statusHistory"] = [*(b.get("statusHistory") or []), entry][-STATUS_HISTORY_MAX:]
    nxt.update(patch)
    return Transition(True, "state", patch, nxt, dict(b))


def apply(
    b: Mapping[str, Any], event: str, *, now: datetime, by: Mapping[str, Any], note: str | None = None
) -> Transition:
    changes = _decide(b, event, note, now, by)
    if changes is None:
        return Transition(False, event, {}, dict(b), dict(b))
    t = with_state(b, changes, now=now, by=by, note=note)
    t.event = event
    return t


def can_apply(b: Mapping[str, Any], event: str, now: datetime | None = None) -> bool:
    try:
        changes = _decide(b, event, None, now or datetime.now().astimezone(), {"role": "system", "userId": None})
    except AppError:
        return False
    return changes is not None


def reached_at(b: Mapping[str, Any], status: str) -> datetime | None:
    for h in b.get("statusHistory") or []:
        if h.get("status") == status:
            return h.get("at")  # type: ignore[no-any-return]
    return None


def payment_due_at(now: datetime, pickup_departure_at: datetime) -> datetime:
    return min(now + PAYMENT_WINDOW, pickup_departure_at - PAYMENT_CUTOFF_BEFORE_PICKUP)


__all__ = [
    "AGENCY_TABS",
    "CANCEL_REASONS",
    "CHECKOUT_GRACE",
    "CUSTOMER_TABS",
    "DRIVER_TABS",
    "MAX_OPEN_BOOKINGS_PER_TRIP",
    "MAX_PROOF_FILES",
    "ON_BOARD",
    "OPEN_STATUSES",
    "OTP_ATTEMPTS",
    "PAYABLE",
    "PICKED_UP_OR_LATER",
    "PICKUP_WINDOW",
    "REJECT_REASONS",
    "TERMINAL_STATUSES",
    "TRIP_START_WINDOW",
    "Transition",
    "apply",
    "can_apply",
    "derive",
    "is_closed",
    "is_open",
    "payment_due_at",
    "reached_at",
    "state_of",
    "with_state",
]
