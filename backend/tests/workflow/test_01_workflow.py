"""T2 §6.2: the complete three-role workflow from an empty database, real auth, Firestore checked
after each step. Runs in-process (default) or against the live server (``T2_BASE_URL``)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest

from app.repositories.base import C
from tests.workflow import support as S
from tests.workflow.support import (
    API,
    COIMBATORE,
    MUMBAI,
    SALEM,
    TIRUPPUR,
    doc,
    ecode,
    expect_error,
    expect_keys,
)

pytestmark = pytest.mark.emulator

STATE: dict[str, Any] = {}  # shared with later modules (earnings/settlement, invariants)


async def test_full_three_role_workflow(api: httpx.AsyncClient) -> None:  # noqa: PLR0915
    now = datetime.now(UTC)

    # ── 1. admin bootstrap ────────────────────────────────────────────────────
    adm = await S.admin(api)
    u = await doc(C.users, adm.uid)
    assert u["role"] == "admin" and u["status"] == "active"
    r = await api.get(f"{API}/me", headers=adm.h)
    assert r.status_code == 200 and r.json()["role"] == "admin", r.text
    expect_keys(
        r.json(),
        ["id", "role", "name", "phoneMasked", "photoUrl", "agency", "driver", "claimsVersion"],
        "E12 SessionUserDTO",
    )
    # public login page with the admin's phone and role customer → wrong_role (after a correct password)
    r = await S.login(api, "customer", adm.phone)
    assert r.status_code == 403 and ecode(r) == "wrong_role", r.text
    cred = await doc(C.credentials, adm.uid) if hasattr(C, "credentials") else {}
    assert "password" not in cred

    # ── 2. agency signup (OTP proof) + documents ──────────────────────────────
    ag = await S.signup_agency(api, "T2 Roadways")
    assert ag.agency_id and ag.agency_id.startswith("agc_")
    agency_doc = await doc(C.agencies, ag.agency_id)
    assert agency_doc["verification"]["status"] == "not_submitted"
    assert agency_doc["base"]["placeId"] == COIMBATORE and agency_doc["ownerUid"] == ag.uid
    assert (await doc(C.users, ag.uid))["role"] == "agency"
    assert ag.body["user"]["agency"]["verification"] == "not_submitted"

    # vehicle + driver before verification are allowed; publishing is not
    veh = await S.vehicle(api, ag)
    assert veh["rcVerification"]["status"] == "pending" and veh["rc"]
    expect_keys(veh, ["id", "registrationNumber", "photos", "rc", "rcVerification", "maxPayloadKg"], "E53 VehicleDTO")
    vdoc = await doc(C.vehicles, veh["id"])
    assert vdoc["agencyId"] == ag.agency_id

    drv = await S.invite_and_signup_driver(api, ag, "Selvam Driver")
    ddoc = await doc(C.drivers, drv.uid)
    assert ddoc["agencyLink"]["status"] == "active" and ddoc["agencyLink"]["agencyId"] == ag.agency_id
    assert ddoc["verification"]["status"] == "not_submitted"
    invites = await S.docs_where(C.driver_invites, "phone", drv.phone)
    assert invites and invites[0]["status"] == "accepted"

    start = (now + timedelta(minutes=80)).replace(second=0, microsecond=0)
    body = S.trip_body(veh["id"], drv.uid, start, publish=False)
    r = await api.post(f"{API}/agency/trips", json=body, headers=ag.h)
    assert r.status_code == 201, r.text
    draft = r.json()
    assert draft["status"] == "draft"
    blockers = " | ".join(draft["publishBlockers"])
    assert "Agency not verified" in blockers and "Driver documents not verified" in blockers, blockers
    r = await api.post(f"{API}/agency/trips/{draft['id']}/publish", headers=ag.h)
    expect_error(r, 403, "agency_not_verified")

    await S.agency_documents(api, ag)
    r = await api.get(f"{API}/agency/verification", headers=ag.h)
    assert r.status_code == 200, r.text
    ver = r.json()
    expect_keys(ver, ["status", "reason", "submittedAt", "reviewedAt", "requirements"], "E50")
    assert all(x["done"] for x in ver["requirements"]), ver
    if ver["status"] == "not_submitted":
        r = await api.post(f"{API}/agency/verification", headers=ag.h, json={})
        assert r.status_code == 200, r.text
    assert (await doc(C.agencies, ag.agency_id))["verification"]["status"] == "pending"
    pan = (await doc(C.agencies, ag.agency_id))["identityDocument"]
    assert "number" not in pan and pan["numberMasked"].endswith("234F") and pan.get("numberHmac")

    # ── 3. admin verifies the agency ──────────────────────────────────────────
    r = await api.get(f"{API}/admin/agencies?status=pending", headers=adm.h)
    assert r.status_code == 200 and ag.agency_id in [x["id"] for x in r.json()["items"]], r.text
    expect_keys(r.json(), ["items", "nextCursor"], "E109 Page")
    r = await api.post(f"{API}/admin/agencies/{ag.agency_id}/verify", headers=adm.h, json={})
    assert r.status_code == 200, r.text
    assert r.json()["verification"]["status"] == "verified" if isinstance(r.json().get("verification"), dict) else True
    adoc = await doc(C.agencies, ag.agency_id)
    assert adoc["verification"]["status"] == "verified" and adoc["verification"]["reviewedBy"] == adm.uid
    audit = await S.docs_where(C.audit_log, "target.id", ag.agency_id)
    assert audit, "admin verify must write auditLog"

    # ── 4. driver documents + admin verifies the driver; RC verified ──────────
    await S.driver_documents(api, drv)
    assert (await doc(C.drivers, drv.uid))["verification"]["status"] == "pending"
    lic = (await doc(C.drivers, drv.uid))["license"]
    assert "number" not in lic and lic.get("numberHmac") and lic["numberMasked"].endswith("1234")
    r = await api.post(f"{API}/admin/drivers/{drv.uid}/verify", headers=adm.h, json={})
    assert r.status_code == 200, r.text
    assert (await doc(C.drivers, drv.uid))["verification"]["status"] == "verified"
    r = await api.post(f"{API}/admin/vehicles/{veh['id']}/rc/verify", headers=adm.h, json={})
    assert r.status_code == 200, r.text
    assert (await doc(C.vehicles, veh["id"]))["rcVerification"]["status"] == "verified"

    # ── 5. trip: preview, then publish the draft (route legs from fake Maps) ──
    r = await api.post(
        f"{API}/agency/trips/preview",
        headers=ag.h,
        json={
            "checkpoints": [{"placeId": p} for p in S.STOPS],
            "departureAt": S.iso(start),
            "ratePerKmPaise": 1500,
            "ratePerKgPaise": 100,
            "sampleWeightKg": 100,
        },
    )
    assert r.status_code == 200, r.text
    pv = r.json()
    assert pv["distanceKm"] > 0 and all(c["lat"] for c in pv["checkpoints"]) and pv["overviewPolyline"]
    r = await api.post(f"{API}/agency/trips/{draft['id']}/publish", headers=ag.h)
    assert r.status_code == 200, r.text
    trip = r.json()
    tid = trip["id"]
    assert trip["status"] == "published" and trip["searchable"] and len(trip["legs"]) == 3
    assert all(leg["distanceKm"] > 0 and leg["durationMin"] > 0 for leg in trip["legs"])
    assert trip["capacity"]["offeredKg"] == 500 and trip["capacity"]["availableKg"] == 500
    assert [c["placeId"] for c in trip["checkpoints"]] == S.STOPS
    assert trip["rates"]["perKmPaise"] == 1500 and len(trip["rates"]["additionalCharges"]) == 2
    tdoc = await doc(C.trips, tid)
    assert tdoc["status"] == "published" and tdoc["searchKeys"] and len(tdoc["legs"]) == 3 and tdoc["route"]
    km = [c["kmFromOrigin"] for c in trip["checkpoints"]]
    assert km[0] == 0 and km == sorted(km) and km[-1] > 0
    r = await api.get(f"{API}/agency/trips?tab=upcoming", headers=ag.h)
    assert tid in [x["id"] for x in r.json()["items"]]
    expect_keys(r.json(), ["items", "nextCursor", "counts"], "E71 TripListResponse")

    # ── 6. customer signup: 18 today accepted, one day short refused ──────────
    today = S.ist_today(now)
    exactly_18 = S.years_ago(today, 18)
    r_young = await _signup_raw(api, (exactly_18 + timedelta(days=1)).isoformat())
    expect_error(r_young, 422, "underage")
    cust = await S.signup_customer(api, dob=exactly_18.isoformat(), name="Ravi Kumar")
    cdoc = await doc(C.customers, cust.uid)
    assert cdoc["dob"] == exactly_18.isoformat()

    # ── 7. shipments + search ─────────────────────────────────────────────────
    cps = trip["checkpoints"]
    dep = {i: datetime.fromisoformat(cps[i]["expectedDepartureAt"].replace("Z", "+00:00")) for i in range(3)}
    day1 = S.ist_day(dep[1])  # Tiruppur pickup day
    day0 = S.ist_day(dep[0])
    s_mid = await S.shipment(api, cust, TIRUPPUR, SALEM, day1, weight=100)  # intermediate
    assert s_mid["status"] == "open" and s_mid["directDistanceKm"] > 1
    sdoc = await doc(C.shipments, s_mid["id"])
    assert sdoc["customerId"] == cust.uid and sdoc["source"]["place"]["placeId"] == TIRUPPUR

    async def offers(sid: str) -> dict[str, Any]:
        r = await api.get(f"{API}/customer/shipments/{sid}/offers", headers=cust.h)
        assert r.status_code == 200, r.text
        return dict(r.json())

    o = await offers(s_mid["id"])
    expect_keys(o, ["items", "excludedForCapacity", "excludedForRestrictions", "date"], "E31 OffersResponse")
    assert [x["tripId"] for x in o["items"]] == [tid], o
    off = o["items"][0]
    assert (
        off["matchType"] == "intermediate"
        and off["pickup"]["checkpointIndex"] == 1
        and off["drop"]["checkpointIndex"] == 3
    )
    assert off["availableCapacityKg"] == 500
    expect_keys(
        off,
        ["matchType", "distanceSource", "pickup", "drop", "route", "rates", "pricing", "availableCapacityKg"],
        "E31 TripOfferDTO",
    )

    s_exact = await S.shipment(api, cust, COIMBATORE, SALEM, day0, weight=100)
    o = await offers(s_exact["id"])
    assert [x["tripId"] for x in o["items"]] == [tid] and o["items"][0]["matchType"] == "exact"

    s_rev = await S.shipment(api, cust, SALEM, TIRUPPUR, day1, weight=100)  # drop before pickup
    assert (await offers(s_rev["id"]))["items"] == []
    wrong_day = (datetime.fromisoformat(day1) + timedelta(days=2)).date().isoformat()
    s_date = await S.shipment(api, cust, TIRUPPUR, SALEM, wrong_day, weight=100)
    assert (await offers(s_date["id"]))["items"] == []
    s_peri = await S.shipment(api, cust, TIRUPPUR, SALEM, day1, weight=100, goodsCategory="perishables")
    o = await offers(s_peri["id"])
    assert o["items"] == [] and o["excludedForRestrictions"] >= 1, o
    s_big = await S.shipment(api, cust, TIRUPPUR, SALEM, day1, weight=600)
    o = await offers(s_big["id"])
    assert o["items"] == [] and o["excludedForCapacity"] >= 1, o
    r = await api.post(f"{API}/customer/shipments", json=S.shipment_body(TIRUPPUR, TIRUPPUR, day1), headers=cust.h)
    # same place: contract §8.1 says "422 invalid_request", but invalid_request is 400 in the catalog
    assert (
        r.status_code in (400, 422) and ecode(r) == "invalid_request" and "destination" in r.json()["error"]["fields"]
    ), r.text
    if r.status_code == 400:
        S.CONTRACT_NOTES.add(
            "E26 same-place shipment: 400 invalid_request (contract §8.1 text says 422; catalog says 400)"
        )
    r = await api.post(f"{API}/customer/shipments", json=S.shipment_body(MUMBAI, SALEM, day1), headers=cust.h)
    assert r.status_code == 422 and ecode(r) in ("outside_service_area", "address_state_mismatch"), r.text

    # guest search (public) finds the same trip
    r = await api.get(
        f"{API}/customer/search", params={"fromPlaceId": TIRUPPUR, "toPlaceId": SALEM, "weightKg": 100, "date": day1}
    )
    assert r.status_code == 200 and [x["tripId"] for x in r.json()["items"]] == [tid], r.text

    # ── 8. trip detail with pricing lines (server computes; half-up) ──────────
    r = await api.get(f"{API}/customer/trips/{tid}", params={"shipmentId": s_mid["id"]}, headers=cust.h)
    assert r.status_code == 200, r.text
    det = r.json()
    expect_keys(
        det,
        ["vehicle", "agency", "driver", "reviews", "route", "pricing", "routePolyline", "legs"],
        "E33 TripDetailsDTO",
    )
    p = det["pricing"]
    seg = Decimal(str(cps[3]["kmFromOrigin"])) - Decimal(str(cps[1]["kmFromOrigin"]))
    assert p["pricingVersion"] == 3
    assert p["distanceCharge"] == S.half_up(seg * 1500 / 100), (p, seg)
    assert p["weightCharge"] == S.half_up(Decimal(100) * 100 / 100)
    assert p["additionalCharges"] == 50 and p["serviceFee"] == 350  # fragile-care only with special handling
    assert p["totalPayable"] == sum(x["amount"] for x in p["lines"]) == p["transportationCharge"] + 50 + 350
    assert p["agencyNet"] == p["totalPayable"] - p["serviceFee"]
    assert [x["code"] for x in p["lines"]] == ["distance", "weight", "additional", "service_fee"]
    s_fragile = await S.shipment(api, cust, TIRUPPUR, SALEM, day1, weight=100, specialHandling=["fragile"])
    r = await api.get(f"{API}/customer/trips/{tid}", params={"shipmentId": s_fragile["id"]}, headers=cust.h)
    assert r.json()["pricing"]["additionalCharges"] == 150, r.json()["pricing"]

    # ── 9. booking request (idempotent), reject path, accept path ─────────────
    key = S.idem()
    breq = {"shipmentId": s_mid["id"], "tripId": tid, "totalPayable": 1}  # a client price is ignored
    r = await api.post(f"{API}/customer/bookings", json=breq, headers={**cust.h, **key})
    assert r.status_code in (201, 422), r.text
    if r.status_code == 422:  # strict body: retry without the extra field
        S.CONTRACT_NOTES.add("E34: unknown body field totalPayable is rejected with 422 (strict schema)")
        breq.pop("totalPayable")
        r = await api.post(f"{API}/customer/bookings", json=breq, headers={**cust.h, **key})
        assert r.status_code == 201, r.text
    b = r.json()
    bid = b["id"]
    assert b["state"]["approvalStatus"] == "pending" and b["pricing"]["totalPayable"] == p["totalPayable"]
    r = await api.post(f"{API}/customer/bookings", json=breq, headers={**cust.h, **key})
    assert r.status_code == 200 and r.json()["id"] == bid, r.text
    assert len(await S.docs_where(C.bookings, "shipmentId", s_mid["id"])) == 1
    bdoc = await doc(C.bookings, bid)
    assert (bdoc["approvalStatus"], bdoc["paymentStatus"], bdoc["reservationStatus"], bdoc["fulfilmentStatus"]) == (
        "pending",
        "not_due",
        "none",
        "not_started",
    )
    assert (await doc(C.shipments, s_mid["id"]))["status"] == "requested"
    assert (await doc(C.trips, tid)).get("holds", {}).get(bid) is None  # no hold before acceptance
    await S.assert_synced(api, bid, cust, ag)

    # the driver cannot see an unpaid booking
    r = await api.get(f"{API}/driver/shipments/{bid}", headers=drv.h)
    assert r.status_code == 404, r.text

    # reject path on the exact shipment
    r = await S.request_booking(api, cust, s_exact["id"], tid)
    assert r.status_code == 201, r.text
    bid_rej = r.json()["id"]
    r = await api.get(f"{API}/agency/bookings?tab=pending", headers=ag.h)
    assert {bid, bid_rej} <= {x["id"] for x in r.json()["items"]}
    expect_keys(r.json(), ["items", "nextCursor", "counts"], "E80 BookingListResponse")
    r = await api.post(
        f"{API}/agency/bookings/{bid_rej}/reject", headers=ag.h, json={"reason": "Vehicle full at origin"}
    )
    assert r.status_code == 200, r.text
    v = await S.assert_synced(api, bid_rej, cust, ag)
    assert v["customer"]["status"] == "rejected" and v["customer"]["state"]["closure"]["reason"]
    assert (await doc(C.shipments, s_exact["id"]))["status"] == "open"
    assert bid_rej not in (await doc(C.trips, tid)).get("holds", {})

    # accept → capacity held per leg
    r = await api.post(f"{API}/agency/bookings/{bid}/accept", headers=ag.h, json={})
    assert r.status_code == 200, r.text
    v = await S.assert_synced(api, bid, cust, ag, drv)
    assert v["customer"]["status"] == "pending_payment" and v["driver_status"] == 404
    assert v["customer"]["vehicle"]["registrationNumber"] and v["customer"]["driver"]["name"]
    tdoc = await doc(C.trips, tid)
    assert tdoc["holds"][bid]["state"] == "held" and tdoc["holds"][bid]["kg"] == 100
    r = await api.get(f"{API}/agency/trips/{tid}", headers=ag.h)
    t2 = r.json()
    assert [leg["loadKg"] for leg in t2["legs"]] == [0, 100, 100], t2["legs"]
    assert t2["capacity"]["reservedKg"] == 100 and t2["capacity"]["availableKg"] == 400

    # ── 10. payment: dev test gateway, failed then retried ────────────────────
    pid1, r = await S.dev_pay(api, cust, bid, "failure")
    assert r.status_code == 200, r.text
    v = await S.assert_synced(api, bid, cust, ag)
    assert v["customer"]["status"] == "payment_failed" and v["customer"]["otps"] is None
    assert (await doc(C.payments, pid1))["status"] == "failed"
    pid2, r = await S.dev_pay(api, cust, bid, "success")
    assert r.status_code == 200 and r.json()["status"] == "succeeded", r.text
    assert pid2 != pid1
    v = await S.assert_synced(api, bid, cust, ag, drv)
    cv = v["customer"]
    assert (
        cv["status"] == "confirmed"
        and cv["state"]["paymentStatus"] == "paid"
        and cv["state"]["reservationStatus"] == "committed"
    )
    otps = cv["otps"]
    assert otps and len(otps["pickup"]) == 6 and len(otps["delivery"]) == 6
    assert v["driver_status"] == 200 and v["driver"]["customer"]["phone"] == cust.phone
    assert (await doc(C.trips, tid))["holds"][bid]["state"] == "committed"
    assert (await doc(C.shipments, s_mid["id"]))["status"] == "booked"
    r = await api.get(f"{API}/payments/{pid2}", headers=cust.h)
    assert r.status_code == 200 and r.json()["bookingState"]["paymentStatus"] == "paid", r.text
    r = await api.get(f"{API}/payments/history", headers=cust.h)
    assert {pid1, pid2} <= {x["paymentId"] if "paymentId" in x else x.get("id") for x in r.json()["items"]}, r.text

    # ── 11. driver: start trip, pickup OTP (attempt limit), checkpoints, delivery ─
    r = await api.get(f"{API}/driver/trips", headers=drv.h)
    assert r.status_code == 200 and tid in [x["id"] for x in r.json()["items"]], r.text
    r = await api.post(f"{API}/driver/trips/{tid}/checkpoints/0/depart", headers=drv.h, json={})
    assert r.status_code == 200 and r.json()["status"] == "in_progress", r.text
    r = await api.post(f"{API}/driver/trips/{tid}/checkpoints/2/arrive", headers=drv.h, json={})
    expect_error(r, 409, "checkpoint_out_of_order")
    r = await api.post(
        f"{API}/driver/trips/{tid}/checkpoints/1/arrive", headers=drv.h, json={"remarks": "Reached Tiruppur"}
    )
    assert r.status_code == 200, r.text
    wrong = "000000" if otps["pickup"] != "000000" else "111111"
    left = []
    for _ in range(5):
        r = await api.post(f"{API}/driver/shipments/{bid}/pickup", headers=drv.h, json={"otp": wrong})
        assert r.status_code == 422, r.text
        left.append((ecode(r), (r.json()["error"].get("details") or {}).get("attemptsLeft")))
    assert left[0] == ("otp_invalid", 4) and left[-1][0] in ("too_many_attempts", "otp_invalid"), left
    r = await api.post(f"{API}/driver/shipments/{bid}/pickup", headers=drv.h, json={"otp": otps["pickup"]})
    expect_error(r, 422, "too_many_attempts")
    r = await api.post(f"{API}/customer/bookings/{bid}/otp/regenerate", headers=cust.h, json={"which": "pickup"})
    assert r.status_code == 200, r.text
    new_pickup = r.json()["otps"]["pickup"]
    r = await api.post(
        f"{API}/driver/shipments/{bid}/pickup", headers=drv.h, json={"otp": new_pickup, "remarks": "2 boxes"}
    )
    assert r.status_code == 200 and r.json()["status"] == "picked_up", r.text
    await S.assert_synced(api, bid, cust, ag, drv)
    r = await api.post(f"{API}/customer/bookings/{bid}/cancel", headers=cust.h, json={"reason": "changed mind"})
    expect_error(r, 409, "invalid_transition")  # cancel after pickup refused

    r = await api.post(f"{API}/driver/trips/{tid}/checkpoints/1/depart", headers=drv.h, json={})
    assert r.status_code == 200, r.text
    assert (await doc(C.bookings, bid))["fulfilmentStatus"] == "in_transit"
    for path in ("2/arrive", "2/depart", "3/arrive"):
        r = await api.post(f"{API}/driver/trips/{tid}/checkpoints/{path}", headers=drv.h, json={"remarks": "on time"})
        assert r.status_code == 200, (path, r.text)
    v = await S.assert_synced(api, bid, cust, ag, drv)
    assert v["customer"]["status"] == "out_for_delivery"
    r = await api.post(f"{API}/customer/bookings/{bid}/review", headers=cust.h, json={"rating": 5})
    expect_error(r, 409, "invalid_transition")  # review only after delivery

    r = await api.post(
        f"{API}/driver/shipments/{bid}/deliver",
        headers=drv.h,
        files={"otp": (None, wrong), "receivedBy": (None, "Meena")},
    )
    expect_error(r, 422, "otp_invalid")
    r = await api.post(
        f"{API}/driver/shipments/{bid}/deliver",
        headers=drv.h,
        data={"otp": otps["delivery"], "receivedBy": "Meena", "remarks": "Handed over"},
        files=[("proof", ("p.jpg", S.jpeg(), "image/jpeg"))],
    )
    assert r.status_code == 200 and r.json()["status"] == "delivered", r.text
    v = await S.assert_synced(api, bid, cust, ag, drv)
    assert v["customer"]["otps"] is None and v["driver"]["customer"]["phone"] is None
    bdoc = await doc(C.bookings, bid)
    assert bdoc["reservationStatus"] == "consumed" and bdoc["deliveredAt"]
    assert bid not in (await doc(C.trips, tid)).get("holds", {})
    earning = await doc(C.earnings, bid)
    assert earning["status"] == "pending" and earning["agencyNet"] == bdoc["pricing"]["agencyNet"]
    assert (await doc(C.shipments, s_mid["id"]))["status"] == "delivered"

    # ── 12. tracking timeline: timestamped, ordered, no fabricated GPS ────────
    r = await api.get(f"{API}/customer/bookings/{bid}/tracking", headers=cust.h)
    assert r.status_code == 200, r.text
    tr = r.json()
    assert tr["liveLocation"] is None
    types = [e["type"] for e in tr["events"]]
    for t in (
        "requested",
        "accepted",
        "payment_failed",
        "payment_succeeded",
        "picked_up",
        "in_transit",
        "checkpoint_arrived",
        "out_for_delivery",
        "delivered",
    ):
        assert t in types, (t, types)
    stamps = [e["at"] for e in tr["events"]]
    assert stamps == sorted(stamps) and all(x.endswith("Z") for x in stamps)
    for e in tr["events"]:
        assert not ({"lat", "lng", "location", "position"} & set(e)), e
    assert all("lat" in c for c in tr.get("checkpoints", [])), "checkpoint coordinates are geocoded stops"

    # ── 13. review once; aggregates ───────────────────────────────────────────
    r = await api.post(f"{API}/customer/bookings/{bid}/review", headers=cust.h, json={"rating": 4, "comment": "Good"})
    assert r.status_code == 201, r.text
    r = await api.post(f"{API}/customer/bookings/{bid}/review", headers=cust.h, json={"rating": 5})
    expect_error(r, 409, "already_reviewed")
    assert (await doc(C.agencies, ag.agency_id))["stats"]["ratingCount"] == 1
    assert (await doc(C.drivers, drv.uid))["stats"]["ratingCount"] == 1
    r = await api.get(f"{API}/reviews", params={"agencyId": ag.agency_id}, headers=cust.h)
    assert r.status_code == 200 and len(r.json()["items"]) == 1, r.text
    r = await api.get(f"{API}/reviews", headers=cust.h)
    assert r.status_code == 400, r.text

    r = await api.post(f"{API}/driver/trips/{tid}/complete", headers=drv.h, json={})
    assert r.status_code == 200 and r.json()["status"] == "completed", r.text

    # ── 14. earnings and admin settlement ─────────────────────────────────────
    r = await api.get(f"{API}/agency/earnings", headers=ag.h)
    assert r.status_code == 200, r.text
    earn = r.json()
    STATE["earnings_dto"] = earn
    r = await api.get(f"{API}/admin/settlements", headers=adm.h)
    assert r.status_code == 200, r.text
    rows = [x for x in r.json()["items"] if x.get("agencyId") == ag.agency_id]
    assert rows, r.json()
    through = S.ist_day(datetime.now(UTC) + timedelta(days=1))
    ref = "UTR" + S.secrets.token_hex(4).upper()
    r = await api.post(
        f"{API}/admin/settlements", headers=adm.h, json={"agencyId": ag.agency_id, "through": through, "reference": ref}
    )
    assert r.status_code == 201, r.text
    assert (await doc(C.earnings, bid))["status"] == "settled"
    r = await api.post(
        f"{API}/admin/settlements", headers=adm.h, json={"agencyId": ag.agency_id, "through": through, "reference": ref}
    )
    assert r.status_code == 409 and ecode(r) in ("already_exists", "conflict"), r.text
    r = await api.get(f"{API}/admin/settlements/history", headers=adm.h)
    assert r.status_code == 200 and any(x["reference"] == ref for x in r.json()["items"]), r.text

    STATE.update(admin=adm, agency=ag, driver=drv, customer=cust, trip_id=tid, booking_id=bid)


async def _signup_raw(api: httpx.AsyncClient, dob: str) -> httpx.Response:
    phone = S.new_phone()
    proof = await S.phone_proof(phone)
    return await api.post(
        f"{API}/auth/signup/customer",
        json={
            "fullName": "Young Person",
            "dob": dob,
            "acceptTerms": True,
            "password": S.PASSWORD,
            "confirmPassword": S.PASSWORD,
        },
        headers=S.bearer(proof.id_token),
    )
