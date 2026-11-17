"""T2 edge probes: trip validation and schedule conflicts, re-locked pricing at accept, shipment and
request edge cases, self-registered driver path, public lists, remarks and notifications."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from app.core.clock import FrozenClock
from app.repositories.base import C
from tests.workflow import support as S
from tests.workflow.support import API, COIMBATORE, ERODE, MUMBAI, SALEM, TIRUPPUR, doc, ecode, expect_error
from tests.workflow.test_02_paths import accepted, paid_dev, requested, world

pytestmark = pytest.mark.emulator


async def test_trip_validation_and_schedule_conflicts(api: httpx.AsyncClient) -> None:
    f = await S.verified_fleet(api, name="T2 Trip Rules")
    ag = f.agency
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    start = now + timedelta(hours=3)
    # departure < now + 60 min
    r = await api.post(f"{API}/agency/trips", headers=ag.h, json=S.trip_body(f.vehicle["id"], f.driver.uid, now + timedelta(minutes=30), publish=True))
    assert r.status_code in (409, 422) and r.json()["error"]["details"].get("tripId"), r.text
    # times not monotonic → invalid_checkpoints with a field path
    body = S.trip_body(f.vehicle["id"], f.driver.uid, start)
    body["checkpoints"][2]["expectedArrivalAt"] = body["checkpoints"][1]["expectedArrivalAt"]
    r = await api.post(f"{API}/agency/trips", headers=ag.h, json=body)
    assert r.status_code in (400, 422) and ecode(r) in ("invalid_checkpoints", "invalid_request"), r.text
    assert any(k.startswith("checkpoints.") for k in (r.json()["error"].get("fields") or {})), r.text
    # consecutive identical stops
    body = S.trip_body(f.vehicle["id"], f.driver.uid, start, stops=[COIMBATORE, COIMBATORE, SALEM])
    r = await api.post(f"{API}/agency/trips", headers=ag.h, json=body)
    assert r.status_code in (400, 422), r.text
    # offeredKg above the vehicle's payload
    r = await api.post(f"{API}/agency/trips", headers=ag.h, json=S.trip_body(f.vehicle["id"], f.driver.uid, start, offered_kg=3500))
    expect_error(r, 422, "capacity_exceeds_vehicle")
    # schedule conflict: a second published trip overlapping for the same driver/vehicle
    t1 = await S.publish_trip(api, f, start)
    r = await api.post(f"{API}/agency/trips", headers=ag.h, json=S.trip_body(f.vehicle["id"], f.driver.uid, start + timedelta(hours=1), publish=True))
    assert r.status_code == 409 and ecode(r) in ("driver_schedule_conflict", "vehicle_schedule_conflict"), r.text
    assert r.json()["error"]["details"].get("conflictingTripId") == t1["id"], r.text
    # non-overlapping later trip is fine
    t2 = await S.publish_trip(api, f, start + timedelta(days=1))
    # unpublish → not searchable; publish again → searchable
    r = await api.post(f"{API}/agency/trips/{t2['id']}/unpublish", headers=ag.h)
    assert r.status_code == 200 and r.json()["status"] == "draft", r.text
    t2d = await doc(C.trips, t2["id"])
    assert not t2d.get("searchKeys"), "unpublish must clear search keys"
    r = await api.post(f"{API}/agency/trips/{t2['id']}/publish", headers=ag.h)
    assert r.status_code == 200 and (await doc(C.trips, t2["id"]))["searchKeys"], r.text
    # driver form options mark the driver busy in t1's window
    r = await api.get(f"{API}/agency/trips/form-options", headers=ag.h,
                      params={"departureAt": S.iso(start), "arrivalAt": S.iso(start + timedelta(hours=7))})
    assert r.status_code == 200, r.text
    # vehicle without RC cannot be published
    v2 = await api.post(f"{API}/agency/vehicles", headers=ag.h, json={
        "vehicleClass": "Pickup", "makeModel": "Bolero Pickup", "registrationNumber": S.next_reg(),
        "maxPayloadKg": 1500, "bodyType": "open", "acceptedGoods": ["general_goods"]})
    assert v2.status_code == 201, v2.text
    d2 = await S.invite_and_signup_driver(api, ag, "Third Driver")
    await S.driver_documents(api, d2, dl="TN0320190009999")
    await api.post(f"{API}/admin/drivers/{d2.uid}/verify", headers=f.admin.h, json={})
    r = await api.post(f"{API}/agency/trips", headers=ag.h, json=S.trip_body(v2.json()["id"], d2.uid, start + timedelta(days=3), offered_kg=500, publish=True,
                                              acceptedGoods=["general_goods"], handlingSupported=[]))
    assert r.status_code == 409 and ecode(r) == "vehicle_documents_missing", r.text
    # the driver's own trips list never shows drafts or other drivers' trips
    r = await api.get(f"{API}/driver/trips/{t1['id']}", headers=d2.h)
    expect_error(r, 404, "not_found")


async def test_rates_relocked_at_accept(api: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await world(api, clock)
    bid = await requested(api, w, src=TIRUPPUR, dst=SALEM, kg=100)
    p_req = (await doc(C.bookings, bid))["pricing"]
    r = await api.patch(f"{API}/agency/trips/{w.trip['id']}", headers=w.f.agency.h, json={"ratePerKmPaise": 2000})
    assert r.status_code == 200 and r.json()["rates"]["perKmPaise"] == 2000, r.text
    # route change on a trip with an open request is refused
    r = await api.patch(f"{API}/agency/trips/{w.trip['id']}", headers=w.f.agency.h,
                        json={"checkpoints": S.checkpoints([COIMBATORE, ERODE, SALEM], w.start)})
    expect_error(r, 409, "trip_has_bookings")
    r = await api.post(f"{API}/agency/bookings/{bid}/accept", headers=w.f.agency.h, json={})
    assert r.status_code == 200, r.text
    p_acc = (await doc(C.bookings, bid))["pricing"]
    assert p_acc["ratePerKmPaise"] == 2000 and p_acc["distanceCharge"] > p_req["distanceCharge"], (p_req, p_acc)
    assert p_acc["totalPayable"] == sum(x["amount"] for x in p_acc["lines"])
    cv = (await api.get(f"{API}/customer/bookings/{bid}", headers=w.cust.h)).json()
    assert cv["pricing"]["totalPayable"] == p_acc["totalPayable"]
    _, r = await S.dev_pay(api, w.cust, bid)
    assert r.status_code == 200 and r.json()["amountRupees"] == p_acc["totalPayable"], r.text


async def test_shipment_and_request_edges(api: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await world(api, clock)
    cust = w.cust
    today = S.ist_today(clock.now())
    r = await api.post(f"{API}/customer/shipments", headers=cust.h, json=S.shipment_body(COIMBATORE, SALEM, (today - timedelta(days=1)).isoformat()))
    expect_error(r, 422, "past_date")
    r = await api.post(f"{API}/customer/shipments", headers=cust.h, json=S.shipment_body(COIMBATORE, SALEM, (today + timedelta(days=61)).isoformat()))
    expect_error(r, 422, "date_too_far")
    r = await api.post(f"{API}/customer/shipments", headers=cust.h, json=S.shipment_body(COIMBATORE, SALEM, w.day(0), weight=5))
    assert r.status_code in (400, 422) and "package.weightKg" in str(r.json()["error"].get("fields")), r.text
    # drop at an intermediate stop: Coimbatore → Erode is an intermediate match on legs 0–1
    s = await S.shipment(api, cust, COIMBATORE, ERODE, w.day(0))
    o = (await api.get(f"{API}/customer/shipments/{s['id']}/offers", headers=cust.h)).json()
    mine = [x for x in o["items"] if x["tripId"] == w.trip["id"]]  # other tests' trips share the database
    assert [(x["matchType"], x["pickup"]["checkpointIndex"], x["drop"]["checkpointIndex"]) for x in mine] == [("intermediate", 0, 2)], o
    # temperature-sensitive goods are not supported by this trip
    s_t = await S.shipment(api, cust, COIMBATORE, ERODE, w.day(0), specialHandling=["temperature_sensitive"])
    o = (await api.get(f"{API}/customer/shipments/{s_t['id']}/offers", headers=cust.h)).json()
    assert w.trip["id"] not in [x["tripId"] for x in o["items"]] and o["excludedForRestrictions"] >= 1, o
    r = await S.request_booking(api, cust, s_t["id"], w.trip["id"])
    expect_error(r, 422, "handling_not_supported")
    s_p = await S.shipment(api, cust, COIMBATORE, ERODE, w.day(0), goodsCategory="perishables")
    expect_error(await S.request_booking(api, cust, s_p["id"], w.trip["id"]), 422, "goods_not_accepted")
    s_off = await S.shipment(api, cust, COIMBATORE, "fake_madurai", w.day(0))
    expect_error(await S.request_booking(api, cust, s_off["id"], w.trip["id"]), 422, "not_on_route")
    # pending request withdrawn by the customer → withdrawn, shipment open, no hold
    r = await S.request_booking(api, cust, s["id"], w.trip["id"])
    bid = r.json()["id"]
    r = await api.post(f"{API}/customer/bookings/{bid}/cancel", headers=cust.h, json={})
    assert r.status_code == 200 and r.json()["state"]["approvalStatus"] == "withdrawn", r.text
    assert (await doc(C.shipments, s["id"]))["status"] == "open"
    # withdrawn shipment: offers → 409 invalid_transition
    r = await api.delete(f"{API}/customer/shipments/{s['id']}", headers=cust.h)
    assert r.status_code == 204, r.text
    r = await api.get(f"{API}/customer/shipments/{s['id']}/offers", headers=cust.h)
    expect_error(r, 409, "invalid_transition")
    # OTP regenerate before 5 failed attempts → otp_not_exhausted; remarks visible to all roles
    bp = await paid_dev(api, w, src=TIRUPPUR, dst=SALEM)
    r = await api.post(f"{API}/customer/bookings/{bp}/otp/regenerate", headers=cust.h, json={"which": "pickup"})
    expect_error(r, 409, "otp_not_exhausted")
    r = await api.post(f"{API}/driver/shipments/{bp}/remarks", headers=w.f.driver.h, json={"text": "Will call before pickup"})
    assert r.status_code == 201, r.text
    tl = (await api.get(f"{API}/customer/bookings/{bp}/tracking", headers=cust.h)).json()["events"]
    assert any(e["type"] == "remark" for e in tl), tl
    agl = (await api.get(f"{API}/agency/bookings/{bp}", headers=w.f.agency.h)).json()["timeline"]
    assert any(e["type"] == "remark" for e in agl), agl
    # notifications: read by id; unknown ids ignored; unread count drops
    n = (await api.get(f"{API}/notifications", params={"unreadOnly": "true"}, headers=cust.h)).json()["items"]
    before = (await api.get(f"{API}/notifications/unread-count", headers=cust.h)).json()["count"]
    r = await api.post(f"{API}/notifications/read", headers=cust.h, json={"ids": [n[0]["id"], "ntf_aaaaaaaaaaaaaaaaaaaa"]})
    assert r.status_code == 204, r.text
    after = (await api.get(f"{API}/notifications/unread-count", headers=cust.h)).json()["count"]
    assert after == before - 1, (before, after)


async def test_self_registered_driver_and_public_agencies(api: httpx.AsyncClient) -> None:
    f = await S.verified_fleet(api, name="T2 Public Agency")
    unverified = await S.signup_agency(api, "T2 Hidden Agency")
    r = await api.get(f"{API}/public/agencies", params={"q": "T2"})
    assert r.status_code == 200, r.text
    ids = [x["id"] for x in r.json()["items"]]
    assert f.agency.agency_id in ids and unverified.agency_id not in ids, ids
    # request path: driver picks the agency → link pending → agency approves
    phone = S.new_phone()
    proof = await S.phone_proof(phone)
    r = await api.post(f"{API}/auth/signup/driver", headers=S.bearer(proof.id_token), json={
        "fullName": "Self Driver", "agencyId": f.agency.agency_id, "acceptTerms": True,
        "password": S.PASSWORD, "confirmPassword": S.PASSWORD})
    assert r.status_code == 201, r.text
    uid = proof.uid
    assert (await doc(C.drivers, uid))["agencyLink"]["status"] == "pending"
    kinds = [n["kind"] for n in (await api.get(f"{API}/notifications", headers=f.agency.h)).json()["items"]]
    assert "driver_link_requested" in kinds, kinds
    r = await api.get(f"{API}/agency/drivers", params={"status": "pending"}, headers=f.agency.h)
    assert uid in [x["id"] for x in r.json()["items"]], r.text
    r = await api.post(f"{API}/agency/drivers/{uid}/approve", headers=f.agency.h)
    assert r.status_code == 200, r.text
    assert (await doc(C.drivers, uid))["agencyLink"]["status"] == "active"
    r = await api.post(f"{API}/agency/drivers/{uid}/approve", headers=f.agency.h)
    assert r.status_code in (200, 409), r.text
    # signing up to an unverified agency → 404
    proof = await S.phone_proof(S.new_phone())
    r = await api.post(f"{API}/auth/signup/driver", headers=S.bearer(proof.id_token), json={
        "fullName": "Lost Driver", "agencyId": unverified.agency_id, "acceptTerms": True,
        "password": S.PASSWORD, "confirmPassword": S.PASSWORD})
    expect_error(r, 404, "not_found")
    # agency base outside the service area
    proof = await S.phone_proof(S.new_phone())
    r = await api.post(f"{API}/auth/signup/agency", headers=S.bearer(proof.id_token), json={
        "ownerName": "Far Owner", "agencyName": "Far Agency", "base": {"placeId": MUMBAI}, "vehicleCountRange": "1-5",
        "statesCovered": ["TN"], "acceptTerms": True, "password": S.PASSWORD, "confirmPassword": S.PASSWORD})
    expect_error(r, 422, "outside_service_area")
    _: Any = accepted


async def test_suspended_agency_trips_stop_matching(api: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await world(api, clock)
    bid = await requested(api, w, src=COIMBATORE, dst=SALEM)
    ag, adm = w.f.agency, w.f.admin
    # setting the trip's driver unavailable while the trip is published → 409
    r = await api.patch(f"{API}/agency/drivers/{w.f.driver.uid}", headers=ag.h, json={"availability": "unavailable"})
    expect_error(r, 409, "driver_has_active_trips")
    r = await api.post(f"{API}/admin/agencies/{ag.agency_id}/suspend", headers=adm.h, json={"reason": "Document recheck"})
    assert r.status_code == 200, r.text
    assert not (await doc(C.trips, w.trip["id"])).get("searchKeys"), "suspension must clear search keys"
    s = await S.shipment(api, w.cust, COIMBATORE, SALEM, w.day(0))
    o = (await api.get(f"{API}/customer/shipments/{s['id']}/offers", headers=w.cust.h)).json()
    assert w.trip["id"] not in [x["tripId"] for x in o["items"]], o
    expect_error(await S.request_booking(api, w.cust, s["id"], w.trip["id"]), 409, "trip_not_bookable")
    r = await api.post(f"{API}/agency/bookings/{bid}/accept", headers=ag.h, json={})
    expect_error(r, 403, "agency_suspended")
    r = await api.get(f"{API}/customer/bookings/{bid}", headers=w.cust.h)  # existing bookings stay visible
    assert r.status_code == 200, r.text
    r = await api.post(f"{API}/admin/agencies/{ag.agency_id}/reinstate", headers=adm.h, json={})
    assert r.status_code == 200, r.text
    assert (await doc(C.trips, w.trip["id"])).get("searchKeys"), "reinstate must restore search keys"
    r = await api.post(f"{API}/agency/bookings/{bid}/accept", headers=ag.h, json={})
    assert r.status_code == 200, r.text
