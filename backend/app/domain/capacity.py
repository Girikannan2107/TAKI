"""Per-leg capacity ledger (P2 §8.1). PURE: no I/O. Owner: D3.

Trips are Firestore dicts (camelCase, P2 §6.4). Leg ``k`` is checkpoint ``k`` → ``k+1``; a trip with
``n`` checkpoints has ``n − 1`` legs. A hold from pickup ``i`` to drop ``j`` occupies legs ``i..j−1``.

``trip["holds"][bookingId] = {"kg", "fromIndex", "toIndex", "state": "held"|"committed", "dueAt"}``.
A ``held`` hold counts only while ``dueAt > now``, so an unpaid hold stops counting the instant its
payment window closes, even before any sweep deletes it.

Mutators return a **new** ``holds`` dict (the input trip is never modified); callers write
``holds`` / ``capacitySummary`` themselves inside their transaction.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Any

from app.core.errors import AppError

Hold = Mapping[str, Any]
Trip = Mapping[str, Any]

HOLD_STATES = ("held", "committed")


# ── basics ────────────────────────────────────────────────────────────────────
def leg_count(trip: Trip) -> int:
    return max(0, len(trip.get("checkpoints") or []) - 1)


def offered_kg(trip: Trip) -> int:
    return int((trip.get("capacity") or {}).get("offeredKg", 0))


def vehicle_max_kg(trip: Trip) -> int:
    return int((trip.get("capacity") or {}).get("vehicleMaxKg", 0))


def holds_of(trip: Trip) -> dict[str, dict[str, Any]]:
    return {k: dict(v) for k, v in (trip.get("holds") or {}).items()}


def is_active(hold: Hold, now: datetime) -> bool:
    """Committed (paid) holds always count; held ones until ``dueAt``."""
    if hold.get("state") == "committed":
        return True
    due = hold.get("dueAt")
    return due is not None and due > now


def _legs_of(hold: Hold, n_legs: int) -> range:
    a = max(0, int(hold.get("fromIndex", 0)))
    b = min(n_legs, int(hold.get("toIndex", 0)))
    return range(a, b)


def _loads(trip: Trip, now: datetime, exclude: str | None, states: Iterable[str]) -> list[int]:
    n = leg_count(trip)
    loads = [0] * n
    wanted = set(states)
    for hid, h in (trip.get("holds") or {}).items():
        if hid == exclude or h.get("state") not in wanted or not is_active(h, now):
            continue
        for k in _legs_of(h, n):
            loads[k] += int(h.get("kg", 0))
    return loads


def leg_loads(trip: Trip, now: datetime, exclude: str | None = None) -> list[int]:
    """Σ active kg per leg (held + committed)."""
    return _loads(trip, now, exclude, HOLD_STATES)


def committed_loads(trip: Trip, now: datetime) -> list[int]:
    return _loads(trip, now, None, ("committed",))


def held_loads(trip: Trip, now: datetime) -> list[int]:
    return _loads(trip, now, None, ("held",))


def _check_segment(trip: Trip, i: int, j: int) -> None:
    n = leg_count(trip)
    if not (0 <= i < j <= n):
        raise ValueError(f"invalid segment {i}->{j} for {n} legs")


def available_kg(trip: Trip, i: int, j: int, now: datetime, exclude: str | None = None) -> int:
    """``offeredKg − max(leg_loads[i:j])`` (never negative): the space left on segment i → j."""
    _check_segment(trip, i, j)
    loads = leg_loads(trip, now, exclude)
    return max(0, offered_kg(trip) - max(loads[i:j], default=0))


def fits(trip: Trip, kg: int, i: int, j: int, now: datetime, exclude: str | None = None) -> bool:
    return available_kg(trip, i, j, now, exclude) >= kg


def max_leg_load(trip: Trip, now: datetime) -> int:
    return max(leg_loads(trip, now), default=0)


def summary(trip: Trip, now: datetime) -> dict[str, int]:
    """``trip.capacitySummary`` (list views): maxima over legs."""
    return {
        "committedKgMaxLeg": max(committed_loads(trip, now), default=0),
        "heldKgMaxLeg": max(held_loads(trip, now), default=0),
        "maxLegLoadKg": max_leg_load(trip, now),
    }


def trip_available_kg(trip: Trip, now: datetime) -> int:
    """``offeredKg − maxLegLoad`` (agency ``TripCapacityDTO.availableKg``)."""
    return max(0, offered_kg(trip) - max_leg_load(trip, now))


# ── pure mutators (return a new holds dict) ───────────────────────────────────
def with_hold(
    trip: Trip,
    booking_id: str,
    kg: int,
    i: int,
    j: int,
    due_at: datetime | None,
    now: datetime,
    *,
    state: str = "held",
) -> dict[str, dict[str, Any]]:
    """Place (or replace) a hold. 409 ``insufficient_capacity`` (``details.availableKg``) if it doesn't fit."""
    if kg <= 0:
        raise ValueError("kg must be positive")
    avail = available_kg(trip, i, j, now, exclude=booking_id)
    if avail < kg:
        raise AppError("insufficient_capacity", details={"availableKg": avail})
    holds = holds_of(trip)
    holds[booking_id] = {
        "kg": int(kg),
        "fromIndex": int(i),
        "toIndex": int(j),
        "state": state,
        "dueAt": None if state == "committed" else due_at,
    }
    return holds


def committed(trip: Trip, booking_id: str) -> dict[str, dict[str, Any]]:
    """held → committed (paid): no longer expires."""
    holds = holds_of(trip)
    h = holds.get(booking_id)
    if h is None:
        raise KeyError(booking_id)
    holds[booking_id] = {**h, "state": "committed", "dueAt": None}
    return holds


def released(trip: Trip, booking_id: str) -> dict[str, dict[str, Any]]:
    """Delete a hold (release / consume). Missing ids are a no-op."""
    holds = holds_of(trip)
    holds.pop(booking_id, None)
    return holds


def extended(trip: Trip, booking_id: str, due_at: datetime) -> dict[str, dict[str, Any]]:
    """Move a held hold's ``dueAt`` later (checkout grace); never earlier."""
    holds = holds_of(trip)
    h = holds.get(booking_id)
    if h is None or h.get("state") != "held":
        return holds
    cur = h.get("dueAt")
    holds[booking_id] = {**h, "dueAt": due_at if cur is None or due_at > cur else cur}
    return holds


def can_set_offered(trip: Trip, new_offered: int, now: datetime) -> tuple[bool, int]:
    """``maxLegLoad ≤ offered ≤ vehicleMax`` → (ok, maxLegLoad)."""
    load = max_leg_load(trip, now)
    return load <= new_offered <= vehicle_max_kg(trip), load


# ── invariant (P2 §8.1) ───────────────────────────────────────────────────────
def invariant(trip: Trip, bookings: Iterable[Mapping[str, Any]], now: datetime) -> list[str]:
    """Violations (empty = OK).

    - ``max(leg_loads) ≤ offeredKg ≤ vehicleMaxKg``
    - every hold ↔ a booking with ``reservationStatus`` in {held, committed}, same kg and indices
    - no booking held/committed lacks a hold (except held with ``paymentDueAt ≤ now`` awaiting sweep)
    """
    problems: list[str] = []
    tid = trip.get("id", "?")
    load = max_leg_load(trip, now)
    if load > offered_kg(trip):
        problems.append(f"trip {tid}: max leg load {load} kg > offered {offered_kg(trip)} kg")
    if offered_kg(trip) > vehicle_max_kg(trip):
        problems.append(f"trip {tid}: offered {offered_kg(trip)} kg > vehicle max {vehicle_max_kg(trip)} kg")
    n = leg_count(trip)
    by_id = {b["id"]: b for b in bookings}
    holds = trip.get("holds") or {}
    for hid, h in holds.items():
        if not (0 <= int(h.get("fromIndex", -1)) < int(h.get("toIndex", -1)) <= n):
            problems.append(f"hold {hid}: invalid segment {h.get('fromIndex')}->{h.get('toIndex')}")
        if h.get("state") not in HOLD_STATES:
            problems.append(f"hold {hid}: unknown state {h.get('state')!r}")
        b = by_id.get(hid)
        if b is None:
            problems.append(f"hold {hid} has no booking")
            continue
        rs = b.get("reservationStatus")
        if rs != h.get("state"):
            problems.append(f"hold {hid} is {h.get('state')} but booking reservation is {rs}")
        if int(b.get("weightKg", -1)) != int(h.get("kg", -2)):
            problems.append(f"hold {hid} is {h.get('kg')} kg but booking weighs {b.get('weightKg')} kg")
        pick = (b.get("pickup") or {}).get("checkpointIndex")
        drop = (b.get("drop") or {}).get("checkpointIndex")
        if pick is not None and drop is not None and (pick, drop) != (h.get("fromIndex"), h.get("toIndex")):
            problems.append(f"hold {hid} covers {h.get('fromIndex')}->{h.get('toIndex')} but booking is {pick}->{drop}")
    for b in by_id.values():
        rs = b.get("reservationStatus")
        if rs in HOLD_STATES and b["id"] not in holds:
            due = b.get("paymentDueAt")
            if rs == "held" and due is not None and due <= now:
                continue  # expired unpaid hold awaiting the sweep
            problems.append(f"booking {b['id']} is {rs} without a hold")
    return problems


__all__ = [
    "available_kg",
    "can_set_offered",
    "committed",
    "committed_loads",
    "extended",
    "fits",
    "held_loads",
    "holds_of",
    "invariant",
    "is_active",
    "leg_count",
    "leg_loads",
    "max_leg_load",
    "offered_kg",
    "released",
    "summary",
    "trip_available_kg",
    "vehicle_max_kg",
    "with_hold",
]
