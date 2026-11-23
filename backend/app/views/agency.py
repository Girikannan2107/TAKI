"""Agency role projections (P2 §12.3): documents → agency DTOs. Owner: D3.

Signed file URLs are minted here only for files the agency may read (P2 §12.2): its own vehicles'
photos and RC, its trips' driver photos, and identity documents of drivers with a pending or active
link (the calling service checks the link before projecting).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from app.core.time import iso_z
from app.domain import capacity
from app.domain.phone import mask_phone
from app.domain.trip_rules import live_intervals, route_label
from app.schemas.agency import (
    AadhaarSummaryDTO,
    AdditionalChargeDTO,
    AgencyDriverDTO,
    AgencyTripDTO,
    AgencyTripListItem,
    DimensionsDTO,
    DriverLinkDTO,
    DriverStatsDTO,
    InviteDTO,
    LicenseSummaryDTO,
    RcVerificationDTO,
    ReviewDTO,
    ScheduleSlotDTO,
    TripCapacityDTO,
    TripCheckpointDTO,
    TripCountsDTO,
    TripDriverDTO,
    TripGoodsDTO,
    TripLegDTO,
    TripRatesDTO,
    TripRouteDTO,
    TripVehicleDTO,
    VehicleDTO,
)
from app.schemas.common import district_name_of
from app.views.common import document_dto, file_ref_dto, first_name, ref_url

Doc = Mapping[str, Any]


# ── Vehicles ──────────────────────────────────────────────────────────────────
def vehicle_dto(v: Doc, viewer_uid: str, active_trips: int = 0) -> VehicleDTO:
    rcv = v.get("rcVerification") or {}
    dims = v.get("dimensionsFt")
    return VehicleDTO(
        id=v["id"],
        vehicle_class=v["vehicleClass"],
        model_id=v.get("modelId"),
        make_model=v.get("makeModel", ""),
        registration_number=v.get("registrationNumber", ""),
        max_payload_kg=int(v.get("maxPayloadKg", 0)),
        body_type=v.get("bodyType", ""),
        dimensions_ft=DimensionsDTO.model_validate(dims) if dims else None,
        accepted_goods=list(v.get("acceptedGoods") or []),
        handling_supported=list(v.get("handlingSupported") or []),
        photos=[file_ref_dto(p["fileId"], viewer_uid) for p in v.get("photos") or [] if p.get("fileId")],
        image_key=v.get("imageKey", ""),
        status=v.get("status", "active"),
        active_trips=active_trips,
        rc=document_dto("rc", v["rc"], rcv, viewer_uid) if v.get("rc") else None,
        rc_verification=RcVerificationDTO(
            status=rcv.get("status", "not_submitted"), reason=rcv.get("reason"), reviewed_at=rcv.get("reviewedAt")
        ),
        created_at=v["createdAt"],
        updated_at=v["updatedAt"],
    )


def rc_status(v: Doc) -> str:
    if not v.get("rc"):
        return "missing"
    return str((v.get("rcVerification") or {}).get("status", "pending"))


# ── Drivers ───────────────────────────────────────────────────────────────────
def schedule_slots(schedule: Doc | None, now: datetime) -> list[ScheduleSlotDTO]:
    return [ScheduleSlotDTO(trip_id=x["tripId"], from_=x["from"], to=x["to"]) for x in live_intervals(schedule, now)]


def slot_dto(iv: Doc | None) -> ScheduleSlotDTO | None:
    return ScheduleSlotDTO(trip_id=iv["tripId"], from_=iv["from"], to=iv["to"]) if iv else None


def agency_driver_dto(d: Doc, schedule: Doc | None, now: datetime, viewer_uid: str) -> AgencyDriverDTO:
    """Caller guarantees the driver's link to the viewer's agency is pending/active/removed (own history).
    Document files are only exposed while the link is pending or active (P2 §12.2)."""
    link = d.get("agencyLink") or {}
    docs_visible = link.get("status") in ("pending", "active")
    lic = d.get("license") or {}
    aad = d.get("aadhaar") or {}
    slots = schedule_slots(schedule, now)
    return AgencyDriverDTO(
        id=d["id"],
        full_name=d.get("fullName", ""),
        phone=d.get("phone", ""),
        phone_masked=mask_phone(d.get("phone", "")),
        photo_url=ref_url(d.get("photo"), viewer_uid),
        license=LicenseSummaryDTO(
            number_masked=lic.get("numberMasked"),
            file_url=ref_url(lic.get("file"), viewer_uid) if docs_visible else None,
            valid_until=str(lic["validUntil"]) if lic.get("validUntil") else None,
        ),
        aadhaar=AadhaarSummaryDTO(
            number_masked=aad.get("numberMasked"),
            file_url=ref_url(aad.get("file"), viewer_uid) if docs_visible else None,
        ),
        link=DriverLinkDTO(
            status=link.get("status", "pending"),
            via=link.get("via", "request"),
            requested_at=link.get("requestedAt"),
            decided_at=link.get("decidedAt"),
            reason=link.get("reason"),
        ),
        availability=d.get("availability", "available"),
        verification=(d.get("verification") or {}).get("status", "not_submitted"),
        stats=DriverStatsDTO.model_validate(d.get("stats") or {}),
        next_assignment=slots[0] if slots else None,
    )


def invite_dto(i: Doc, now: datetime) -> InviteDTO:
    status = i.get("status", "pending")
    if status == "pending" and i.get("expiresAt") is not None and i["expiresAt"] <= now:
        status = "expired"
    return InviteDTO(
        id=i["id"],
        full_name=i.get("fullName", ""),
        phone=i.get("phone", ""),
        phone_masked=mask_phone(i.get("phone", "")),
        status=status,
        expires_at=i["expiresAt"],
        created_at=i["createdAt"],
    )


def review_dto(r: Doc) -> ReviewDTO:
    return ReviewDTO(
        id=r["id"],
        booking_id=r.get("bookingId", r["id"]),
        rating=int(r.get("rating", 0)),
        comment=r.get("comment"),
        customer_first_name=r.get("customerFirstName") or first_name(r.get("customerName", "")),
        created_at=r["createdAt"],
    )


# ── Trips ─────────────────────────────────────────────────────────────────────
def trip_capacity_dto(t: Doc, now: datetime) -> TripCapacityDTO:
    return TripCapacityDTO(
        vehicle_max_kg=capacity.vehicle_max_kg(t),
        offered_kg=capacity.offered_kg(t),
        booked_kg=max(capacity.committed_loads(t, now), default=0),
        reserved_kg=max(capacity.held_loads(t, now), default=0),
        available_kg=capacity.trip_available_kg(t, now),
    )


def place_name(cp: Doc) -> str:
    return str((cp.get("place") or {}).get("name", ""))


def checkpoint_dto(cp: Doc) -> TripCheckpointDTO:
    p = cp.get("place") or {}
    loc = p.get("location") or {}
    return TripCheckpointDTO(
        index=int(cp["index"]),
        place_id=p.get("placeId", ""),
        place_name=p.get("name", ""),
        district=p.get("district"),
        district_name=district_name_of(p),
        state=p.get("state") or "",
        lat=float(loc.get("lat", 0.0)),
        lng=float(loc.get("lng", 0.0)),
        service_radius_km=float(cp.get("serviceRadiusKm", 10)),
        km_from_origin=float(cp.get("kmFromOrigin", 0)),
        expected_arrival_at=cp.get("expectedArrivalAt"),
        expected_departure_at=cp.get("expectedDepartureAt"),
        actual_arrival_at=cp.get("actualArrivalAt"),
        actual_departure_at=cp.get("actualDepartureAt"),
    )


def legs_dto(t: Doc, now: datetime) -> list[TripLegDTO]:
    cps = t.get("checkpoints") or []
    loads = capacity.leg_loads(t, now)
    offered = capacity.offered_kg(t)
    out = []
    for leg in t.get("legs") or []:
        k = int(leg["index"])
        load = loads[k] if k < len(loads) else 0
        out.append(
            TripLegDTO(
                index=k,
                from_name=place_name(cps[k]) if k < len(cps) else "",
                to_name=place_name(cps[k + 1]) if k + 1 < len(cps) else "",
                distance_km=float(leg.get("distanceKm", 0)),
                duration_min=int(leg.get("durationMin", 0)),
                load_kg=load,
                available_kg=max(0, offered - load),
            )
        )
    return out


def trip_distance_km(t: Doc) -> float:
    route = t.get("route") or {}
    if route.get("distanceKm") is not None:
        return float(route["distanceKm"])
    cps = t.get("checkpoints") or []
    return float(cps[-1].get("kmFromOrigin", 0)) if cps else 0.0


def trip_list_item(t: Doc, now: datetime, viewer_uid: str) -> AgencyTripListItem:
    cps = t.get("checkpoints") or []
    veh = t.get("vehicle") or {}
    drv = t.get("driver") or {}
    rates = t.get("rates") or {}
    dep: datetime = t["departureAt"]
    return AgencyTripListItem(
        id=t["id"],
        status=t["status"],
        route_label=route_label(cps),
        stops=[place_name(c) for c in cps],
        departure_at=dep,
        arrival_at=t["arrivalAt"],
        distance_km=trip_distance_km(t),
        vehicle=TripVehicleDTO(
            id=t.get("vehicleId", ""),
            registration_number=veh.get("registrationNumber", ""),
            vehicle_class=veh.get("vehicleClass", ""),
            make_model=veh.get("makeModel", ""),
            image_key=veh.get("imageKey", ""),
        ),
        driver=TripDriverDTO(
            id=t.get("driverId", ""), full_name=drv.get("fullName", ""), photo_url=ref_url(drv.get("photo"), viewer_uid)
        ),
        capacity=trip_capacity_dto(t, now),
        counts=TripCountsDTO.model_validate(t.get("counts") or {}),
        rates=TripRatesDTO(
            per_km_paise=int(rates.get("perKmPaise", 0)),
            per_kg_paise=int(rates.get("perKgPaise", 0)),
            additional_charges=[AdditionalChargeDTO.model_validate(c) for c in t.get("additionalCharges") or []],
        ),
        departed=t["status"] == "published" and dep <= now,
        published_at=t.get("publishedAt"),
        updated_at=t["updatedAt"],
    )


def trip_dto(
    t: Doc, now: datetime, viewer_uid: str, bookings: Sequence[dict[str, Any]], blockers: list[str]
) -> AgencyTripDTO:
    goods = t.get("goods") or {}
    route = t.get("route")
    return AgencyTripDTO(
        **trip_list_item(t, now, viewer_uid).model_dump(),
        checkpoints=[checkpoint_dto(c) for c in t.get("checkpoints") or []],
        legs=legs_dto(t, now),
        route=TripRouteDTO(
            distance_km=float(route.get("distanceKm", 0)),
            duration_min=int(route.get("durationMin", 0)),
            overview_polyline=route.get("overviewPolyline", ""),
        )
        if route
        else None,
        searchable=bool(t.get("searchKeys")),
        goods=TripGoodsDTO(
            accepted=list(goods.get("accepted") or []),
            handling_supported=list(goods.get("handlingSupported") or []),
            max_package_kg=goods.get("maxPackageKg"),
            notes=goods.get("notes"),
        ),
        cancel_reason=t.get("cancelReason"),
        cancelled_at=t.get("cancelledAt"),
        started_at=t.get("startedAt"),
        completed_at=t.get("completedAt"),
        bookings=list(bookings),
        publish_blockers=blockers,
    )


def iso(dt: datetime | None) -> str | None:
    return iso_z(dt)
