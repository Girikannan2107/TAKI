"""Pure tests: pricing v3 (half-up rounding), derived status table, exact / intermediate matching."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.core.errors import AppError
from app.domain import booking_machine as bm
from app.domain.matching import (
    MatchShipment,
    SortableOffer,
    locate_segment,
    match_trip,
    offer_badges,
    sort_key,
)
from app.domain.pricing import quote, round_half_up, segment_km, service_fee_for

NOW = datetime(2026, 11, 20, 2, 0, tzinfo=UTC)
TOWNS = {
    "Coimbatore": (11.0168, 76.9558),
    "Tiruppur": (11.1085, 77.3411),
    "Erode": (11.3410, 77.7172),
    "Salem": (11.6643, 78.1460),
}


def trip(**over: Any) -> dict[str, Any]:
    names = list(TOWNS)
    km = [0.0, 50.3, 100.2, 160.0]
    start = NOW + timedelta(hours=6)
    cps = []
    for i, name in enumerate(names):
        lat, lng = TOWNS[name]
        t = start + timedelta(hours=2 * i)
        cps.append(
            {
                "index": i,
                "place": {
                    "placeId": f"fake_{name.lower()}",
                    "name": name,
                    "location": {"lat": lat, "lng": lng},
                    "state": "TN",
                },
                "serviceRadiusKm": 10,
                "kmFromOrigin": km[i],
                "expectedArrivalAt": None if i == 0 else t,
                "expectedDepartureAt": None if i == 3 else t + timedelta(minutes=15 if i else 0),
                "actualArrivalAt": None,
                "actualDepartureAt": None,
            }
        )
    t = {
        "id": "trp_aaaaaaaaaaaaaaaaaaaa",
        "status": "published",
        "checkpoints": cps,
        "departureAt": cps[0]["expectedDepartureAt"],
        "arrivalAt": cps[-1]["expectedArrivalAt"],
        "capacity": {"vehicleMaxKg": 3000, "offeredKg": 1000},
        "holds": {},
        "goods": {"accepted": ["general_goods"], "handlingSupported": [], "maxPackageKg": None},
        "rates": {"perKmPaise": 1500, "perKgPaise": 100},
        "additionalCharges": [
            {"label": "Loading", "amountRupees": 200, "basis": "per_booking"},
            {"label": "Fragile care", "amountRupees": 150, "basis": "special_handling_only"},
        ],
    }
    t.update(over)
    return t


def ship(
    src: str, dst: str, kg: int = 500, goods: str = "general_goods", handling: tuple[str, ...] = ()
) -> MatchShipment:
    return MatchShipment(TOWNS[src], TOWNS[dst], kg, goods, handling)


# ── pricing ───────────────────────────────────────────────────────────────────
def test_round_half_up_is_not_bankers_rounding() -> None:
    assert round_half_up(250) == 3  # ₹2.50 → ₹3 (Python round(2.5) would give 2)
    assert round_half_up(350) == 4  # round(3.5) == 4 either way
    assert round_half_up(249) == 2
    assert round_half_up(150.5) == 2  # 150.5 paise → 151 → ₹2 (JS Math.round semantics)
    assert round_half_up(0) == 0


def test_quote_lines_sum_to_total_and_float_km_is_exact() -> None:
    q = quote(segment_km=123.4, weight_kg=500, per_km_paise=250, per_kg_paise=100, additional_charges=[])
    assert q["distanceCharge"] == 309  # 123.4 × 250 = 30850 paise → ₹308.50 → ₹309 (half up)
    assert q["weightCharge"] == 500
    assert q["serviceFee"] == 350 and q["agencyNet"] == q["transportationCharge"] == 809
    assert q["totalPayable"] == sum(line["amount"] for line in q["lines"]) == 1159
    assert q["pricingVersion"] == 3 and q["handlingFee"] == q["additionalCharges"] == 0


def test_additional_charges_basis() -> None:
    t = trip()
    plain = quote(
        segment_km=10, weight_kg=100, per_km_paise=1000, per_kg_paise=0, additional_charges=t["additionalCharges"]
    )
    fragile = quote(
        segment_km=10,
        weight_kg=100,
        per_km_paise=1000,
        per_kg_paise=0,
        additional_charges=t["additionalCharges"],
        special_handling=["fragile"],
    )
    assert plain["additionalCharges"] == 200 and fragile["additionalCharges"] == 350
    assert [line["code"] for line in fragile["lines"]] == [
        "distance",
        "weight",
        "additional",
        "additional",
        "service_fee",
    ]
    assert fragile["agencyNet"] == fragile["transportationCharge"] + 350


@pytest.mark.parametrize(("kg", "fee"), [(10, 350), (500, 350), (501, 500), (1000, 500), (2000, 750), (2001, 1000)])
def test_service_fee_slabs(kg: int, fee: int) -> None:
    assert service_fee_for(kg) == fee


def test_segment_km_has_no_float_artifacts() -> None:
    assert segment_km(trip()["checkpoints"], 1, 2) == 49.9
    with pytest.raises(ValueError):
        segment_km(trip()["checkpoints"], 2, 1)


# ── matching ──────────────────────────────────────────────────────────────────
def test_exact_and_intermediate_matches() -> None:
    r = match_trip(trip(), ship("Coimbatore", "Salem"), NOW)
    assert r.ok and r.match and r.match.match_type == "exact" and (r.match.pickup_index, r.match.drop_index) == (0, 3)
    r = match_trip(trip(), ship("Tiruppur", "Erode"), NOW)
    assert (
        r.ok
        and r.match
        and r.match.match_type == "intermediate"
        and (r.match.pickup_index, r.match.drop_index) == (1, 2)
    )
    assert r.match.segment_km == 49.9 and r.match.respond_by == r.match.pickup_departure_at - timedelta(minutes=60)


def test_wrong_order_and_out_of_radius_never_match() -> None:
    assert match_trip(trip(), ship("Salem", "Coimbatore"), NOW).problem == "not_on_route"
    far = MatchShipment((11.0168, 76.70), TOWNS["Salem"], 500, "general_goods")  # ~28 km from Coimbatore
    assert match_trip(trip(), far, NOW).problem == "not_on_route"
    assert locate_segment(trip(), ship("Erode", "Erode")) is None  # same checkpoint never matches


def test_date_departed_goods_and_capacity_problems() -> None:
    t = trip()
    pickup_day = (t["checkpoints"][0]["expectedDepartureAt"] + timedelta(hours=5, minutes=30)).date()
    assert match_trip(t, ship("Coimbatore", "Salem"), NOW, date=pickup_day.isoformat()).ok
    assert (
        match_trip(t, ship("Coimbatore", "Salem"), NOW, date=(pickup_day + timedelta(days=1)).isoformat()).problem
        == "wrong_date"
    )
    late = t["checkpoints"][0]["expectedDepartureAt"] - timedelta(minutes=30)
    assert match_trip(t, ship("Coimbatore", "Salem"), late).problem == "departed"
    # a later checkpoint still serves the shipment after the origin has departed
    assert match_trip(t, ship("Tiruppur", "Salem"), late).ok
    assert match_trip(t, ship("Coimbatore", "Salem", goods="perishables"), NOW).problem == "goods_not_accepted"
    assert (
        match_trip(t, ship("Coimbatore", "Salem", handling=("temperature_sensitive",)), NOW).problem
        == "handling_not_supported"
    )
    assert (
        match_trip(
            trip(goods={"accepted": ["general_goods"], "handlingSupported": [], "maxPackageKg": 100}),
            ship("Coimbatore", "Salem"),
            NOW,
        ).problem
        == "package_too_heavy"
    )
    assert match_trip(t, ship("Coimbatore", "Salem", kg=1200), NOW).problem == "insufficient_capacity"
    assert match_trip(trip(status="draft"), ship("Coimbatore", "Salem"), NOW).problem == "trip_not_bookable"


def test_segment_capacity_is_per_leg() -> None:
    holds = {"A": {"kg": 600, "fromIndex": 0, "toIndex": 1, "state": "committed", "dueAt": None}}
    t = trip(holds=holds)
    assert match_trip(t, ship("Tiruppur", "Salem", kg=1000), NOW).ok  # legs 1..2 are free
    assert match_trip(t, ship("Coimbatore", "Salem", kg=500), NOW).problem == "insufficient_capacity"
    expired = {"A": {"kg": 600, "fromIndex": 0, "toIndex": 3, "state": "held", "dueAt": NOW - timedelta(minutes=1)}}
    assert match_trip(trip(holds=expired), ship("Coimbatore", "Salem", kg=1000), NOW).ok  # lapsed hold doesn't count


def test_sorting_and_badges() -> None:
    a = SortableOffer("trp_a", 1000, 4.5, 300, NOW, NOW)
    b = SortableOffer("trp_b", 900, 3.0, 800, NOW + timedelta(hours=1), NOW)
    assert [o.trip_id for o in sorted([a, b], key=sort_key("price_asc"))] == ["trp_b", "trp_a"]
    assert [o.trip_id for o in sorted([a, b], key=sort_key("departure_asc"))] == ["trp_a", "trp_b"]
    assert offer_badges([a, b]) == {"trp_b": "best_price", "trp_a": "top_rated"}
    assert offer_badges([a]) == {}


# ── booking machine ───────────────────────────────────────────────────────────
def b0(**over: Any) -> dict[str, Any]:
    b = {
        "id": "TAKI00000001",
        "approvalStatus": "pending",
        "paymentStatus": "not_due",
        "reservationStatus": "none",
        "fulfilmentStatus": "not_started",
        "closure": None,
        "statusHistory": [],
        "version": 1,
    }
    b.update(over)
    return b


SYS = {"role": "system", "userId": None}


def test_derived_status_table() -> None:
    assert bm.derive(b0())["status"] == "awaiting_agency"
    t = bm.apply(b0(), "accept", now=NOW, by=SYS)
    assert t.booking["status"] == "pending_payment" and t.booking["agencyTab"] == "accepted"
    t = bm.apply(t.booking, "checkout_started", now=NOW, by=SYS)
    t = bm.apply(t.booking, "payment_failed", now=NOW, by=SYS)
    assert t.booking["status"] == "payment_failed" and t.booking["tab"] == "pending"
    t = bm.apply(t.booking, "payment_succeeded", now=NOW, by=SYS)
    assert t.booking["status"] == "confirmed" and t.booking["driverTab"] == "pending_pickup"
    assert t.booking["reservationStatus"] == "committed"
    for ev, status, tab in (
        ("pickup", "picked_up", "picked_up"),
        ("start_transit", "in_transit", "in_transit"),
        ("out_for_delivery", "out_for_delivery", "in_transit"),
        ("deliver", "delivered", "delivered"),
    ):
        t = bm.apply(t.booking, ev, now=NOW, by=SYS)
        assert (t.booking["status"], t.booking["tab"]) == (status, tab)
    assert t.booking["reservationStatus"] == "consumed" and t.booking["paymentStatus"] == "paid"
    assert [h["status"] for h in t.booking["statusHistory"]][-1] == "delivered"


def test_idempotent_and_invalid_transitions() -> None:
    t = bm.apply(b0(), "reject", now=NOW, by=SYS, note="No space")
    assert t.booking["status"] == "rejected" and t.booking["closure"]["reason"] == "agency_rejected"
    assert not bm.apply(t.booking, "reject", now=NOW, by=SYS).changed
    with pytest.raises(AppError) as e:
        bm.apply(t.booking, "accept", now=NOW, by=SYS)
    assert e.value.code == "invalid_transition"
    paid = b0(approvalStatus="accepted", paymentStatus="paid", reservationStatus="committed")
    picked = bm.apply(paid, "pickup", now=NOW, by=SYS).booking
    with pytest.raises(AppError):
        bm.apply(picked, "cancel", now=NOW, by=SYS)
    c = bm.apply(paid, "cancel", now=NOW, by=SYS).booking
    assert (
        c["paymentStatus"] == "refund_pending" and c["reservationStatus"] == "released" and c["status"] == "cancelled"
    )
    w = bm.apply(b0(), "cancel", now=NOW, by=SYS).booking
    assert w["approvalStatus"] == "withdrawn" and w["status"] == "cancelled"
    tc = bm.apply(b0(), "trip_cancelled", now=NOW, by=SYS).booking
    assert tc["status"] == "rejected" and tc["closure"]["reason"] == "trip_cancelled"
    r = bm.apply(paid, "refuse_pickup", now=NOW, by=SYS).booking
    assert r["fulfilmentStatus"] == "pickup_refused" and r["closure"]["reason"] == "pickup_refused"
    e2 = bm.apply(
        b0(approvalStatus="accepted", paymentStatus="due", reservationStatus="held"), "expire_payment", now=NOW, by=SYS
    )
    assert e2.booking["paymentStatus"] == "expired" and e2.booking["status"] == "cancelled"


def test_payment_due_at_is_capped_before_pickup() -> None:
    assert bm.payment_due_at(NOW, NOW + timedelta(hours=6)) == NOW + timedelta(minutes=120)
    assert bm.payment_due_at(NOW, NOW + timedelta(minutes=90)) == NOW + timedelta(minutes=60)
