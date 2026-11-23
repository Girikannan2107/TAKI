"""E69–E79 without bookings: drafts, Maps route legs, publish guards, schedules, search keys, edits."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import httpx
from google.cloud.firestore_v1.base_query import FieldFilter

from app.domain.geo import cell_of, search_key
from app.repositories.base import C, col, doc_ref, get_doc, query_docs
from tests.support.builders import (
    BENGALURU,
    COIMBATORE,
    ERODE,
    HOSUR,
    KRISHNAGIRI,
    MUMBAI,
    SALEM,
    TIRUPPUR,
    create_trip,
    create_vehicle,
    iso,
    make_agency,
    make_driver,
    make_world,
    raw_trip,
    trip_body,
)

T = "/api/v1/agency/trips"


def day(n: float = 1) -> datetime:
    return (datetime.now(UTC) + timedelta(days=n)).replace(second=0, microsecond=0)


async def test_draft_then_publish_with_route_legs_and_search_keys(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    body = trip_body(
        w.vehicles[0]["id"], w.drivers[0].uid, publish=False, start=day(), ratePerKmPaise=None, ratePerKgPaise=None
    )
    r = await api.post(T, json=body, headers=w.agency.headers)
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["status"] == "draft" and t["searchable"] is False
    assert t["rates"]["perKmPaise"] == 1200 and t["rates"]["perKgPaise"] == 50  # draft defaults
    assert t["rates"]["additionalCharges"] == [
        {"code": "loading", "label": "Loading", "amountRupees": 200, "basis": "per_booking"}
    ]
    assert [c["placeName"] for c in t["checkpoints"]] == ["Coimbatore", "Tiruppur", "Erode", "Salem"]
    kms = [c["kmFromOrigin"] for c in t["checkpoints"]]
    assert kms[0] == 0 and kms == sorted(kms) and kms[-1] > 100
    assert len(t["legs"]) == 3 and all(leg["distanceKm"] > 0 and leg["durationMin"] > 0 for leg in t["legs"])
    assert t["route"]["overviewPolyline"] and t["distanceKm"] == t["route"]["distanceKm"]
    assert t["publishBlockers"] == []
    assert t["capacity"] == {
        "vehicleMaxKg": 3000,
        "offeredKg": 1000,
        "bookedKg": 0,
        "reservedKg": 0,
        "availableKg": 1000,
    }
    assert t["checkpoints"][0]["lat"] == 11.0168 and t["checkpoints"][0]["serviceRadiusKm"] == 10

    r = await api.post(f"{T}/{t['id']}/publish", headers=w.agency.headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published" and r.json()["searchable"] is True
    doc = await raw_trip(t["id"])
    body_start = datetime.fromisoformat(body["checkpoints"][0]["expectedDepartureAt"].replace("Z", "+00:00"))
    d = (body_start + timedelta(hours=5, minutes=30)).date().isoformat()
    assert search_key(cell_of({"lat": 11.0168, "lng": 76.9558}), d) in doc["searchKeys"]
    assert len(doc["searchKeys"]) <= 27
    assert doc["progress"]["nextStep"] == {"kind": "depart", "index": 0}
    sched = await get_doc(C.schedules, f"driver:{w.drivers[0].uid}")
    assert sched and sched["intervals"][0]["tripId"] == t["id"]
    assert sched["intervals"][0]["from"] == body_start - timedelta(minutes=60)
    assert await get_doc(C.schedules, f"vehicle:{w.vehicles[0]['id']}")
    # idempotent publish
    assert (await api.post(f"{T}/{t['id']}/publish", headers=w.agency.headers)).status_code == 200
    events = [e async for e in doc_ref(C.trips, t["id"]).collection("events").stream()]
    assert [e.to_dict()["type"] for e in events] == ["published"]


async def test_publish_in_one_request_and_list_tabs(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    t1 = await create_trip(api, w.agency, w.vehicles[0]["id"], w.drivers[0].uid, start=day(1))
    t2 = await create_trip(api, w.agency, w.vehicles[1]["id"], w.drivers[1].uid, start=day(2), publish=False)
    assert t1["status"] == "published"
    r = await api.get(T, headers=w.agency.headers)
    assert [x["id"] for x in r.json()["items"]] == [t1["id"]]
    assert r.json()["counts"] == {"upcoming": 1, "active": 0, "completed": 0, "cancelled": 0, "drafts": 1}
    r = await api.get(T, params={"tab": "drafts"}, headers=w.agency.headers)
    assert [x["id"] for x in r.json()["items"]] == [t2["id"]]
    # pagination
    t3 = await create_trip(api, w.agency, w.vehicles[0]["id"], w.drivers[0].uid, start=day(5))
    p1 = (await api.get(T, params={"limit": 1}, headers=w.agency.headers)).json()
    p2 = (await api.get(T, params={"limit": 1, "cursor": p1["nextCursor"]}, headers=w.agency.headers)).json()
    assert [p1["items"][0]["id"], p2["items"][0]["id"]] == [t1["id"], t3["id"]] and p2["nextCursor"] is None


async def test_checkpoint_and_body_validation(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    v, d = w.vehicles[0]["id"], w.drivers[0].uid
    body = trip_body(v, d, start=day())
    body["checkpoints"][1]["expectedArrivalAt"] = body["checkpoints"][0]["expectedDepartureAt"]
    body["checkpoints"][2]["expectedDepartureAt"] = None
    r = await api.post(T, json=body, headers=w.agency.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_checkpoints"
    fields = r.json()["error"]["fields"]
    assert "checkpoints.1.expectedArrivalAt" in fields and "checkpoints.2.expectedDepartureAt" in fields

    r = await api.post(T, json=trip_body(v, d, stops=[COIMBATORE, ERODE, COIMBATORE]), headers=w.agency.headers)
    assert r.status_code == 422 and "checkpoints.2.placeId" in r.json()["error"]["fields"]
    r = await api.post(T, json=trip_body(v, d, stops=[COIMBATORE, MUMBAI]), headers=w.agency.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "outside_service_area"
    r = await api.post(T, json=trip_body(v, d, stops=[COIMBATORE, "fake_nowhere_town"]), headers=w.agency.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "address_not_found"
    r = await api.post(T, json=trip_body(v, d, offered_kg=3500), headers=w.agency.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "capacity_exceeds_vehicle"
    r = await api.post(T, json=trip_body(v, d, acceptedGoods=["electronics"]), headers=w.agency.headers)
    assert r.status_code == 400 and "acceptedGoods" in r.json()["error"]["fields"]
    dup = [{"label": "Toll", "amountRupees": 100}, {"label": "toll ", "amountRupees": 50}]
    r = await api.post(T, json=trip_body(v, d, additionalCharges=dup), headers=w.agency.headers)
    assert r.status_code == 400 and "additionalCharges.1.label" in r.json()["error"]["fields"]
    r = await api.post(T, json=trip_body(v, d, ratePerKmPaise=None), headers=w.agency.headers)
    assert r.status_code == 400 and "ratePerKmPaise" in r.json()["error"]["fields"]
    r = await api.post(
        T, json={**trip_body(v, d), "checkpoints": trip_body(v, d)["checkpoints"][:1]}, headers=w.agency.headers
    )
    assert r.status_code == 400
    assert (await api.get(T, params={"tab": "drafts"}, headers=w.agency.headers)).json()["items"] == []


async def test_publish_guards(api: httpx.AsyncClient) -> None:
    unverified = await make_agency(verification="pending")
    d0 = await make_driver(unverified)
    v0 = await create_vehicle(api, unverified)
    r = await api.post(T, json=trip_body(v0["id"], d0.uid, start=day()), headers=unverified.headers)
    assert r.status_code == 403 and r.json()["error"]["code"] == "agency_not_verified"
    r = await api.post(T, json=trip_body(v0["id"], d0.uid, start=day(), publish=False), headers=unverified.headers)
    assert r.status_code == 201  # drafts are fine
    assert "Agency not verified" in r.json()["publishBlockers"]
    assert (await api.post(f"{T}/{r.json()['id']}/publish", headers=unverified.headers)).status_code == 403

    a = await make_agency()
    d_unverified = await make_driver(a, verification="pending")
    d_ok = await make_driver(a)
    no_rc = await create_vehicle(api, a, rc=False)
    v = await create_vehicle(api, a)
    r = await api.post(T, json=trip_body(no_rc["id"], d_ok.uid, start=day()), headers=a.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "vehicle_documents_missing"
    assert r.json()["error"]["details"]["tripId"].startswith("trp_")  # draft kept
    draft = await api.get(f"{T}/{r.json()['error']['details']['tripId']}", headers=a.headers)
    assert draft.json()["status"] == "draft" and "Vehicle RC missing" in draft.json()["publishBlockers"]
    r = await api.post(T, json=trip_body(v["id"], d_unverified.uid, start=day()), headers=a.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "driver_not_verified"
    r = await api.post(
        T, json=trip_body(v["id"], d_ok.uid, start=datetime.now(UTC) + timedelta(minutes=30)), headers=a.headers
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_checkpoints"
    r = await api.post(T, json=trip_body(v["id"], d_ok.uid, start=day(61)), headers=a.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "date_too_far"
    # driver made unavailable after the draft was saved
    r = await api.post(T, json=trip_body(v["id"], d_ok.uid, start=day(), publish=False), headers=a.headers)
    await doc_ref(C.drivers, d_ok.uid).update({"availability": "unavailable"})
    r = await api.post(f"{T}/{r.json()['id']}/publish", headers=a.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "driver_unavailable"


async def test_overlapping_assignments_are_refused(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    (v1, v2), (d1, d2) = (x["id"] for x in w.vehicles), (x.uid for x in w.drivers)
    t1 = await create_trip(api, w.agency, v1, d1, start=day(1))
    # same driver, overlapping (within the ±60 min buffer)
    r = await api.post(T, json=trip_body(v2, d1, start=day(1) + timedelta(hours=7)), headers=w.agency.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "driver_schedule_conflict"
    assert r.json()["error"]["details"]["conflictingTripId"] == t1["id"]
    # same vehicle
    r = await api.post(T, json=trip_body(v1, d2, start=day(1) - timedelta(hours=1)), headers=w.agency.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "vehicle_schedule_conflict"
    # well after the buffer: fine
    t3 = await create_trip(api, w.agency, v1, d1, start=day(1) + timedelta(hours=9))
    assert t3["status"] == "published"
    # form options flag the busy resources for a window
    r = await api.get(
        f"{T}/form-options",
        params={"departureAt": iso(day(1)), "arrivalAt": iso(day(1) + timedelta(hours=3))},
        headers=w.agency.headers,
    )
    opts = r.json()
    busy_v = {o["id"]: o["busy"] for o in opts["vehicles"]}
    busy_d = {o["id"]: o["busy"] for o in opts["drivers"]}
    assert busy_v[v1]["tripId"] == t1["id"] and busy_v[v2] is None
    assert busy_d[d1]["tripId"] == t1["id"] and busy_d[d2] is None
    assert {o["rcStatus"] for o in opts["vehicles"]} == {"pending"}
    assert opts["verification"] == "verified"


async def test_t9_concurrent_publishes_for_one_driver(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    d = w.drivers[0].uid
    a = await api.post(T, json=trip_body(w.vehicles[0]["id"], d, start=day(2), publish=False), headers=w.agency.headers)
    b = await api.post(
        T,
        json=trip_body(w.vehicles[1]["id"], d, start=day(2) + timedelta(hours=1), publish=False),
        headers=w.agency.headers,
    )
    ra, rb = await asyncio.gather(
        api.post(f"{T}/{a.json()['id']}/publish", headers=w.agency.headers),
        api.post(f"{T}/{b.json()['id']}/publish", headers=w.agency.headers),
    )
    codes = sorted([ra.status_code, rb.status_code])
    assert codes == [200, 409], (ra.text, rb.text)
    loser = ra if ra.status_code == 409 else rb
    assert loser.json()["error"]["code"] in ("driver_schedule_conflict", "contention")
    sched = await get_doc(C.schedules, f"driver:{d}")
    assert sched and len(sched["intervals"]) == 1


async def test_unpublish_cancel_and_delete(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    v, d = w.vehicles[0]["id"], w.drivers[0].uid
    t = await create_trip(api, w.agency, v, d, start=day())
    r = await api.post(f"{T}/{t['id']}/unpublish", headers=w.agency.headers)
    assert r.status_code == 200 and r.json()["status"] == "draft" and r.json()["searchable"] is False
    sched = await get_doc(C.schedules, f"driver:{d}")
    assert sched and sched["intervals"] == []
    # once published it can't be hard-deleted; never-published drafts can
    assert (await api.delete(f"{T}/{t['id']}", headers=w.agency.headers)).status_code == 409
    fresh = await api.post(T, json=trip_body(v, d, start=day(3), publish=False), headers=w.agency.headers)
    assert (await api.delete(f"{T}/{fresh.json()['id']}", headers=w.agency.headers)).status_code == 204
    assert (await api.get(f"{T}/{fresh.json()['id']}", headers=w.agency.headers)).status_code == 404

    await api.post(f"{T}/{t['id']}/publish", headers=w.agency.headers)
    r = await api.post(f"{T}/{t['id']}/cancel", json={"reason": "Truck breakdown"}, headers=w.agency.headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled" and r.json()["cancelReason"] == "Truck breakdown"
    doc = await raw_trip(t["id"])
    assert doc["searchKeys"] == []
    sched = await get_doc(C.schedules, f"vehicle:{v}")
    assert sched and sched["intervals"] == []
    notes = await query_docs(col(C.notifications).where(filter=FieldFilter("userId", "==", d)))
    assert {n["kind"] for n in notes} >= {"trip_published", "trip_cancelled"}
    # idempotent; and no more edits
    assert (
        await api.post(f"{T}/{t['id']}/cancel", json={"reason": "again"}, headers=w.agency.headers)
    ).status_code == 200
    r = await api.patch(f"{T}/{t['id']}", json={"ratePerKmPaise": 2000}, headers=w.agency.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_transition"
    r = await api.post(f"{T}/{t['id']}/cancel", json={"reason": "x"}, headers=w.agency.headers)
    assert r.status_code == 400  # reason ≥ 3 chars


async def test_edits_draft_and_published(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    v, d = w.vehicles[0]["id"], w.drivers[0].uid
    draft = (await api.post(T, json=trip_body(v, d, start=day(), publish=False), headers=w.agency.headers)).json()
    r = await api.patch(f"{T}/{draft['id']}", json={"goodsNotes": "Dry goods only"}, headers=w.agency.headers)
    assert r.status_code == 200 and r.json()["goods"]["notes"] == "Dry goods only"
    assert r.json()["capacity"]["offeredKg"] == 1000  # partial PATCH keeps fields
    cps = trip_body(v, d, stops=[KRISHNAGIRI, HOSUR, BENGALURU], start=day())["checkpoints"]
    r = await api.patch(f"{T}/{draft['id']}", json={"checkpoints": cps}, headers=w.agency.headers)
    assert r.status_code == 200 and [c["placeName"] for c in r.json()["checkpoints"]] == [
        "Krishnagiri",
        "Hosur",
        "Bengaluru",
    ]
    assert len(r.json()["legs"]) == 2

    t = await create_trip(api, w.agency, w.vehicles[1]["id"], w.drivers[1].uid, start=day(2))
    patch = {"ratePerKmPaise": 1800, "offeredKg": 1500, "maxPackageKg": 300, "additionalCharges": []}
    r = await api.patch(f"{T}/{t['id']}", json=patch, headers=w.agency.headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rates"]["perKmPaise"] == 1800 and body["capacity"]["offeredKg"] == 1500
    assert body["goods"]["maxPackageKg"] == 300 and body["rates"]["additionalCharges"] == []
    r = await api.patch(f"{T}/{t['id']}", json={"offeredKg": 3500}, headers=w.agency.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "capacity_exceeds_vehicle"
    # a hold on the busiest leg blocks cutting capacity below it
    await doc_ref(C.trips, t["id"]).update(
        {"holds.TAKI00000001": {"kg": 900, "fromIndex": 0, "toIndex": 2, "state": "committed", "dueAt": None}}
    )
    r = await api.patch(f"{T}/{t['id']}", json={"offeredKg": 800}, headers=w.agency.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "capacity_below_booked"
    # route / time changes need a trip without bookings
    later = trip_body(w.vehicles[1]["id"], w.drivers[1].uid, start=day(3))["checkpoints"]
    r = await api.patch(f"{T}/{t['id']}", json={"checkpoints": later}, headers=w.agency.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "trip_has_bookings"
    await doc_ref(C.trips, t["id"]).update({"holds": {}})
    r = await api.patch(f"{T}/{t['id']}", json={"checkpoints": later}, headers=w.agency.headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published"
    sched = await get_doc(C.schedules, f"driver:{w.drivers[1].uid}")
    assert sched and sched["intervals"][0]["from"] == day(3) - timedelta(minutes=60)


async def test_reassign_driver_and_vehicle(api: httpx.AsyncClient) -> None:
    w = await make_world(api, drivers=3)
    v1, v2 = (x["id"] for x in w.vehicles)
    d1, d2, d3 = (x.uid for x in w.drivers)
    t = await create_trip(api, w.agency, v1, d1, start=day(1))
    await create_trip(api, w.agency, v2, d3, start=day(1) + timedelta(hours=1))
    r = await api.post(f"{T}/{t['id']}/reassign", json={"driverId": d3}, headers=w.agency.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "driver_schedule_conflict"
    r = await api.post(f"{T}/{t['id']}/reassign", json={"driverId": d2}, headers=w.agency.headers)
    assert r.status_code == 200, r.text
    assert r.json()["driver"]["id"] == d2 and r.json()["driver"]["fullName"] == "Driver 2"
    old = await get_doc(C.schedules, f"driver:{d1}")
    new = await get_doc(C.schedules, f"driver:{d2}")
    assert old and old["intervals"] == [] and new and new["intervals"][0]["tripId"] == t["id"]
    small = await create_vehicle(api, w.agency, maxPayloadKg=800, vehicleClass="Mini Truck", modelId="tata_ace")
    r = await api.post(f"{T}/{t['id']}/reassign", json={"vehicleId": small["id"]}, headers=w.agency.headers)
    assert r.status_code == 200 and r.json()["capacity"]["offeredKg"] == 800  # clamped to the new payload
    assert r.json()["vehicle"]["id"] == small["id"]
    r = await api.post(f"{T}/{t['id']}/reassign", json={}, headers=w.agency.headers)
    assert r.status_code == 400
    # a driver can't be removed while on a live trip
    r = await api.delete(f"/api/v1/agency/drivers/{d2}", headers=w.agency.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "driver_has_active_trips"


async def test_preview_isolation_and_suspension(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    r = await api.post(
        f"{T}/preview",
        json={
            "checkpoints": [{"placeId": COIMBATORE}, {"placeId": TIRUPPUR}, {"placeId": SALEM}],
            "departureAt": iso(day()),
            "ratePerKmPaise": 1500,
            "ratePerKgPaise": 100,
            "sampleWeightKg": 500,
            "additionalCharges": [{"label": "Loading", "amountRupees": 150}],
        },
        headers=w.agency.headers,
    )
    assert r.status_code == 200, r.text
    p = r.json()
    assert [c["placeName"] for c in p["checkpoints"]] == ["Coimbatore", "Tiruppur", "Salem"]
    assert p["checkpoints"][0]["suggestedDepartureAt"] and p["checkpoints"][1]["suggestedArrivalAt"]
    assert p["checkpoints"][2]["suggestedDepartureAt"] is None
    e = p["earningsPreview"]
    assert e["weightCharge"] == 500 and e["additionalCharges"] == 150
    assert e["earnings"] == e["distanceCharge"] + 500 + 150

    t = await create_trip(api, w.agency, w.vehicles[0]["id"], w.drivers[0].uid, start=day())
    other = await make_agency("Other")
    assert (await api.get(f"{T}/{t['id']}", headers=other.headers)).status_code == 404
    assert (
        await api.post(f"{T}/{t['id']}/cancel", json={"reason": "mine now"}, headers=other.headers)
    ).status_code == 404
    assert (await api.get(f"{T}/{t['id']}", headers=w.drivers[0].headers)).status_code == 403

    # admin suspends → search keys cleared, mutations refused; reinstate → restored
    from tests.support.builders import _account  # noqa: PLC2701 - test helper

    admin_uid = "admin" + w.agency.uid[:10]
    await _account(admin_uid, "admin", "+919000000001", "Ops", None, datetime.now(UTC))
    admin = {"X-Test-Uid": admin_uid}
    r = await api.post(
        f"/api/v1/admin/agencies/{w.agency.agency_id}/suspend", json={"reason": "KYC review"}, headers=admin
    )
    assert r.status_code == 200, r.text
    assert (await raw_trip(t["id"]))["searchKeys"] == []
    r = await api.post(T, json=trip_body(w.vehicles[1]["id"], w.drivers[1].uid, start=day(4)), headers=w.agency.headers)
    assert r.status_code == 403 and r.json()["error"]["code"] == "agency_suspended"
    r = await api.post(f"/api/v1/admin/agencies/{w.agency.agency_id}/reinstate", json={}, headers=admin)
    assert r.status_code == 200, r.text
    assert (await raw_trip(t["id"]))["searchKeys"]
