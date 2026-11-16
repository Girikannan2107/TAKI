"""E47–E51, E84, E85, E122–E124: profile + fan-out, verification, dashboard, history, earnings, settlements."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.repositories.base import C, doc_ref, get_doc
from tests.support.app import COIMBATORE as GOOGLE_COIMBATORE
from tests.support.app import PDF_BYTES, jpeg_bytes
from tests.support.builders import (
    Account,
    _account,
    create_trip,
    create_vehicle,
    make_agency,
    make_driver,
    make_world,
)

A = "/api/v1/agency"


async def _admin() -> dict[str, str]:
    uid = "admin" + datetime.now(UTC).strftime("%H%M%S%f")
    await _account(uid, "admin", "+919000000002", "Ops", None, datetime.now(UTC))
    return {"X-Test-Uid": uid}


async def test_profile_patch_fans_out_agency_name(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    t = await create_trip(api, w.agency, w.vehicles[0]["id"], w.drivers[0].uid)
    inv = await api.post(
        f"{A}/driver-invites", json={"fullName": "Murugan", "phone": "9876512345"}, headers=w.agency.headers
    )
    r = await api.get(f"{A}/profile", headers=w.agency.headers)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["agencyName"] == "Arun Transports" and p["counts"] == {"vehicles": 2, "drivers": 2, "pendingDrivers": 0}
    assert p["base"]["name"] == "Coimbatore" and p["districtName"] == "Coimbatore"

    body = {
        "ownerName": "Arun Kumar",
        "agencyName": "Arun Logistics",
        "base": {"placeId": GOOGLE_COIMBATORE},
        "statesCovered": ["TN", "KA"],
        "vehicleCountRange": "6-10",
    }
    r = await api.patch(f"{A}/profile", json=body, headers=w.agency.headers)
    assert r.status_code == 200, r.text
    assert r.json()["agencyName"] == "Arun Logistics" and r.json()["vehicleCountRange"] == "6-10"
    assert (await get_doc(C.trips, t["id"]) or {})["agencyName"] == "Arun Logistics"
    assert (await get_doc(C.driver_invites, inv.json()["id"]) or {})["agencyName"] == "Arun Logistics"
    driver = await get_doc(C.drivers, w.drivers[0].uid)
    assert driver and driver["agencyLink"]["agencyName"] == "Arun Logistics"
    r = await api.patch(f"{A}/profile", json={**body, "extra": 1}, headers=w.agency.headers)
    assert r.status_code == 400


async def test_verification_status_and_submit(api: httpx.AsyncClient) -> None:
    a = await make_agency(verification="not_submitted")
    r = await api.get(f"{A}/verification", headers=a.headers)
    assert r.json()["status"] == "not_submitted"
    assert r.json()["requirements"] == [{"key": "photo", "done": False}, {"key": "identity_document", "done": False}]
    r = await api.post(f"{A}/verification", json={}, headers=a.headers)
    assert r.status_code == 409 and r.json()["error"]["details"]["missing"] == ["photo", "identity_document"]
    # D2's upload endpoints complete the set (and auto-submit to pending)
    r = await api.put(
        "/api/v1/me/documents/pan",
        headers=a.headers,
        data={"number": "ABCDE1234F"},
        files={"file": ("pan.pdf", PDF_BYTES, "application/pdf")},
    )
    assert r.status_code == 200, r.text
    r = await api.put("/api/v1/me/photo", headers=a.headers, files={"photo": ("me.jpg", jpeg_bytes(), "image/jpeg")})
    assert r.status_code == 200, r.text
    r = await api.get(f"{A}/verification", headers=a.headers)
    assert r.json()["status"] == "pending" and all(x["done"] for x in r.json()["requirements"])
    # a rejected agency resubmits explicitly
    await doc_ref(C.agencies, a.agency_id or "").update(
        {"verification.status": "rejected", "verification.reason": "Blurry"}
    )
    r = await api.post(f"{A}/verification", json={}, headers=a.headers)
    assert r.status_code == 200 and r.json()["verification"]["status"] == "pending"
    verified = await make_agency()
    r = await api.post(f"{A}/verification", json={}, headers=verified.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_verified"


def _earning(
    agency: Account, trip_id: str, n: int, net: int, delivered: datetime, status: str = "pending"
) -> dict[str, Any]:
    bid = f"TAKI{n:08d}"
    return {
        "id": bid,
        "bookingId": bid,
        "agencyId": agency.agency_id,
        "tripId": trip_id,
        "driverId": None,
        "customerPaid": net + 350,
        "transportationCharge": net - 100,
        "additionalCharges": 100,
        "platformFee": 350,
        "agencyNet": net,
        "routeLabel": "Coimbatore → Salem",
        "deliveredAt": delivered,
        "status": status,
        "settlementId": None,
        "settledAt": None,
        "createdAt": delivered,
        "updatedAt": delivered,
    }


async def test_dashboard_earnings_and_admin_settlements(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    t = await create_trip(api, w.agency, w.vehicles[0]["id"], w.drivers[0].uid)
    await make_driver(w.agency, name="Waiting", link="pending", via="request")
    now = datetime.now(UTC)
    old = now - timedelta(days=40)
    rows = [_earning(w.agency, t["id"], 1, 1000, old), _earning(w.agency, t["id"], 2, 2000, now - timedelta(hours=1))]
    for e in rows:
        await doc_ref(C.earnings, e["id"]).set(e)

    r = await api.get(f"{A}/dashboard", headers=w.agency.headers)
    assert r.status_code == 200, r.text
    dash = r.json()
    assert dash["totals"] == {"vehicles": 2, "drivers": 2, "pendingDrivers": 1}
    assert dash["trips"] == {"active": 0, "upcoming": 1}
    assert dash["revenue"]["total"] == 3000 and dash["revenue"]["thisMonth"] >= 2000
    assert len(dash["revenue"]["monthlySeries"]) == 6
    assert [x["id"] for x in dash["upcomingTrips"]] == [t["id"]]
    assert dash["pendingBookings"] == 0 and dash["completedShipments"] == 0

    r = await api.get(f"{A}/earnings", headers=w.agency.headers)
    assert r.status_code == 200, r.text
    e = r.json()
    assert e["summary"]["total"] == 3000 and e["summary"]["pending"] == 3000 and e["summary"]["settled"] == 0
    assert e["byTrip"] == [
        {
            "tripId": t["id"],
            "routeLabel": "Coimbatore → Salem",
            "deliveredBookings": 2,
            "agencyNet": 3000,
            "lastDeliveredAt": e["byBooking"][0]["deliveredAt"],
        }
    ]
    assert e["byBooking"][0]["additionalCharges"] == 100 and e["byBooking"][0]["handlingFee"] == 100
    since = (now - timedelta(days=2)).date().isoformat()
    assert (await api.get(f"{A}/earnings", params={"from": since}, headers=w.agency.headers)).json()["summary"][
        "total"
    ] == 2000

    admin = await _admin()
    r = await api.get("/api/v1/admin/settlements", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["available"] is True
    assert [(x["agencyId"], x["pendingAmount"], x["pendingCount"]) for x in r.json()["items"]] == [
        (w.agency.agency_id, 3000, 2)
    ]
    through = (old + timedelta(days=1)).date().isoformat()
    body = {"agencyId": w.agency.agency_id, "through": through, "reference": "UTR-0001"}
    r = await api.post("/api/v1/admin/settlements", json=body, headers=admin)
    assert r.status_code == 201, r.text
    assert r.json()["amount"] == 1000 and r.json()["count"] == 1
    r = await api.post("/api/v1/admin/settlements", json={**body, "through": now.date().isoformat()}, headers=admin)
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_exists"
    r = await api.post("/api/v1/admin/settlements", json=body, headers=admin)
    assert r.status_code == 409  # nothing pending up to that date
    r = await api.get("/api/v1/admin/settlements/history", headers=admin)
    hist = r.json()["items"]
    assert len(hist) == 1 and hist[0]["agencyName"] == "Arun Transports" and hist[0]["bookings"] == 1
    e = (await api.get(f"{A}/earnings", headers=w.agency.headers)).json()
    assert e["summary"]["settled"] == 1000 and e["summary"]["pending"] == 2000
    assert e["settlements"][0]["reference"] == "UTR-0001"
    settled = await get_doc(C.earnings, "TAKI00000001")
    assert settled and settled["status"] == "settled" and settled["settlementId"] == r.json()["items"][0]["id"]


async def test_history_search(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    v = await create_vehicle(api, w.agency, rc=False, registrationNumber="KA05MN4321", makeModel="Eicher Pro")
    t = await create_trip(api, w.agency, w.vehicles[0]["id"], w.drivers[0].uid)
    H = f"{A}/history"
    r = await api.get(H, params={"type": "trips"}, headers=w.agency.headers)
    assert [x["id"] for x in r.json()["items"]] == [t["id"]] and r.json()["items"][0]["title"] == "Coimbatore → Salem"
    r = await api.get(H, params={"type": "trips", "q": "erode"}, headers=w.agency.headers)
    assert len(r.json()["items"]) == 1
    r = await api.get(H, params={"type": "trips", "q": "madurai"}, headers=w.agency.headers)
    assert r.json()["items"] == []
    r = await api.get(H, params={"type": "vehicles", "q": "ka05"}, headers=w.agency.headers)
    assert [x["id"] for x in r.json()["items"]] == [v["id"]]
    r = await api.get(H, params={"type": "drivers", "q": "driver 2"}, headers=w.agency.headers)
    assert [x["title"] for x in r.json()["items"]] == ["Driver 2"]
    r = await api.get(H, params={"type": "vehicles", "limit": 2}, headers=w.agency.headers)
    assert len(r.json()["items"]) == 2 and r.json()["nextCursor"]
    r2 = await api.get(
        H, params={"type": "vehicles", "limit": 2, "cursor": r.json()["nextCursor"]}, headers=w.agency.headers
    )
    assert len(r2.json()["items"]) == 1 and r2.json()["nextCursor"] is None
    r = await api.get(H, params={"type": "bookings"}, headers=w.agency.headers)
    assert r.status_code == 200 and r.json()["items"] == []
    r = await api.get(H, params={"type": "customers"}, headers=w.agency.headers)
    assert r.status_code == 200 and r.json()["items"] == []
    r = await api.get(H, params={"type": "trips", "from": "2020-01-01", "to": "2020-01-31"}, headers=w.agency.headers)
    assert r.json()["items"] == []
    assert (await api.get(H, params={"type": "nope"}, headers=w.agency.headers)).status_code == 400
