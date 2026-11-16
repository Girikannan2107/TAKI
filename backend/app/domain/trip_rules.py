"""Trip rules (port of ``lib/domain/trip-rules.ts`` + ``core/schedules.ts`` + v3 changes). PURE. Owner: D3.

* ``checkpoint_issues``: structure and timing of the ordered stop list (origin first).
* ``capacity_issues`` / ``goods_issues``: trip vs. vehicle.
* ``additional_charge_issues`` / ``charge_code``: trip additional charges (``pricing.lines``).
* ``publish_timing_problem`` / ``publish_blockers``: publish guards (P2 §7.5).
* schedules: ``interval_for`` / ``overlaps`` / ``find_conflict`` / ``with_interval`` / ``without_trip``
  (busy intervals ``[departure − 60 min, arrival + 60 min]``, P2 §8.3).
* ``next_step`` / ``respond_by``: driver progress and booking deadlines.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from app.data import trip_constants

_T = trip_constants()
MIN_CHECKPOINTS: int = _T["minCheckpoints"]
MAX_CHECKPOINTS: int = _T["maxCheckpoints"]
PUBLISH_MIN_LEAD = timedelta(minutes=_T["publishMinLeadMinutes"])
PUBLISH_MAX_AHEAD = timedelta(days=_T["publishMaxDaysAhead"])
SCHEDULE_BUFFER = timedelta(minutes=_T["scheduleBufferMinutes"])
RESPOND_LEAD = timedelta(minutes=_T["respondLeadMinutes"])
TRIP_START_WINDOW = timedelta(minutes=_T["tripStartWindowMinutes"])
MAX_OPEN_BOOKINGS_PER_TRIP: int = _T["maxBookingsPerTrip"]
MIN_OFFERED_KG = 100
MAX_ADDITIONAL_CHARGES = 5


@dataclass(frozen=True)
class RuleIssue:
    path: str  # dotted path relative to the trip body, e.g. "checkpoints.2.expectedArrivalAt"
    message: str


def issues_to_fields(issues: Iterable[RuleIssue]) -> dict[str, str]:
    out: dict[str, str] = {}
    for i in issues:
        out.setdefault(i.path, i.message)
    return out


# ── Checkpoints ───────────────────────────────────────────────────────────────
def checkpoint_issues(cps: Sequence[Mapping[str, Any]], labels: Sequence[str] | None = None) -> list[RuleIssue]:
    """Each checkpoint: ``{placeId, expectedArrivalAt, expectedDepartureAt}`` (aware datetimes or None).

    - 2..10 stops; consecutive stops differ; no place visited twice;
    - origin needs a departure, destination an arrival, intermediate stops both (arrival ≤ departure);
    - times strictly increase along the route (departure of stop i < arrival at stop i+1).
    """
    issues: list[RuleIssue] = []
    n = len(cps)
    if n < MIN_CHECKPOINTS:
        issues.append(RuleIssue("checkpoints", "Add a source and a destination."))
    if n > MAX_CHECKPOINTS:
        issues.append(
            RuleIssue(
                "checkpoints", f"A trip can have at most {MAX_CHECKPOINTS} stops including source and destination."
            )
        )
    seen: dict[str, int] = {}
    for i, c in enumerate(cps):
        pid = str(c.get("placeId") or "")
        if pid in seen:
            issues.append(RuleIssue(f"checkpoints.{i}.placeId", "This place is already on this route."))
        else:
            seen[pid] = i

    def label(i: int) -> str:
        return labels[i] if labels and i < len(labels) and labels[i] else "this stop"

    last = n - 1
    prev_dep: datetime | None = None
    prev_label = ""
    for i, c in enumerate(cps):
        arr: datetime | None = c.get("expectedArrivalAt")
        dep: datetime | None = c.get("expectedDepartureAt")
        if i == 0:
            if dep is None:
                issues.append(RuleIssue(f"checkpoints.{i}.expectedDepartureAt", "Enter the departure date and time."))
        elif i == last:
            if arr is None:
                issues.append(RuleIssue(f"checkpoints.{i}.expectedArrivalAt", "Enter the arrival date and time."))
        else:
            if arr is None:
                issues.append(
                    RuleIssue(f"checkpoints.{i}.expectedArrivalAt", f"Enter the expected arrival at {label(i)}.")
                )
            if dep is None:
                issues.append(
                    RuleIssue(f"checkpoints.{i}.expectedDepartureAt", f"Enter the expected departure from {label(i)}.")
                )
            if arr is not None and dep is not None and dep < arr:
                issues.append(
                    RuleIssue(
                        f"checkpoints.{i}.expectedDepartureAt",
                        f"Departure from {label(i)} can't be before arriving there.",
                    )
                )
        if i > 0 and arr is not None and prev_dep is not None and arr <= prev_dep:
            issues.append(
                RuleIssue(
                    f"checkpoints.{i}.expectedArrivalAt", f"Arrival at {label(i)} must be after leaving {prev_label}."
                )
            )
        effective_dep = None if i == last else dep
        if effective_dep is not None:
            prev_dep, prev_label = effective_dep, label(i)
        elif arr is not None:
            prev_dep, prev_label = arr, label(i)
    return issues


def capacity_issues(offered_kg: int, vehicle_payload_kg: int) -> list[RuleIssue]:
    issues: list[RuleIssue] = []
    if offered_kg > vehicle_payload_kg:
        issues.append(RuleIssue("offeredKg", f"This vehicle can carry at most {vehicle_payload_kg:,} kg."))
    if offered_kg < MIN_OFFERED_KG:
        issues.append(RuleIssue("offeredKg", "Offer at least 100 kg."))
    return issues


def goods_issues(accepted: Sequence[str], handling: Sequence[str], vehicle: Mapping[str, Any]) -> list[RuleIssue]:
    issues: list[RuleIssue] = []
    if not accepted:
        issues.append(RuleIssue("acceptedGoods", "Choose at least one goods category."))
    vg = set(vehicle.get("acceptedGoods") or [])
    vh = set(vehicle.get("handlingSupported") or [])
    if any(g not in vg for g in accepted):
        issues.append(RuleIssue("acceptedGoods", "Some selected goods are restricted for this vehicle."))
    if any(h not in vh for h in handling):
        issues.append(RuleIssue("handlingSupported", "This vehicle doesn't support some of the selected handling."))
    return issues


# ── Additional charges (pricing.lines "additional") ───────────────────────────
def charge_code(label: str) -> str:
    """Slug of a label: ``"Loading / unloading"`` → ``"loading_unloading"``."""
    s = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s[:40] or "charge"


def additional_charge_issues(charges: Sequence[Mapping[str, Any]]) -> list[RuleIssue]:
    issues: list[RuleIssue] = []
    if len(charges) > MAX_ADDITIONAL_CHARGES:
        issues.append(RuleIssue("additionalCharges", f"Add at most {MAX_ADDITIONAL_CHARGES} additional charges."))
    seen: set[str] = set()
    codes: set[str] = set()
    for i, c in enumerate(charges):
        key = str(c.get("label", "")).strip().lower()
        code = charge_code(str(c.get("label", "")))
        if key in seen or code in codes:
            issues.append(RuleIssue(f"additionalCharges.{i}.label", "Use a different name for each charge."))
        seen.add(key)
        codes.add(code)
    return issues


def normalized_charges(charges: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """API input → stored ``AdditionalCharge`` maps (``code`` derived from the label)."""
    return [
        {
            "code": charge_code(str(c["label"])),
            "label": re.sub(r"\s+", " ", str(c["label"]).strip()),
            "amountRupees": int(c["amountRupees"]),
            "basis": c.get("basis") or "per_booking",
        }
        for c in charges
    ]


# ── Publishing ────────────────────────────────────────────────────────────────
def publish_timing_problem(departure_at: datetime | None, now: datetime) -> tuple[str, str] | None:
    """``(error_code, message)`` or None."""
    if departure_at is None:
        return "invalid_checkpoints", "Enter the departure date and time."
    if departure_at < now + PUBLISH_MIN_LEAD:
        minutes = int(PUBLISH_MIN_LEAD.total_seconds() // 60)
        return "invalid_checkpoints", f"Departure must be at least {minutes} minutes from now to publish."
    if departure_at > now + PUBLISH_MAX_AHEAD:
        return "date_too_far", f"Trips can be published up to {PUBLISH_MAX_AHEAD.days} days ahead."
    return None


@dataclass(frozen=True)
class Readiness:
    agency_verified: bool
    agency_suspended: bool
    vehicle_active: bool
    vehicle_rc_ok: bool
    driver_active: bool
    driver_verified: bool
    route_computed: bool
    maps_configured: bool
    departure_at: datetime | None
    now: datetime


def publish_blockers(r: Readiness) -> list[str]:
    """Human-readable reasons a draft can't be published yet (empty = ready). Server re-checks."""
    out: list[str] = []
    if r.agency_suspended:
        out.append("Agency suspended")
    elif not r.agency_verified:
        out.append("Agency not verified")
    if not r.vehicle_active:
        out.append("The selected vehicle is not active.")
    elif not r.vehicle_rc_ok:
        out.append("Vehicle RC missing")
    if not r.driver_active:
        out.append("The selected driver is not active or not available.")
    elif not r.driver_verified:
        out.append("Driver documents not verified")
    if not r.maps_configured:
        out.append("Maps not configured")
    elif not r.route_computed:
        out.append("Route not computed yet")
    t = publish_timing_problem(r.departure_at, r.now)
    if t:
        out.append(t[1])
    return out


# ── Schedules (P2 §8.3) ───────────────────────────────────────────────────────
def interval_for(trip_id: str, departure_at: datetime, arrival_at: datetime) -> dict[str, Any]:
    return {"tripId": trip_id, "from": departure_at - SCHEDULE_BUFFER, "to": arrival_at + SCHEDULE_BUFFER}


def overlaps(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    return bool(a["from"] < b["to"] and b["from"] < a["to"])


def live_intervals(schedule: Mapping[str, Any] | None, now: datetime) -> list[dict[str, Any]]:
    return sorted((dict(x) for x in (schedule or {}).get("intervals") or [] if x["to"] > now), key=lambda x: x["from"])


def find_conflict(schedule: Mapping[str, Any] | None, iv: Mapping[str, Any], now: datetime) -> dict[str, Any] | None:
    """First live interval of another trip overlapping ``iv``."""
    for x in live_intervals(schedule, now):
        if x["tripId"] != iv["tripId"] and overlaps(x, iv):
            return x
    return None


def with_interval(
    schedule: Mapping[str, Any] | None, kind: str, resource_id: str, iv: Mapping[str, Any], now: datetime
) -> dict[str, Any]:
    keep = [x for x in live_intervals(schedule, now) if x["tripId"] != iv["tripId"]]
    return {
        "id": f"{kind}:{resource_id}",
        "kind": kind,
        "resourceId": resource_id,
        "intervals": sorted([*keep, dict(iv)], key=lambda x: x["from"]),
        "updatedAt": now,
    }


def without_trip(
    schedule: Mapping[str, Any] | None, kind: str, resource_id: str, trip_id: str, now: datetime
) -> dict[str, Any]:
    keep = [x for x in live_intervals(schedule, now) if x["tripId"] != trip_id]
    return {"id": f"{kind}:{resource_id}", "kind": kind, "resourceId": resource_id, "intervals": keep, "updatedAt": now}


# ── Progress / deadlines ──────────────────────────────────────────────────────
def next_step(checkpoints: Sequence[Mapping[str, Any]]) -> dict[str, Any] | None:
    """The next driver step (``{"kind": "arrive"|"depart", "index"}``), or None when finished."""
    last = len(checkpoints) - 1
    for i, c in enumerate(checkpoints):
        if i > 0 and not c.get("actualArrivalAt"):
            return {"kind": "arrive", "index": i}
        if i < last and not c.get("actualDepartureAt"):
            return {"kind": "depart", "index": i}
    return None


def respond_by(pickup_departure_at: datetime) -> datetime:
    """Latest instant an agency can accept (and a customer request) a booking from this pickup."""
    return pickup_departure_at - RESPOND_LEAD


def route_label(checkpoints: Sequence[Mapping[str, Any]]) -> str:
    if not checkpoints:
        return ""
    first = (checkpoints[0].get("place") or {}).get("name", "")
    last = (checkpoints[-1].get("place") or {}).get("name", "")
    return f"{first} → {last}"


def suggested_times(
    departure_at: datetime, leg_minutes: Sequence[int], dwell_minutes: int
) -> list[tuple[datetime | None, datetime | None]]:
    """``(arrival, departure)`` per stop from leg durations plus a dwell at intermediate stops."""
    out: list[tuple[datetime | None, datetime | None]] = [(None, departure_at)]
    t = departure_at
    n = len(leg_minutes) + 1
    for k, m in enumerate(leg_minutes):
        arr = t + timedelta(minutes=int(m))
        is_last = k + 1 == n - 1
        dep = None if is_last else arr + timedelta(minutes=dwell_minutes)
        out.append((arr, dep))
        t = dep or arr
    return out
