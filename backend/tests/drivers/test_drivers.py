"""E60–E68 + E101–E103: agency drivers, invites, approval, removal, driver profile and agency link."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
from google.cloud.firestore_v1.base_query import FieldFilter

from app.repositories.base import C, col, doc_ref, get_doc, query_docs
from tests.support.builders import (
    create_trip,
    create_vehicle,
    make_agency,
    make_customer,
    make_driver,
    make_world,
)

A = "/api/v1/agency"


async def _notes(uid: str) -> list[dict]:  # type: ignore[type-arg]
    return await query_docs(col(C.notifications).where(filter=FieldFilter("userId", "==", uid)))


async def test_list_detail_and_masked_documents(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    r = await api.get(f"{A}/drivers", headers=w.agency.headers)
    items = r.json()["items"]
    assert [d["fullName"] for d in items] == ["Driver 1", "Driver 2"]
    d = items[0]
    assert d["phone"].startswith("+91") and "•" in d["phoneMasked"]
    assert d["license"]["numberMasked"] and d["license"]["fileUrl"] and d["aadhaar"]["numberMasked"] == "XXXX XXXX 2346"
    assert d["verification"] == "verified" and d["link"]["status"] == "active" and d["nextAssignment"] is None

    t = await create_trip(api, w.agency, w.vehicles[0]["id"], w.drivers[0].uid)
    r = await api.get(f"{A}/drivers/{w.drivers[0].uid}", headers=w.agency.headers)
    assert r.status_code == 200
    detail = r.json()
    assert detail["nextAssignment"]["tripId"] == t["id"] and len(detail["schedule"]) == 1
    assert [x["id"] for x in detail["trips"]] == [t["id"]] and detail["reviews"] == []

    other = await make_agency("Other")
    assert (await api.get(f"{A}/drivers/{w.drivers[0].uid}", headers=other.headers)).status_code == 404


async def test_approve_reject_pending_requests(api: httpx.AsyncClient) -> None:
    a = await make_agency()
    p1 = await make_driver(a, name="Pending One", link="pending", via="request")
    p2 = await make_driver(a, name="Pending Two", link="pending", via="request")
    r = await api.get(f"{A}/drivers", params={"status": "pending"}, headers=a.headers)
    assert {x["id"] for x in r.json()["items"]} == {p1.uid, p2.uid}

    r = await api.post(f"{A}/drivers/{p1.uid}/approve", headers=a.headers)
    assert r.status_code == 200 and r.json()["link"]["status"] == "active"
    assert (await api.post(f"{A}/drivers/{p1.uid}/approve", headers=a.headers)).status_code == 200  # idempotent
    r = await api.post(f"{A}/drivers/{p1.uid}/reject", json={"reason": "late"}, headers=a.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_transition"
    agency = await get_doc(C.agencies, a.agency_id or "")
    assert agency and agency["stats"]["drivers"] == 1

    r = await api.post(f"{A}/drivers/{p2.uid}/reject", json={"reason": "Not hiring"}, headers=a.headers)
    assert r.status_code == 200 and r.json()["link"]["status"] == "rejected"
    assert any("Not hiring" in n["body"] for n in await _notes(p2.uid))
    assert any(n["kind"] == "driver_link_decided" for n in await _notes(p1.uid))


async def test_availability_and_removal_rules(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    d1, d2 = w.drivers
    await create_trip(api, w.agency, w.vehicles[0]["id"], d1.uid)
    r = await api.patch(f"{A}/drivers/{d1.uid}", json={"availability": "unavailable"}, headers=w.agency.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "driver_has_active_trips"
    r = await api.delete(f"{A}/drivers/{d1.uid}", headers=w.agency.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "driver_has_active_trips"

    r = await api.patch(f"{A}/drivers/{d2.uid}", json={"availability": "unavailable"}, headers=w.agency.headers)
    assert r.status_code == 200 and r.json()["availability"] == "unavailable"
    assert (await api.delete(f"{A}/drivers/{d2.uid}", headers=w.agency.headers)).status_code == 204
    r = await api.get(f"{A}/drivers", params={"status": "removed"}, headers=w.agency.headers)
    removed = r.json()["items"]
    assert [x["id"] for x in removed] == [d2.uid]
    assert removed[0]["license"]["fileUrl"] is None  # removed links lose document access
    assert (await api.delete(f"{A}/drivers/{d2.uid}", headers=w.agency.headers)).status_code == 404
    agency = await get_doc(C.agencies, w.agency.agency_id or "")
    assert agency and agency["stats"]["drivers"] == 1


async def test_invites(api: httpx.AsyncClient) -> None:
    w = await make_world(api, vehicles=0)
    r = await api.post(
        f"{A}/driver-invites", json={"fullName": "Murugan", "phone": "98765 12345"}, headers=w.agency.headers
    )
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["phone"] == "+919876512345" and inv["status"] == "pending"
    exp = datetime.fromisoformat(inv["expiresAt"].replace("Z", "+00:00"))
    assert timedelta(days=13) < exp - datetime.now(UTC) <= timedelta(days=14)

    r = await api.post(
        f"{A}/driver-invites", json={"fullName": "Murugan", "phone": "9876512345"}, headers=w.agency.headers
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_exists"
    other = await make_agency("Other")
    r = await api.post(
        f"{A}/driver-invites", json={"fullName": "Murugan", "phone": "9876512345"}, headers=other.headers
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_exists"
    r = await api.post(
        f"{A}/driver-invites", json={"fullName": "D1", "phone": w.drivers[0].phone}, headers=w.agency.headers
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "phone_taken"
    assert "already linked to your agency" in r.json()["error"]["message"]
    cust = await make_customer()
    r = await api.post(f"{A}/driver-invites", json={"fullName": "Cust", "phone": cust.phone}, headers=w.agency.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "phone_taken"
    r = await api.post(f"{A}/driver-invites", json={"fullName": "X", "phone": "12345"}, headers=w.agency.headers)
    assert r.status_code == 400 and "phone" in r.json()["error"]["fields"]

    assert [i["id"] for i in (await api.get(f"{A}/driver-invites", headers=w.agency.headers)).json()["items"]] == [
        inv["id"]
    ]
    assert (await api.delete(f"{A}/driver-invites/{inv['id']}", headers=other.headers)).status_code == 404
    assert (await api.delete(f"{A}/driver-invites/{inv['id']}", headers=w.agency.headers)).status_code == 204
    assert (await api.delete(f"{A}/driver-invites/{inv['id']}", headers=w.agency.headers)).status_code == 204
    assert (await api.get(f"{A}/driver-invites", headers=w.agency.headers)).json()["items"] == []
    # a revoked number can be invited again
    r = await api.post(
        f"{A}/driver-invites", json={"fullName": "Murugan", "phone": "9876512345"}, headers=w.agency.headers
    )
    assert r.status_code == 201
    # expired-but-pending invites don't block a new one
    await doc_ref(C.driver_invites, r.json()["id"]).update({"expiresAt": datetime.now(UTC) - timedelta(minutes=1)})
    r = await api.post(
        f"{A}/driver-invites", json={"fullName": "Murugan", "phone": "9876512345"}, headers=other.headers
    )
    assert r.status_code == 201
    assert (await get_doc(C.driver_invites, inv["id"]) or {}).get("status") == "revoked"


async def test_driver_profile_and_agency_link(api: httpx.AsyncClient) -> None:
    a = await make_agency()
    d = await make_driver(None, name="Free Agent", link=None)
    r = await api.get("/api/v1/driver/profile", headers=d.headers)
    assert r.status_code == 200, r.text
    assert r.json()["account"]["fullName"] == "Free Agent" and r.json()["account"]["agencyLink"] is None
    assert r.json()["reviews"] == []

    unverified = await make_agency("Unverified", verification="pending")
    r = await api.post("/api/v1/driver/agency-link", json={"agencyId": unverified.agency_id}, headers=d.headers)
    assert r.status_code == 404
    r = await api.post("/api/v1/driver/agency-link", json={"agencyId": a.agency_id}, headers=d.headers)
    assert r.status_code == 200 and r.json()["account"]["agencyLink"]["status"] == "pending"
    assert any(n["kind"] == "driver_link_requested" for n in await _notes(a.uid))
    assert (
        await api.post("/api/v1/driver/agency-link", json={"agencyId": a.agency_id}, headers=d.headers)
    ).status_code == 200
    r = await api.post("/api/v1/driver/agency-link", json={"agencyId": "agc_" + "a" * 20}, headers=d.headers)
    assert r.status_code == 404
    await api.post(f"{A}/drivers/{d.uid}/approve", headers=a.headers)
    other = await make_agency("Other")
    r = await api.post("/api/v1/driver/agency-link", json={"agencyId": other.agency_id}, headers=d.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_transition"

    # rename fans out to draft/published trips
    v = await create_vehicle(api, a, rc=False)
    t = await create_trip(api, a, v["id"], d.uid, publish=False)
    r = await api.patch("/api/v1/driver/profile", json={"fullName": "Free Agent Kumar"}, headers=d.headers)
    assert r.status_code == 200 and r.json()["account"]["fullName"] == "Free Agent Kumar"
    trip = await get_doc(C.trips, t["id"])
    assert trip and trip["driver"]["fullName"] == "Free Agent Kumar"
    assert (await api.get("/api/v1/driver/profile", headers=a.headers)).status_code == 403
