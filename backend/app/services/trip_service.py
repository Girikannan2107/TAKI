"""Agency trips (contract E69–E79; P2 §7.5, §8, §9). Owner: D3.

Drafts → publish → (driver: D4 tracking) → completed, or cancel. Every command that touches
schedules, capacity or bookings runs in ONE Firestore transaction with all reads before writes:

* publish / reassign / edits of a published trip read ``schedules/driver:{id}`` and
  ``schedules/vehicle:{id}`` inside the transaction, so concurrent assignments of the same driver or
  vehicle serialise; overlaps fail with 409 ``*_schedule_conflict`` (``details.conflictingTripId``);
* booking state changes on cancel / reassign are delegated to D4's ``booking_service``
  (``load_trip_bookings`` → ``close_for_trip_cancel`` / ``fan_out_driver``); this module writes the
  trip document once per transaction.

Routes come from D5's Maps integration (``get_maps().compute_route``): legs, durations and the
encoded polyline are computed once per stop list and stored on the trip. Published trips carry
``searchKeys`` (geohash-4 cells + neighbours of every pickup-capable stop, keyed by IST date).

D4 hooks (tracking ``complete``): :func:`tx_read_schedules` (READ) and :func:`tx_release_schedules` (WRITE).
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.core.config import get_settings
from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.ids import new_id
from app.data import pricing as pricing_data
from app.domain import capacity
from app.domain.geo import search_keys
from app.domain.trip_rules import (
    Readiness,
    RuleIssue,
    additional_charge_issues,
    capacity_issues,
    checkpoint_issues,
    find_conflict,
    goods_issues,
    interval_for,
    issues_to_fields,
    next_step,
    normalized_charges,
    publish_blockers,
    publish_timing_problem,
    route_label,
    suggested_times,
    with_interval,
    without_trip,
)
from app.repositories import agencies as agencies_repo
from app.repositories import drivers as drivers_repo
from app.repositories import schedules as schedules_repo
from app.repositories import trips as trips_repo
from app.repositories import users as users_repo
from app.repositories import vehicles as vehicles_repo
from app.repositories.base import C, col, commit_in_batches, run_transaction, tx_query
from app.repositories.collections import ScheduleKind
from app.schemas.agency import (
    AgencyTripDTO,
    EarningsPreviewDTO,
    PreviewCheckpointDTO,
    TripBody,
    TripFormDriverOption,
    TripFormOptionsDTO,
    TripFormVehicleOption,
    TripListResponse,
    TripPatchBody,
    TripPreviewBody,
    TripPreviewDTO,
    TripTabCounts,
)
from app.services.agency_service import (
    actor_of,
    agency_id_of,
    assert_not_suspended,
    assert_verified,
    load_agency,
    verification_of,
)
from app.services.vehicle_service import rc_ok
from app.views import agency as views

log = logging.getLogger("taki.trips")

DEFAULT_RATES: dict[str, int] = dict(pricing_data()["defaultRates"])
TAB_STATUSES: dict[str, list[str]] = {
    "upcoming": ["published"],
    "active": ["in_progress"],
    "completed": ["completed"],
    "cancelled": ["cancelled"],
    "drafts": ["draft"],
}
OPEN_BOOKING_STATUSES = [
    "awaiting_agency",
    "pending_payment",
    "payment_failed",
    "confirmed",
    "picked_up",
    "in_transit",
    "out_for_delivery",
]
PICKED_UP_OR_LATER = {"picked_up", "in_transit", "out_for_delivery", "delivered"}


# ═══════════════════════════════ helpers ═══════════════════════════════
def _invalid(issues: Sequence[RuleIssue], code: str = "invalid_request") -> AppError:
    return AppError(code, issues[0].message if issues else None, fields=issues_to_fields(issues))


def _maps() -> Any:
    from app.integrations.maps import get_maps

    return get_maps()


def _event(type_: str, user: CurrentUser | None, now: datetime, **extra: Any) -> dict[str, Any]:
    return {
        "id": new_id("tev"),
        "type": type_,
        "checkpointIndex": extra.get("checkpoint_index"),
        "at": now,
        "clientAt": None,
        "actor": actor_of(user) if user else {"role": "system", "userId": None},
        "remarks": extra.get("remarks"),
    }


def _notify(tx: AsyncTransaction, **kw: Any) -> None:
    from app.services import notification_service

    notification_service.notify(tx, **kw)


def _vehicle_snap(v: dict[str, Any]) -> dict[str, Any]:
    photos = v.get("photos") or []
    return {
        "vehicleClass": v["vehicleClass"],
        "makeModel": v.get("makeModel", ""),
        "registrationNumber": v.get("registrationNumber", ""),
        "bodyType": v.get("bodyType", ""),
        "photo": photos[0] if photos else None,
        "imageKey": v.get("imageKey", ""),
    }


def _driver_snap(d: dict[str, Any]) -> dict[str, Any]:
    stats = d.get("stats") or {}
    return {
        "fullName": d.get("fullName", ""),
        "photo": d.get("photo"),
        "ratingAvg": stats.get("ratingAvg", 0),
        "ratingCount": stats.get("ratingCount", 0),
    }


def _when(dt: datetime | None) -> str:
    return dt.isoformat() if dt else "soon"


def _driver_ok(driver: dict[str, Any] | None, agency_id: str) -> bool:
    link = (driver or {}).get("agencyLink") or {}
    return bool(driver) and link.get("agencyId") == agency_id and link.get("status") == "active"


def _driver_verified(driver: dict[str, Any] | None) -> bool:
    return not get_settings().REQUIRE_DRIVER_VERIFICATION or verification_of(driver) == "verified"


# ── Places and routes (D5 Maps) ───────────────────────────────────────────────
async def resolve_places(place_ids: Sequence[str]) -> list[dict[str, Any]]:
    """Google place ids → ``PlaceRef`` maps; 422 ``outside_service_area`` with the stop's field path."""
    from app.integrations.maps.place_resolver import place_ref

    maps = _maps()
    states = get_settings().SERVICE_STATES
    out: list[dict[str, Any]] = []
    for i, pid in enumerate(place_ids):
        try:
            p = await maps.geocode_place_id(pid)
        except AppError as e:
            if e.code == "address_not_found":
                raise AppError(
                    "address_not_found", fields={f"checkpoints.{i}.placeId": "Choose a place from the list"}
                ) from e
            raise
        if not p.in_service_area(states):
            raise AppError(
                "outside_service_area", fields={f"checkpoints.{i}.placeId": "This place is outside our service area"}
            )
        out.append(place_ref(p))
    return out


async def compute_route(
    places: Sequence[dict[str, Any]], now: datetime
) -> tuple[list[dict[str, Any]], dict[str, Any], list[float]]:
    """``(legs, route, kmFromOrigin per stop)`` from Routes ``computeRoutes`` (cached by D5)."""
    from app.integrations.maps import Waypoint

    maps = _maps()
    r = await maps.compute_route([Waypoint(place_id=p["placeId"]) for p in places])
    legs = [
        {"index": leg.index, "distanceKm": leg.distance_km, "durationMin": leg.duration_min, "polyline": leg.polyline}
        for leg in r.legs
    ]
    route = {
        "distanceKm": r.distance_km,
        "durationMin": r.duration_min,
        "overviewPolyline": r.polyline,
        "computedAt": now,
        "source": "fake" if getattr(maps, "is_fake", False) else "google_routes",
    }
    return legs, route, r.km_from_origin()


# ── D4 booking hooks (lazy; fallbacks until booking_service provides them) ────
@dataclass
class _FallbackTripBookings:
    bookings: list[dict[str, Any]] = field(default_factory=list)

    @property
    def has_picked_up(self) -> bool:
        return any(
            b.get("status") in PICKED_UP_OR_LATER or b.get("fulfilmentStatus") not in (None, "not_started")
            for b in self.bookings
        )


def _booking_service() -> Any:
    try:
        from app.services import booking_service
    except ImportError:
        return None
    return booking_service


async def _load_trip_bookings(tx: AsyncTransaction, trip_id: str, now: datetime) -> Any:
    svc = _booking_service()
    fn = getattr(svc, "load_trip_bookings", None) if svc else None
    if fn is not None:
        return await fn(tx, trip_id, now=now)
    q = (
        col(C.bookings)
        .where(filter=FieldFilter("tripId", "==", trip_id))
        .where(filter=FieldFilter("status", "in", OPEN_BOOKING_STATUSES))
        .limit(60)
    )
    return _FallbackTripBookings(await tx_query(tx, q))


def _open_bookings(tb: Any) -> list[dict[str, Any]]:
    return list(getattr(tb, "bookings", None) or [])


# ── Schedules ─────────────────────────────────────────────────────────────────
Key = tuple[ScheduleKind, str]


async def _tx_schedules(tx: AsyncTransaction, keys: Iterable[Key]) -> dict[Key, dict[str, Any] | None]:
    uniq = list(dict.fromkeys(keys))
    docs = await schedules_repo.tx_get_schedules(tx, uniq)
    return dict(zip(uniq, docs, strict=True))


def _check_conflicts(scheds: dict[Key, Any], trip: dict[str, Any], now: datetime) -> None:
    iv = interval_for(trip["id"], trip["departureAt"], trip["arrivalAt"])
    dc = find_conflict(scheds.get(("driver", trip["driverId"])), iv, now)
    if dc:
        raise AppError(
            "driver_schedule_conflict",
            fields={"driverId": "This driver is on another trip during this time"},
            details={"conflictingTripId": dc["tripId"]},
        )
    vc = find_conflict(scheds.get(("vehicle", trip["vehicleId"])), iv, now)
    if vc:
        raise AppError(
            "vehicle_schedule_conflict",
            fields={"vehicleId": "This vehicle is on another trip during this time"},
            details={"conflictingTripId": vc["tripId"]},
        )


def _write_schedules(
    tx: AsyncTransaction, scheds: dict[Key, Any], trip_id: str, add: dict[str, Any] | None, now: datetime
) -> None:
    """Remove ``trip_id`` from every loaded schedule; add it back to the trip's own driver/vehicle
    when ``add`` (the published trip) is given. One write per schedule document."""
    targets: set[Key] = set()
    if add is not None:
        targets = {("driver", add["driverId"]), ("vehicle", add["vehicleId"])}
    iv = interval_for(trip_id, add["departureAt"], add["arrivalAt"]) if add is not None else None
    for (kind, rid), doc in scheds.items():
        if (kind, rid) in targets and iv is not None:
            schedules_repo.tx_set(tx, with_interval(doc, kind, rid, iv, now))
        elif doc is not None and any(x.get("tripId") == trip_id for x in doc.get("intervals") or []):
            schedules_repo.tx_set(tx, without_trip(doc, kind, rid, trip_id, now))


@dataclass
class TripSchedules:
    docs: dict[Key, dict[str, Any] | None]


async def tx_read_schedules(tx: AsyncTransaction, trip: dict[str, Any]) -> TripSchedules:
    """READ (D4 tracking ``complete``): the trip's driver and vehicle schedule documents."""
    return TripSchedules(await _tx_schedules(tx, [("driver", trip["driverId"]), ("vehicle", trip["vehicleId"])]))


def tx_release_schedules(tx: AsyncTransaction, trip: dict[str, Any], schedules: TripSchedules, now: datetime) -> None:
    """WRITE (D4 tracking ``complete``): remove this trip's busy intervals."""
    _write_schedules(tx, schedules.docs, trip["id"], None, now)


# ═══════════════════════════════ building drafts ═══════════════════════════════
@dataclass
class _Draft:
    vehicle_id: str
    driver_id: str
    offered_kg: int
    checkpoints: list[dict[str, Any]]  # {placeId, serviceRadiusKm, expectedArrivalAt, expectedDepartureAt}
    accepted_goods: list[str]
    handling_supported: list[str]
    max_package_kg: int | None
    goods_notes: str | None
    rate_per_km_paise: int
    rate_per_kg_paise: int
    additional_charges: list[dict[str, Any]]
    max_capacity_kg: int | None = None


def _cp_inputs(cps: Iterable[Any]) -> list[dict[str, Any]]:
    return [
        {
            "placeId": c.place_id,
            "serviceRadiusKm": float(c.service_radius_km),
            "expectedArrivalAt": c.expected_arrival_at,
            "expectedDepartureAt": c.expected_departure_at,
        }
        for c in cps
    ]


def _draft_from_body(body: TripBody) -> _Draft:
    return _Draft(
        vehicle_id=body.vehicle_id,
        driver_id=body.driver_id,
        offered_kg=body.offered_kg,
        checkpoints=_cp_inputs(body.checkpoints),
        accepted_goods=list(body.accepted_goods),
        handling_supported=list(body.handling_supported),
        max_package_kg=body.max_package_kg,
        goods_notes=body.goods_notes,
        rate_per_km_paise=body.rate_per_km_paise if body.rate_per_km_paise is not None else DEFAULT_RATES["perKmPaise"],
        rate_per_kg_paise=body.rate_per_kg_paise if body.rate_per_kg_paise is not None else DEFAULT_RATES["perKgPaise"],
        additional_charges=[c.model_dump(by_alias=True) for c in body.additional_charges],
        max_capacity_kg=body.max_capacity_kg,
    )


def _draft_from_trip(t: dict[str, Any]) -> _Draft:
    goods = t.get("goods") or {}
    rates = t.get("rates") or {}
    return _Draft(
        vehicle_id=t["vehicleId"],
        driver_id=t["driverId"],
        offered_kg=int((t.get("capacity") or {}).get("offeredKg", 0)),
        checkpoints=[
            {
                "placeId": (c.get("place") or {}).get("placeId", ""),
                "serviceRadiusKm": float(c.get("serviceRadiusKm", 10)),
                "expectedArrivalAt": c.get("expectedArrivalAt"),
                "expectedDepartureAt": c.get("expectedDepartureAt"),
            }
            for c in t.get("checkpoints") or []
        ],
        accepted_goods=list(goods.get("accepted") or []),
        handling_supported=list(goods.get("handlingSupported") or []),
        max_package_kg=goods.get("maxPackageKg"),
        goods_notes=goods.get("notes"),
        rate_per_km_paise=int(rates.get("perKmPaise", DEFAULT_RATES["perKmPaise"])),
        rate_per_kg_paise=int(rates.get("perKgPaise", DEFAULT_RATES["perKgPaise"])),
        additional_charges=[
            {"label": c["label"], "amountRupees": c["amountRupees"], "basis": c.get("basis", "per_booking")}
            for c in t.get("additionalCharges") or []
        ],
    )


def _merge_patch(d: _Draft, p: TripPatchBody) -> _Draft:
    f = p.model_fields_set
    return _Draft(
        vehicle_id=p.vehicle_id if p.vehicle_id else d.vehicle_id,
        driver_id=p.driver_id if p.driver_id else d.driver_id,
        offered_kg=p.offered_kg if p.offered_kg is not None else d.offered_kg,
        checkpoints=_cp_inputs(p.checkpoints) if p.checkpoints is not None else d.checkpoints,
        accepted_goods=list(p.accepted_goods) if p.accepted_goods is not None else d.accepted_goods,
        handling_supported=list(p.handling_supported) if p.handling_supported is not None else d.handling_supported,
        max_package_kg=p.max_package_kg if "max_package_kg" in f else d.max_package_kg,
        goods_notes=p.goods_notes if "goods_notes" in f else d.goods_notes,
        rate_per_km_paise=p.rate_per_km_paise if p.rate_per_km_paise is not None else d.rate_per_km_paise,
        rate_per_kg_paise=p.rate_per_kg_paise if p.rate_per_kg_paise is not None else d.rate_per_kg_paise,
        additional_charges=[c.model_dump(by_alias=True) for c in p.additional_charges]
        if p.additional_charges is not None
        else d.additional_charges,
        max_capacity_kg=p.max_capacity_kg,
    )


async def _owned_vehicle(agency_id: str, vehicle_id: str) -> dict[str, Any]:
    v = await vehicles_repo.get(vehicle_id)
    if not v or v.get("agencyId") != agency_id or v.get("status") == "removed":
        raise AppError("not_found", "Choose one of your vehicles.", fields={"vehicleId": "Choose one of your vehicles"})
    return v


async def _linked_driver(agency_id: str, driver_id: str) -> dict[str, Any]:
    d = await drivers_repo.get(driver_id)
    if not d or (d.get("agencyLink") or {}).get("agencyId") != agency_id:
        raise AppError("not_found", "Choose one of your drivers.", fields={"driverId": "Choose one of your drivers"})
    return d


def _validate(d: _Draft, vehicle: dict[str, Any], driver: dict[str, Any]) -> None:
    cp_issues = checkpoint_issues(d.checkpoints)
    if cp_issues:
        raise _invalid(cp_issues, "invalid_checkpoints")
    issues: list[RuleIssue] = []
    if vehicle.get("status") != "active":
        issues.append(RuleIssue("vehicleId", "This vehicle is inactive. Activate it or choose another."))
    link = driver.get("agencyLink") or {}
    if link.get("status") != "active":
        issues.append(RuleIssue("driverId", "Only approved drivers can be assigned."))
    elif driver.get("availability") != "available":
        issues.append(RuleIssue("driverId", f"{driver.get('fullName', 'This driver')} is marked unavailable."))
    payload = int(vehicle.get("maxPayloadKg", 0))
    if d.max_capacity_kg is not None and d.max_capacity_kg > payload:
        raise _invalid(
            [RuleIssue("maxCapacityKg", f"This vehicle can carry at most {payload:,} kg.")], "capacity_exceeds_vehicle"
        )
    cap = capacity_issues(d.offered_kg, payload)
    if cap and d.offered_kg > payload:
        raise _invalid(cap, "capacity_exceeds_vehicle")
    if d.max_capacity_kg is not None and d.offered_kg > d.max_capacity_kg:
        issues.append(RuleIssue("offeredKg", "Capacity for booking can't be more than the trip's maximum capacity."))
    issues += cap
    issues += goods_issues(d.accepted_goods, d.handling_supported, vehicle)
    issues += additional_charge_issues(d.additional_charges)
    if d.max_package_kg is not None and d.max_package_kg > d.offered_kg:
        issues.append(RuleIssue("maxPackageKg", "A single package can't be heavier than the capacity offered."))
    if issues:
        raise _invalid(issues)


def _same_stops(d: _Draft, t: dict[str, Any] | None) -> bool:
    if not t:
        return False
    cur = [(c.get("place") or {}).get("placeId") for c in t.get("checkpoints") or []]
    return cur == [c["placeId"] for c in d.checkpoints] and len(t.get("legs") or []) == len(cur) - 1


async def _build_trip(
    trip_id: str,
    prev: dict[str, Any] | None,
    d: _Draft,
    agency: dict[str, Any],
    vehicle: dict[str, Any],
    driver: dict[str, Any],
    now: datetime,
) -> dict[str, Any]:
    _validate(d, vehicle, driver)
    if prev is not None and _same_stops(d, prev):
        places = [c["place"] for c in prev["checkpoints"]]
        legs, route = prev["legs"], prev["route"]
        kms = [float(c.get("kmFromOrigin", 0)) for c in prev["checkpoints"]]
    else:
        places = await resolve_places([c["placeId"] for c in d.checkpoints])
        legs, route, kms = await compute_route(places, now)
    last = len(d.checkpoints) - 1
    checkpoints = [
        {
            "index": i,
            "place": places[i],
            "serviceRadiusKm": c["serviceRadiusKm"],
            "kmFromOrigin": kms[i],
            "expectedArrivalAt": None if i == 0 else c["expectedArrivalAt"],
            "expectedDepartureAt": None if i == last else c["expectedDepartureAt"],
            "actualArrivalAt": None,
            "actualDepartureAt": None,
        }
        for i, c in enumerate(d.checkpoints)
    ]
    labels = [p.get("name", "") for p in places]
    issues = checkpoint_issues([{**c, "placeId": places[i]["placeId"]} for i, c in enumerate(d.checkpoints)], labels)
    if issues:  # Google may map two inputs to the same place id
        raise _invalid(issues, "invalid_checkpoints")
    base = prev or {}
    trip: dict[str, Any] = {
        "id": trip_id,
        "agencyId": agency["id"],
        "agencyName": agency.get("agencyName", ""),
        "vehicleId": vehicle["id"],
        "vehicle": _vehicle_snap(vehicle),
        "driverId": driver["id"],
        "driver": _driver_snap(driver),
        "status": base.get("status", "draft"),
        "checkpoints": checkpoints,
        "legs": legs,
        "route": route,
        "departureAt": checkpoints[0]["expectedDepartureAt"],
        "arrivalAt": checkpoints[-1]["expectedArrivalAt"],
        "capacity": {"vehicleMaxKg": int(vehicle["maxPayloadKg"]), "offeredKg": d.offered_kg},
        "holds": base.get("holds") or {},
        "capacitySummary": base.get("capacitySummary")
        or {"committedKgMaxLeg": 0, "heldKgMaxLeg": 0, "maxLegLoadKg": 0},
        "goods": {
            "accepted": d.accepted_goods,
            "handlingSupported": d.handling_supported,
            "maxPackageKg": d.max_package_kg,
            "notes": d.goods_notes,
        },
        "rates": {"perKmPaise": d.rate_per_km_paise, "perKgPaise": d.rate_per_kg_paise},
        "additionalCharges": normalized_charges(d.additional_charges),
        "searchKeys": base.get("searchKeys") or [],
        "progress": {"lastCheckpointIndex": None, "lastEventAt": None, "nextStep": next_step(checkpoints)},
        "counts": base.get("counts") or {"awaiting": 0, "held": 0, "committed": 0, "delivered": 0},
        "publishedAt": base.get("publishedAt"),
        "startedAt": None,
        "completedAt": None,
        "cancelledAt": None,
        "cancelReason": None,
        "createdAt": base.get("createdAt", now),
        "updatedAt": now,
        "version": int(base.get("version", 0)) + 1,
    }
    return trip


# ═══════════════════════════════ publish guards (inside tx) ═══════════════════════════════
@dataclass
class _Ctx:
    agency: dict[str, Any] | None
    vehicle: dict[str, Any] | None
    driver: dict[str, Any] | None
    driver_user: dict[str, Any] | None


async def _tx_ctx(tx: AsyncTransaction, trip: dict[str, Any]) -> _Ctx:
    return _Ctx(
        agency=await agencies_repo.tx_get_agency(tx, trip["agencyId"]),
        vehicle=await vehicles_repo.tx_get_vehicle(tx, trip["vehicleId"]),
        driver=await drivers_repo.tx_get_driver(tx, trip["driverId"]),
        driver_user=await users_repo.tx_get_user(tx, trip["driverId"]),
    )


def _assert_assignment(trip: dict[str, Any], ctx: _Ctx, now: datetime) -> None:
    """Vehicle active (+RC), driver linked + available + verified + account active, capacity fits."""
    v = ctx.vehicle
    if not v or v.get("agencyId") != trip["agencyId"] or v.get("status") != "active":
        raise AppError("vehicle_unavailable", fields={"vehicleId": "This vehicle is not active"})
    if not rc_ok(v):
        raise AppError("vehicle_documents_missing", fields={"vehicleId": "Upload this vehicle's RC"})
    if not _driver_ok(ctx.driver, trip["agencyId"]):
        raise AppError(
            "driver_unavailable", "This driver isn't linked to your agency.", fields={"driverId": "Not linked"}
        )
    if (ctx.driver or {}).get("availability") != "available" or (ctx.driver_user or {}).get("status") != "active":
        raise AppError("driver_unavailable", fields={"driverId": "This driver is not available"})
    if not _driver_verified(ctx.driver):
        raise AppError("driver_not_verified", fields={"driverId": "Documents not verified yet"})
    payload = int(v.get("maxPayloadKg", 0))
    offered = capacity.offered_kg(trip)
    if offered > payload:
        raise AppError("capacity_exceeds_vehicle", fields={"offeredKg": f"At most {payload:,} kg on this vehicle"})
    if capacity.max_leg_load(trip, now) > payload:
        raise AppError(
            "capacity_exceeds_vehicle",
            "The new vehicle is smaller than what is already booked on this trip.",
            fields={"vehicleId": "Too small for the current bookings"},
        )


def _assert_publishable(trip: dict[str, Any], ctx: _Ctx, now: datetime) -> None:
    if not ctx.agency:
        raise AppError("not_found")
    assert_verified(ctx.agency, "Your agency must be verified before you can publish trips.")
    _assert_assignment(trip, ctx, now)
    issues = checkpoint_issues(
        [
            {
                "placeId": (c.get("place") or {}).get("placeId"),
                "expectedArrivalAt": c.get("expectedArrivalAt"),
                "expectedDepartureAt": c.get("expectedDepartureAt"),
            }
            for c in trip["checkpoints"]
        ],
        [views.place_name(c) for c in trip["checkpoints"]],
    )
    if issues:
        raise _invalid(issues, "invalid_checkpoints")
    if len(trip.get("legs") or []) != len(trip["checkpoints"]) - 1 or not trip.get("route"):
        raise AppError("maps_not_configured", "The route hasn't been computed yet.")
    timing = publish_timing_problem(trip.get("departureAt"), now)
    if timing:
        raise AppError(timing[0], timing[1], fields={"checkpoints.0.expectedDepartureAt": timing[1]})


def _published_fields(trip: dict[str, Any], ctx: _Ctx, now: datetime) -> dict[str, Any]:
    if not (ctx.agency and ctx.vehicle and ctx.driver):
        raise AppError("not_found")
    return {
        "status": "published",
        "publishedAt": trip.get("publishedAt") or now,
        "agencyName": ctx.agency.get("agencyName", ""),
        "searchKeys": search_keys(trip["checkpoints"]),
        "vehicle": _vehicle_snap(ctx.vehicle),
        "driver": _driver_snap(ctx.driver),
        "capacity": {**trip["capacity"], "vehicleMaxKg": int(ctx.vehicle["maxPayloadKg"])},
    }


def _bumped(trip: dict[str, Any], now: datetime, **patch: Any) -> dict[str, Any]:
    return {**trip, **patch, "updatedAt": now, "version": int(trip.get("version", 1)) + 1}


# ═══════════════════════════════ commands ═══════════════════════════════
async def create_trip(user: CurrentUser, body: TripBody, now: datetime) -> AgencyTripDTO:
    agency_id = agency_id_of(user)
    agency = await load_agency(agency_id)
    assert_not_suspended(agency)
    if body.publish:
        missing = {
            k: "Enter your rate"
            for k, v in (("ratePerKmPaise", body.rate_per_km_paise), ("ratePerKgPaise", body.rate_per_kg_paise))
            if v is None
        }
        if missing:
            raise AppError("invalid_request", "Enter your rates to publish.", fields=missing)
        assert_verified(agency, "Your agency must be verified before you can publish trips. Save it as a draft.")
    d = _draft_from_body(body)
    vehicle = await _owned_vehicle(agency_id, d.vehicle_id)
    driver = await _linked_driver(agency_id, d.driver_id)
    trip = await _build_trip(new_id("trp"), None, d, agency, vehicle, driver, now)

    async def _tx(tx: AsyncTransaction) -> None:
        trips_repo.tx_create(tx, trip)

    await run_transaction(_tx)
    if body.publish:
        try:
            await _publish(user, trip["id"], now)
        except AppError as e:
            e.details = {**(e.details or {}), "tripId": trip["id"]}
            raise
    return await get_trip(user, trip["id"], now)


SAFE_PUBLISHED = {
    "rate_per_km_paise",
    "rate_per_kg_paise",
    "additional_charges",
    "max_package_kg",
    "goods_notes",
    "offered_kg",
    "max_capacity_kg",
}


def _locked_changes(t: dict[str, Any], p: TripPatchBody) -> list[str]:
    """Patch fields that change something not editable on a published trip (route, times, vehicle, goods)."""
    out: list[str] = []
    if p.vehicle_id and p.vehicle_id != t["vehicleId"]:
        out.append("vehicleId")
    if p.checkpoints is not None:
        cur = _draft_from_trip(t).checkpoints
        new = _cp_inputs(p.checkpoints)
        last = len(new) - 1

        def eq(a: datetime | None, b: datetime | None) -> bool:
            return (a is None and b is None) or (a is not None and b is not None and a == b)

        same = len(new) == len(cur) and all(
            n["placeId"] == c["placeId"]
            and n["serviceRadiusKm"] == c["serviceRadiusKm"]
            and (i == 0 or eq(n["expectedArrivalAt"], c["expectedArrivalAt"]))
            and (i == last or eq(n["expectedDepartureAt"], c["expectedDepartureAt"]))
            for i, (n, c) in enumerate(zip(new, cur, strict=False))
        )
        if not same:
            out.append("checkpoints")
    goods = t.get("goods") or {}
    if p.accepted_goods is not None and set(p.accepted_goods) != set(goods.get("accepted") or []):
        out.append("acceptedGoods")
    if p.handling_supported is not None and set(p.handling_supported) != set(goods.get("handlingSupported") or []):
        out.append("handlingSupported")
    return out


async def update_trip(user: CurrentUser, trip_id: str, patch: TripPatchBody, now: datetime) -> AgencyTripDTO:
    agency_id = agency_id_of(user)
    agency = await load_agency(agency_id)
    assert_not_suspended(agency)
    current = await _owned_trip(agency_id, trip_id)
    status = current["status"]

    if status == "draft":
        d = _merge_patch(_draft_from_trip(current), patch)
        vehicle = await _owned_vehicle(agency_id, d.vehicle_id)
        driver = await _linked_driver(agency_id, d.driver_id)
        built = await _build_trip(trip_id, current, d, agency, vehicle, driver, now)

        async def _tx(tx: AsyncTransaction) -> None:
            fresh = await trips_repo.tx_get_trip(tx, trip_id)
            if not fresh or fresh.get("agencyId") != agency_id:
                raise AppError("not_found")
            if fresh["status"] != "draft":
                raise AppError("conflict", "This trip was published or cancelled meanwhile. Refresh and try again.")
            trips_repo.tx_set(tx, {**built, "version": int(fresh.get("version", 1)) + 1})

        await run_transaction(_tx)
        return await get_trip(user, trip_id, now)

    if status != "published":
        raise AppError("invalid_transition", "This trip can no longer be edited.")

    if patch.driver_id and patch.driver_id != current["driverId"] and not patch.vehicle_id:
        await reassign(user, trip_id, patch.driver_id, None, now)
        current = await _owned_trip(agency_id, trip_id)
    locked = _locked_changes(current, patch)
    if locked:
        await _edit_published_structure(user, current, patch, now)
    elif patch.model_fields_set & SAFE_PUBLISHED:
        await _edit_published_safe(user, trip_id, patch, now)
    return await get_trip(user, trip_id, now)


async def _edit_published_safe(user: CurrentUser, trip_id: str, patch: TripPatchBody, now: datetime) -> None:
    """Rates, additional charges, package limit, notes (new requests only) and offered capacity."""
    agency_id = agency_id_of(user)
    f = patch.model_fields_set
    if patch.additional_charges is not None:
        issues = additional_charge_issues([c.model_dump(by_alias=True) for c in patch.additional_charges])
        if issues:
            raise _invalid(issues)

    async def _tx(tx: AsyncTransaction) -> None:
        t = await trips_repo.tx_get_trip(tx, trip_id)
        if not t or t.get("agencyId") != agency_id:
            raise AppError("not_found")
        if t["status"] != "published":
            raise AppError("invalid_transition", "This trip can no longer be edited.")
        update: dict[str, Any] = {}
        if patch.max_capacity_kg is not None:
            if patch.max_capacity_kg > capacity.vehicle_max_kg(t):
                raise AppError(
                    "capacity_exceeds_vehicle",
                    fields={"maxCapacityKg": f"At most {capacity.vehicle_max_kg(t):,} kg on this vehicle"},
                )
            offered = patch.offered_kg if patch.offered_kg is not None else capacity.offered_kg(t)
            if offered > patch.max_capacity_kg:
                msg = "Capacity for booking can't be more than the trip's maximum capacity."
                raise AppError("invalid_request", msg, fields={"offeredKg": msg})
        if patch.offered_kg is not None:
            ok, load = capacity.can_set_offered(t, patch.offered_kg, now)
            if patch.offered_kg > capacity.vehicle_max_kg(t):
                raise AppError(
                    "capacity_exceeds_vehicle",
                    fields={"offeredKg": f"At most {capacity.vehicle_max_kg(t):,} kg on this trip"},
                )
            if not ok:
                raise AppError(
                    "capacity_below_booked",
                    f"{load:,} kg is already booked or reserved on the busiest leg.",
                    fields={"offeredKg": f"At least {load:,} kg"},
                    details={"maxLegLoadKg": load},
                )
            update["capacity.offeredKg"] = patch.offered_kg
            update["capacitySummary"] = capacity.summary(
                {**t, "capacity": {**t["capacity"], "offeredKg": patch.offered_kg}}, now
            )
        if patch.rate_per_km_paise is not None:
            update["rates.perKmPaise"] = patch.rate_per_km_paise
        if patch.rate_per_kg_paise is not None:
            update["rates.perKgPaise"] = patch.rate_per_kg_paise
        if patch.additional_charges is not None:
            update["additionalCharges"] = normalized_charges(
                [c.model_dump(by_alias=True) for c in patch.additional_charges]
            )
        if "max_package_kg" in f:
            update["goods.maxPackageKg"] = patch.max_package_kg
        if "goods_notes" in f:
            update["goods.notes"] = patch.goods_notes
        if not update:
            return
        trips_repo.tx_update(tx, trip_id, {**update, "updatedAt": now, "version": int(t.get("version", 1)) + 1})

    await run_transaction(_tx)


def _has_bookings(t: dict[str, Any], tb: Any) -> bool:
    c = t.get("counts") or {}
    return bool(
        _open_bookings(tb)
        or (t.get("holds") or {})
        or int(c.get("awaiting", 0)) + int(c.get("held", 0)) + int(c.get("committed", 0)) > 0
    )


async def _edit_published_structure(
    user: CurrentUser, current: dict[str, Any], patch: TripPatchBody, now: datetime
) -> None:
    """Route / time / vehicle / goods edits on a published trip: only with no bookings at all, and
    re-checked like a publish (schedules, guards, search keys) in one transaction."""
    agency_id = agency_id_of(user)
    c = current.get("counts") or {}
    if (current.get("holds") or {}) or int(c.get("awaiting", 0)) + int(c.get("held", 0)) + int(c.get("committed", 0)):
        raise AppError("trip_has_bookings", "Unpublish isn't possible while the trip has bookings.")
    agency = await load_agency(agency_id)
    d = _merge_patch(_draft_from_trip(current), patch)
    vehicle = await _owned_vehicle(agency_id, d.vehicle_id)
    driver = await _linked_driver(agency_id, d.driver_id)
    built = await _build_trip(current["id"], current, d, agency, vehicle, driver, now)

    async def _tx(tx: AsyncTransaction) -> None:
        t = await trips_repo.tx_get_trip(tx, current["id"])
        if not t or t.get("agencyId") != agency_id:
            raise AppError("not_found")
        if t["status"] != "published":
            raise AppError("invalid_transition", "This trip can no longer be edited.")
        candidate = {**built, "status": "published", "publishedAt": t.get("publishedAt"), "holds": t.get("holds") or {}}
        ctx = await _tx_ctx(tx, candidate)
        scheds = await _tx_schedules(
            tx,
            [
                ("driver", t["driverId"]),
                ("vehicle", t["vehicleId"]),
                ("driver", candidate["driverId"]),
                ("vehicle", candidate["vehicleId"]),
            ],
        )
        tb = await _load_trip_bookings(tx, t["id"], now)
        if _has_bookings(t, tb):
            raise AppError("trip_has_bookings", "This trip has bookings, so its route, times or vehicle can't change.")
        _assert_publishable(candidate, ctx, now)
        _check_conflicts(scheds, candidate, now)
        nxt = {**candidate, **_published_fields(candidate, ctx, now), "version": int(t.get("version", 1)) + 1}
        if verification_of(ctx.agency) == "suspended":
            nxt["searchKeys"] = []
        _write_schedules(tx, scheds, t["id"], nxt, now)
        trips_repo.tx_set(tx, nxt)

    await run_transaction(_tx)


async def delete_draft(user: CurrentUser, trip_id: str) -> None:
    """Hard delete of never-published drafts only (no booking history)."""
    agency_id = agency_id_of(user)

    async def _tx(tx: AsyncTransaction) -> None:
        t = await trips_repo.tx_get_trip(tx, trip_id)
        if not t or t.get("agencyId") != agency_id:
            raise AppError("not_found")
        if t["status"] != "draft" or t.get("publishedAt"):
            raise AppError("invalid_transition", "Only unpublished drafts can be deleted. Cancel the trip instead.")
        trips_repo.tx_delete(tx, trip_id)

    await run_transaction(_tx)


async def _ensure_route(trip: dict[str, Any], now: datetime) -> None:
    if trip.get("route") and len(trip.get("legs") or []) == len(trip.get("checkpoints") or []) - 1:
        return
    places = [c["place"] for c in trip["checkpoints"]]
    legs, route, kms = await compute_route(places, now)

    async def _tx(tx: AsyncTransaction) -> None:
        t = await trips_repo.tx_get_trip(tx, trip["id"])
        if not t or t["status"] != "draft":
            return
        cps = [{**c, "kmFromOrigin": kms[i]} for i, c in enumerate(t["checkpoints"])]
        trips_repo.tx_update(tx, t["id"], {"legs": legs, "route": route, "checkpoints": cps, "updatedAt": now})

    await run_transaction(_tx)


async def _publish(user: CurrentUser, trip_id: str, now: datetime) -> dict[str, Any]:
    agency_id = agency_id_of(user)
    t0 = await _owned_trip(agency_id, trip_id)
    if t0["status"] == "draft":
        await _ensure_route(t0, now)

    async def _tx(tx: AsyncTransaction) -> dict[str, Any]:
        trip = await trips_repo.tx_get_trip(tx, trip_id)
        if not trip or trip.get("agencyId") != agency_id:
            raise AppError("not_found")
        ctx = await _tx_ctx(tx, trip)
        scheds = await _tx_schedules(tx, [("driver", trip["driverId"]), ("vehicle", trip["vehicleId"])])
        if trip["status"] == "published":
            return trip  # idempotent
        if trip["status"] != "draft":
            raise AppError("invalid_transition", "Only draft trips can be published.")
        _assert_publishable(trip, ctx, now)
        _check_conflicts(scheds, trip, now)
        nxt = _bumped(trip, now, **_published_fields(trip, ctx, now))
        nxt["progress"] = {**(trip.get("progress") or {}), "nextStep": next_step(trip["checkpoints"])}
        _write_schedules(tx, scheds, trip_id, nxt, now)
        trips_repo.tx_set(tx, nxt)
        trips_repo.tx_add_event(tx, trip_id, _event("published", user, now))
        _notify(
            tx,
            user_id=trip["driverId"],
            role="driver",
            kind="trip_published",
            title="New trip assigned",
            body=f"{route_label(trip['checkpoints'])}, departing {_when(trip['departureAt'])}.",
            link={"type": "trip", "id": trip_id},
            now=now,
        )
        return nxt

    return await run_transaction(_tx)


async def publish_trip(user: CurrentUser, trip_id: str, now: datetime) -> AgencyTripDTO:
    await _publish(user, trip_id, now)
    return await get_trip(user, trip_id, now)


async def unpublish_trip(user: CurrentUser, trip_id: str, now: datetime) -> AgencyTripDTO:
    """published → draft when there are no awaiting, held or committed bookings."""
    agency_id = agency_id_of(user)

    async def _tx(tx: AsyncTransaction) -> None:
        t = await trips_repo.tx_get_trip(tx, trip_id)
        if not t or t.get("agencyId") != agency_id:
            raise AppError("not_found")
        scheds = await _tx_schedules(tx, [("driver", t["driverId"]), ("vehicle", t["vehicleId"])])
        tb = await _load_trip_bookings(tx, trip_id, now)
        if t["status"] == "draft":
            return
        if t["status"] != "published":
            raise AppError("invalid_transition", "Only published trips can be moved back to draft.")
        active_holds = any(capacity.is_active(h, now) for h in (t.get("holds") or {}).values())
        if _open_bookings(tb) or active_holds:
            raise AppError("trip_has_bookings")
        _write_schedules(tx, scheds, trip_id, None, now)
        trips_repo.tx_set(tx, _bumped(t, now, status="draft", searchKeys=[]))
        trips_repo.tx_add_event(tx, trip_id, _event("unpublished", user, now))

    await run_transaction(_tx)
    return await get_trip(user, trip_id, now)


async def cancel_trip(user: CurrentUser, trip_id: str, reason: str, now: datetime) -> AgencyTripDTO:
    """draft|published → cancelled; pending → withdrawn, held/committed → released (refunds queued)."""
    agency_id = agency_id_of(user)
    svc = _booking_service()
    close = getattr(svc, "close_for_trip_cancel", None) if svc else None

    async def _tx(tx: AsyncTransaction) -> list[str]:
        t = await trips_repo.tx_get_trip(tx, trip_id)
        if not t or t.get("agencyId") != agency_id:
            raise AppError("not_found")
        scheds = await _tx_schedules(tx, [("driver", t["driverId"]), ("vehicle", t["vehicleId"])])
        tb = await _load_trip_bookings(tx, trip_id, now)
        if t["status"] == "cancelled":
            return []
        if t["status"] not in ("draft", "published"):
            raise AppError("invalid_transition", "A trip that has started or finished can't be cancelled.")
        if getattr(tb, "has_picked_up", False):
            raise AppError("invalid_transition", "Some shipments are already picked up.")
        nxt = _bumped(t, now, status="cancelled", cancelledAt=now, cancelReason=reason, searchKeys=[])
        job_ids: list[str] = []
        if _open_bookings(tb) or (t.get("holds") or {}):
            if close is None:
                raise AppError("not_implemented", "Trips with bookings can't be cancelled yet.")
            res = await close(tx, tb, t, note=reason, actor=actor_of(user), now=now)
            nxt["holds"] = res.holds
            nxt["counts"] = res.counts
            nxt["capacitySummary"] = res.capacity_summary
            job_ids = list(res.job_ids)
        _write_schedules(tx, scheds, trip_id, None, now)
        trips_repo.tx_set(tx, nxt)
        trips_repo.tx_add_event(tx, trip_id, _event("cancelled", user, now, remarks=reason))
        if t["status"] == "published":
            _notify(
                tx,
                user_id=t["driverId"],
                role="driver",
                kind="trip_cancelled",
                title="Trip cancelled",
                body=f"{t.get('agencyName', 'Your agency')} cancelled your trip departing "
                f"{_when(t['departureAt'])}: {reason}",
                link={"type": "trip", "id": trip_id},
                now=now,
            )
        return job_ids

    job_ids = await run_transaction(_tx)
    if job_ids:
        try:
            from app.services import jobs_service

            await jobs_service.run_jobs(job_ids, now)
        except Exception:  # noqa: BLE001 - the sweep retries outbox jobs
            log.warning("after-commit jobs failed", extra={"fields": {"tripId": trip_id}})
    return await get_trip(user, trip_id, now)


async def reassign(
    user: CurrentUser, trip_id: str, driver_id: str | None, vehicle_id: str | None, now: datetime
) -> AgencyTripDTO:
    """Swap the driver and/or vehicle of a draft or published trip (schedule-checked; open bookings
    fanned out by D4; old and new driver notified)."""
    agency_id = agency_id_of(user)
    agency = await load_agency(agency_id)
    assert_not_suspended(agency)
    if driver_id:
        await _linked_driver(agency_id, driver_id)
    if vehicle_id:
        await _owned_vehicle(agency_id, vehicle_id)
    svc = _booking_service()
    fan_out = getattr(svc, "fan_out_driver", None) if svc else None

    async def _tx(tx: AsyncTransaction) -> None:
        t = await trips_repo.tx_get_trip(tx, trip_id)
        if not t or t.get("agencyId") != agency_id:
            raise AppError("not_found")
        new_driver = driver_id or t["driverId"]
        new_vehicle = vehicle_id or t["vehicleId"]
        candidate = {**t, "driverId": new_driver, "vehicleId": new_vehicle}
        ctx = await _tx_ctx(tx, candidate)
        scheds = await _tx_schedules(
            tx,
            [("driver", t["driverId"]), ("vehicle", t["vehicleId"]), ("driver", new_driver), ("vehicle", new_vehicle)],
        )
        tb = await _load_trip_bookings(tx, trip_id, now)
        if new_driver == t["driverId"] and new_vehicle == t["vehicleId"]:
            return  # idempotent
        if t["status"] not in ("draft", "published"):
            raise AppError("invalid_transition", "The driver or vehicle can't change once the trip has started.")
        if getattr(tb, "has_picked_up", False):
            raise AppError("invalid_transition", "Some shipments are already picked up.")
        if ctx.vehicle:  # a smaller vehicle lowers the offer to its payload (never below the booked load)
            payload = int(ctx.vehicle.get("maxPayloadKg", 0))
            candidate["capacity"] = {"vehicleMaxKg": payload, "offeredKg": min(capacity.offered_kg(t), payload)}
        _assert_assignment(candidate, ctx, now)
        if not (ctx.vehicle and ctx.driver):
            raise AppError("not_found")
        payload = int(ctx.vehicle["maxPayloadKg"])
        offered = capacity.offered_kg(candidate)
        nxt = _bumped(
            candidate,
            now,
            vehicle=_vehicle_snap(ctx.vehicle),
            driver=_driver_snap(ctx.driver),
            capacity={"vehicleMaxKg": payload, "offeredKg": offered},
        )
        nxt["capacitySummary"] = capacity.summary(nxt, now)
        if t["status"] == "published":
            _check_conflicts(scheds, nxt, now)
            _write_schedules(tx, scheds, trip_id, nxt, now)
        if _open_bookings(tb):
            if fan_out is None:
                raise AppError("not_implemented", "Trips with bookings can't be reassigned yet.")
            await fan_out(
                tx,
                tb,
                nxt,
                driver_id=new_driver,
                driver_name=ctx.driver.get("fullName", ""),
                vehicle_id=new_vehicle,
                vehicle_reg=ctx.vehicle.get("registrationNumber", ""),
                actor=actor_of(user),
                now=now,
            )
        trips_repo.tx_set(tx, nxt)
        trips_repo.tx_add_event(tx, trip_id, _event("driver_reassigned", user, now))
        if t["status"] == "published" and new_driver != t["driverId"]:
            _notify(
                tx,
                user_id=new_driver,
                role="driver",
                kind="trip_published",
                title="New trip assigned",
                body=f"You're now driving {route_label(t['checkpoints'])}, departing {_when(t['departureAt'])}.",
                link={"type": "trip", "id": trip_id},
                now=now,
            )
            _notify(
                tx,
                user_id=t["driverId"],
                role="driver",
                kind="driver_reassigned",
                title="Trip reassigned",
                body=f"The trip departing {_when(t['departureAt'])} was assigned to another driver.",
                link={"type": "trip", "id": trip_id},
                now=now,
            )

    await run_transaction(_tx)
    return await get_trip(user, trip_id, now)


# ═══════════════════════════════ reads ═══════════════════════════════
async def _owned_trip(agency_id: str, trip_id: str) -> dict[str, Any]:
    t = await trips_repo.get(trip_id)
    if not t or t.get("agencyId") != agency_id:
        raise AppError("not_found")
    return t


async def blockers_for(trip: dict[str, Any], now: datetime) -> list[str]:
    if trip["status"] != "draft":
        return []
    from app.integrations.maps import maps_configured

    agency = await agencies_repo.get(trip["agencyId"])
    vehicle = await vehicles_repo.get(trip["vehicleId"])
    driver = await drivers_repo.get(trip["driverId"])
    return publish_blockers(
        Readiness(
            agency_verified=verification_of(agency) == "verified",
            agency_suspended=verification_of(agency) == "suspended",
            vehicle_active=(vehicle or {}).get("status") == "active",
            vehicle_rc_ok=bool(vehicle) and rc_ok(vehicle or {}),
            driver_active=_driver_ok(driver, trip["agencyId"]) and (driver or {}).get("availability") == "available",
            driver_verified=_driver_verified(driver),
            route_computed=bool(trip.get("route")),
            maps_configured=maps_configured(),
            departure_at=trip.get("departureAt"),
            now=now,
        )
    )


async def _trip_bookings(agency_id: str, trip: dict[str, Any], now: datetime) -> list[dict[str, Any]]:
    svc = _booking_service()
    lister = getattr(svc, "list_for_trip", None) if svc else None
    if lister is None:
        return []
    try:
        from app.views import bookings as booking_views  # type: ignore[attr-defined]
    except ImportError:
        return []
    rows = await lister(agency_id, trip["id"])
    return [booking_views.agency_list_item(b, trip, now) for b in rows]


async def get_trip(user: CurrentUser, trip_id: str, now: datetime) -> AgencyTripDTO:
    agency_id = agency_id_of(user)
    t = await _owned_trip(agency_id, trip_id)
    return views.trip_dto(t, now, user.uid, await _trip_bookings(agency_id, t, now), await blockers_for(t, now))


async def tab_counts(agency_id: str) -> TripTabCounts:
    return TripTabCounts(**{tab: await trips_repo.count_for_agency(agency_id, st) for tab, st in TAB_STATUSES.items()})


async def list_trips(user: CurrentUser, tab: str, limit: int, cursor: str | None, now: datetime) -> TripListResponse:
    agency_id = agency_id_of(user)
    rows, nxt = await trips_repo.page_for_agency(
        agency_id, TAB_STATUSES[tab], tab in ("upcoming", "active"), limit, cursor
    )
    return TripListResponse(
        items=[views.trip_list_item(t, now, user.uid) for t in rows],
        next_cursor=nxt,
        counts=await tab_counts(agency_id),
    )


async def preview(user: CurrentUser, body: TripPreviewBody, now: datetime) -> TripPreviewDTO:
    from app.domain.pricing import round_half_up

    agency_id_of(user)
    ids = [c.place_id for c in body.checkpoints]
    dup = next((i for i in range(1, len(ids)) if ids[i] in ids[:i]), None)
    if dup is not None:
        raise AppError(
            "invalid_checkpoints", fields={f"checkpoints.{dup}.placeId": "This place is already on this route."}
        )
    places = await resolve_places(ids)
    legs, route, kms = await compute_route(places, now)
    dwell = body.dwell_minutes
    times = (
        suggested_times(body.departure_at, [leg["durationMin"] for leg in legs], dwell) if body.departure_at else None
    )
    km = float(route["distanceKm"])
    distance_charge = round_half_up(km * body.rate_per_km_paise)
    weight_charge = round_half_up(body.sample_weight_kg * body.rate_per_kg_paise)
    extra = sum(c.amount_rupees for c in body.additional_charges if c.basis == "per_booking")
    cps = []
    for i, p in enumerate(places):
        loc = p.get("location") or {}
        cps.append(
            PreviewCheckpointDTO(
                place_id=p["placeId"],
                place_name=p.get("name", ""),
                district=p.get("district"),
                state=p.get("state") or "",
                lat=float(loc.get("lat", 0)),
                lng=float(loc.get("lng", 0)),
                km_from_origin=kms[i],
                leg_distance_km=legs[i - 1]["distanceKm"] if i > 0 else None,
                leg_duration_min=legs[i - 1]["durationMin"] if i > 0 else None,
                suggested_arrival_at=times[i][0] if times else None,
                suggested_departure_at=times[i][1] if times else None,
            )
        )
    return TripPreviewDTO(
        checkpoints=cps,
        distance_km=km,
        duration_mins=int(route["durationMin"]) + dwell * max(0, len(places) - 2),
        overview_polyline=route["overviewPolyline"],
        sample_weight_kg=body.sample_weight_kg,
        earnings_preview=EarningsPreviewDTO(
            distance_charge=distance_charge,
            weight_charge=weight_charge,
            additional_charges=extra,
            earnings=distance_charge + weight_charge + extra,
        ),
    )


async def form_options(
    user: CurrentUser,
    departure_at: datetime | None,
    arrival_at: datetime | None,
    exclude_trip_id: str | None,
    now: datetime,
) -> TripFormOptionsDTO:
    agency_id = agency_id_of(user)
    agency = await load_agency(agency_id)
    vehicles = await vehicles_repo.list_for_agency(agency_id, ["active", "inactive"])
    drivers = await drivers_repo.list_for_agency(agency_id, "active")
    window = (
        interval_for(exclude_trip_id or "__new__", departure_at, arrival_at)
        if departure_at and arrival_at and arrival_at > departure_at
        else None
    )
    keys: list[Key] = [("vehicle", v["id"]) for v in vehicles] + [("driver", d["id"]) for d in drivers]
    scheds = await schedules_repo.get_schedules(keys) if window and keys else [None] * len(keys)

    def busy(i: int) -> Any:
        return views.slot_dto(find_conflict(scheds[i], window, now)) if window else None

    return TripFormOptionsDTO(
        verification=verification_of(agency),
        vehicles=[
            TripFormVehicleOption(
                id=v["id"],
                label=f"{v.get('makeModel', '')} · {v.get('registrationNumber', '')}",
                registration_number=v.get("registrationNumber", ""),
                max_payload_kg=int(v.get("maxPayloadKg", 0)),
                accepted_goods=list(v.get("acceptedGoods") or []),
                handling_supported=list(v.get("handlingSupported") or []),
                status="inactive" if v.get("status") == "inactive" else "active",
                rc_status=views.rc_status(v),
                busy=busy(i),
            )
            for i, v in enumerate(vehicles)
        ],
        drivers=[
            TripFormDriverOption(
                id=d["id"],
                full_name=d.get("fullName", ""),
                availability=d.get("availability", "available"),
                verification=verification_of(d),
                link_status=(d.get("agencyLink") or {}).get("status", "active"),
                busy=busy(len(vehicles) + j),
            )
            for j, d in enumerate(drivers)
        ],
    )


# ═══════════════════════════════ admin hooks ═══════════════════════════════
async def set_agency_searchable(agency_id: str, searchable: bool, now: datetime) -> int:
    """Suspend → clear ``searchKeys`` of the agency's published trips (they stay visible to existing
    bookings but stop matching); reinstate → recompute them. Returns the number of trips touched."""
    writes: list[tuple[str, str, dict[str, Any]]] = []
    for t in await trips_repo.list_for_agency(agency_id, ["published"]):
        keys = search_keys(t.get("checkpoints") or []) if searchable else []
        if keys != (t.get("searchKeys") or []):
            writes.append((C.trips, t["id"], {"searchKeys": keys, "updatedAt": now}))
    return await commit_in_batches(writes)


__all__ = [
    "TripSchedules",
    "cancel_trip",
    "create_trip",
    "delete_draft",
    "form_options",
    "get_trip",
    "list_trips",
    "preview",
    "publish_trip",
    "reassign",
    "set_agency_searchable",
    "tx_read_schedules",
    "tx_release_schedules",
    "unpublish_trip",
    "update_trip",
]
