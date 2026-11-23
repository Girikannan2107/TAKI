"""Pure trip rules, schedules and geohash search keys (no emulator)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.domain import geo
from app.domain.trip_rules import (
    Readiness,
    additional_charge_issues,
    capacity_issues,
    charge_code,
    checkpoint_issues,
    find_conflict,
    goods_issues,
    interval_for,
    next_step,
    normalized_charges,
    publish_blockers,
    publish_timing_problem,
    respond_by,
    suggested_times,
    with_interval,
    without_trip,
)
from app.domain.vehicles import image_key_for, is_valid_reg, mask_registration, normalize_reg

NOW = datetime(2026, 11, 20, 4, 30, tzinfo=UTC)
H = timedelta(hours=1)


def cp(pid: str, arr: datetime | None, dep: datetime | None) -> dict[str, object]:
    return {"placeId": pid, "expectedArrivalAt": arr, "expectedDepartureAt": dep}


def test_checkpoint_rules() -> None:
    ok = [cp("a", None, NOW), cp("b", NOW + 2 * H, NOW + 3 * H), cp("c", NOW + 5 * H, None)]
    assert checkpoint_issues(ok) == []
    bad = [cp("a", None, None), cp("b", NOW, NOW - H), cp("a", None, None)]
    paths = {i.path for i in checkpoint_issues(bad)}
    assert paths >= {
        "checkpoints.0.expectedDepartureAt",
        "checkpoints.1.expectedDepartureAt",
        "checkpoints.2.expectedArrivalAt",
        "checkpoints.2.placeId",
    }
    order = [cp("a", None, NOW + 2 * H), cp("b", NOW + H, None)]
    assert [i.path for i in checkpoint_issues(order)] == ["checkpoints.1.expectedArrivalAt"]
    assert checkpoint_issues([cp("a", None, NOW)])[0].path == "checkpoints"
    assert any("at most 10" in i.message for i in checkpoint_issues([cp(str(i), None, None) for i in range(11)]))


def test_capacity_goods_and_charges() -> None:
    assert capacity_issues(1000, 3000) == []
    assert [i.path for i in capacity_issues(3500, 3000)] == ["offeredKg"]
    assert capacity_issues(50, 3000)[0].message == "Offer at least 100 kg."
    vehicle = {"acceptedGoods": ["general_goods"], "handlingSupported": ["fragile"]}
    assert goods_issues(["general_goods"], ["fragile"], vehicle) == []
    assert {i.path for i in goods_issues(["electronics"], ["keep_dry"], vehicle)} == {
        "acceptedGoods",
        "handlingSupported",
    }
    assert charge_code("Loading / unloading") == "loading_unloading"
    charges = [{"label": "Toll", "amountRupees": 10}, {"label": " toll", "amountRupees": 5}]
    assert [i.path for i in additional_charge_issues(charges)] == ["additionalCharges.1.label"]
    assert normalized_charges(
        [{"label": "  Night   halt ", "amountRupees": 300, "basis": "special_handling_only"}]
    ) == [{"code": "night_halt", "label": "Night halt", "amountRupees": 300, "basis": "special_handling_only"}]


def test_publish_timing_and_blockers() -> None:
    assert publish_timing_problem(NOW + 2 * H, NOW) is None
    assert publish_timing_problem(NOW + timedelta(minutes=30), NOW)[0] == "invalid_checkpoints"  # type: ignore[index]
    assert publish_timing_problem(NOW + timedelta(days=61), NOW)[0] == "date_too_far"  # type: ignore[index]
    r = Readiness(
        agency_verified=False,
        agency_suspended=False,
        vehicle_active=True,
        vehicle_rc_ok=False,
        driver_active=True,
        driver_verified=False,
        route_computed=True,
        maps_configured=True,
        departure_at=NOW + 2 * H,
        now=NOW,
    )
    assert publish_blockers(r) == ["Agency not verified", "Vehicle RC missing", "Driver documents not verified"]


def test_schedules() -> None:
    a = interval_for("t1", NOW, NOW + 4 * H)
    assert a["from"] == NOW - H and a["to"] == NOW + 5 * H
    s = with_interval(None, "driver", "d1", a, NOW)
    assert s["id"] == "driver:d1" and len(s["intervals"]) == 1
    b = interval_for("t2", NOW + 5 * H, NOW + 6 * H)  # buffers overlap (t1 ends +5h, t2 starts +4h)
    assert find_conflict(s, b, NOW)["tripId"] == "t1"  # type: ignore[index]
    c = interval_for("t3", NOW + 7 * H, NOW + 8 * H)
    assert find_conflict(s, c, NOW) is None
    assert find_conflict(s, interval_for("t1", NOW, NOW + 4 * H), NOW) is None  # same trip
    assert find_conflict(s, b, NOW + 10 * H) is None  # past intervals don't block
    s2 = with_interval(s, "driver", "d1", c, NOW)
    assert [x["tripId"] for x in s2["intervals"]] == ["t1", "t3"]
    assert [x["tripId"] for x in without_trip(s2, "driver", "d1", "t1", NOW)["intervals"]] == ["t3"]
    assert without_trip(s2, "driver", "d1", "t3", NOW + 9 * H)["intervals"] == []  # pruned


def test_progress_and_deadlines() -> None:
    cps = [
        {"actualArrivalAt": None, "actualDepartureAt": NOW},
        {"actualArrivalAt": NOW, "actualDepartureAt": None},
        {"actualArrivalAt": None, "actualDepartureAt": None},
    ]
    assert next_step(cps) == {"kind": "depart", "index": 1}
    assert next_step([{"actualDepartureAt": NOW}, {"actualArrivalAt": NOW}]) is None
    assert respond_by(NOW) == NOW - H
    times = suggested_times(NOW, [60, 90], 15)
    assert times == [(None, NOW), (NOW + H, NOW + 75 * timedelta(minutes=1)), (NOW + timedelta(minutes=165), None)]


def test_geohash_and_search_keys() -> None:
    assert len(geo.geohash_encode(11.0168, 76.9558, 7)) == 7
    cell = geo.cell_of({"lat": 11.0168, "lng": 76.9558})
    ring = geo.geohash_neighbours(cell)
    assert len(ring) == 9 and cell in ring
    lo, hi, lo2, hi2 = geo.geohash_bounds(cell)
    assert lo <= 11.0168 <= hi and lo2 <= 76.9558 <= hi2
    # every point within ~19 km of the stop lands in the 9-cell block
    for dlat, dlng in ((0.17, 0), (-0.17, 0), (0, 0.17), (0, -0.17), (0.12, 0.12)):
        assert geo.cell_of({"lat": 11.0168 + dlat, "lng": 76.9558 + dlng}) in ring
    late = datetime(2026, 11, 20, 19, 0, tzinfo=UTC)  # 00:30 IST on the 21st
    stops = [
        {"place": {"location": {"lat": 11.0168, "lng": 76.9558}}, "expectedDepartureAt": late},
        {"place": {"location": {"lat": 11.6643, "lng": 78.146}}, "expectedArrivalAt": late + 3 * H},
    ]
    keys = geo.search_keys(stops)
    assert len(keys) == 9 and all(k.endswith("|2026-11-21") for k in keys)
    assert geo.search_key_for({"lat": 11.0168, "lng": 76.9558}, "2026-11-21") in keys
    assert round(geo.haversine_km(11.0168, 76.9558, 11.6643, 78.146)) == 148


def test_registration() -> None:
    assert normalize_reg("tn37xx4587") == "TN 37 XX 4587"
    assert normalize_reg("tn-7-a-45") == "TN 07 A 0045"
    assert normalize_reg("22bh1234aa") == "22 BH 1234 AA"
    assert is_valid_reg("TN 37 XX 4587") and is_valid_reg("22 BH 1234 AA")
    assert not is_valid_reg(normalize_reg("hello")) and not is_valid_reg(normalize_reg("T1"))
    assert mask_registration("TN 37 XX 4587") == "XXXXXX4587"
    assert image_key_for("Heavy Truck", None) == "large_curtainside_lorry_taki"
    assert image_key_for("Pickup", "tata_ace") == "mini_delivery_truck_taki"
