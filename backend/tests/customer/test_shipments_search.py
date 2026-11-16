"""Customer shipments, offers (exact / intermediate / wrong order / goods restriction), guest search,
trip details and ownership rules — against the emulator and the fake Maps gazetteer."""

from __future__ import annotations

from datetime import timedelta

import httpx
import pytest

from app.core.clock import FrozenClock
from tests.bookings.support import (
    COIMBATORE,
    ERODE,
    SALEM,
    TIRUPPUR,
    create_shipment,
    ist_day,
    make_customer,
    make_world,
    request,
    shipment_body,
)

pytestmark = pytest.mark.emulator


async def test_shipment_validation(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    c = await make_customer()
    today = ist_day(clock.now())
    past = ist_day(clock.now() - timedelta(days=2))
    far = ist_day(clock.now() + timedelta(days=70))

    async def post(body: dict) -> httpx.Response:  # type: ignore[type-arg]
        return await http.post("/api/v1/customer/shipments", json=body, headers=c.headers)

    r = await post(shipment_body(COIMBATORE, SALEM, day=past))
    assert r.status_code == 422 and r.json()["error"]["code"] == "past_date"
    r = await post(shipment_body(COIMBATORE, SALEM, day=far))
    assert r.status_code == 422 and r.json()["error"]["code"] == "date_too_far"
    body = shipment_body(COIMBATORE, "fake_mumbai", day=today)
    body["destination"]["state"] = "TN"
    r = await post(body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "outside_service_area"
    body = shipment_body(COIMBATORE, "fake_bengaluru", day=today)  # Karnataka declared as TN
    r = await post(body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "address_state_mismatch"
    r = await post(shipment_body(COIMBATORE, COIMBATORE, day=today))
    assert r.status_code == 400 and "destination" in r.json()["error"]["fields"]
    body = shipment_body(COIMBATORE, SALEM, day=today, weight=5)
    r = await post(body)
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_request"
    body = shipment_body(COIMBATORE, SALEM, day=today)
    body["package"]["prohibitedItemsDeclaration"] = False
    assert (await post(body)).status_code == 400
    body = shipment_body(COIMBATORE, SALEM, day=today)
    body["source"] = {"line1": "12 Market Road", "pincode": "641001", "state": "TN", "source": "autocomplete"}
    assert (await post(body)).status_code == 400  # placeId required for autocomplete
    # manual address: forward geocoded on the server (never matched by pincode)
    body = shipment_body(COIMBATORE, SALEM, day=today)
    body["source"] = {"line1": "4 Avinashi Road, Tiruppur", "pincode": "641601", "state": "TN", "source": "manual"}
    r = await post(body)
    assert r.status_code == 201, r.text
    assert r.json()["source"]["place"]["name"] == "Tiruppur" and r.json()["directDistanceKm"] > 1


async def test_shipment_edit_withdraw_and_ownership(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await make_world(http, clock)
    s = await create_shipment(http, w, COIMBATORE, SALEM)
    other = await make_customer("Kavya Sharma")
    assert (await http.get(f"/api/v1/customer/shipments/{s['id']}", headers=other.headers)).status_code == 404
    assert (await http.get(f"/api/v1/customer/shipments/{s['id']}", headers=w.agency.headers)).status_code == 403
    body = shipment_body(COIMBATORE, ERODE, day=ist_day(w.start), weight=300)
    r = await http.patch(f"/api/v1/customer/shipments/{s['id']}", json=body, headers=w.customer.headers)
    assert r.status_code == 200 and r.json()["package"]["weightKg"] == 300
    r = await request(http, w, s["id"])
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    r = await http.patch(f"/api/v1/customer/shipments/{s['id']}", json=body, headers=w.customer.headers)
    assert r.status_code == 409 and r.json()["error"]["details"]["bookingId"] == bid
    assert (await http.delete(f"/api/v1/customer/shipments/{s['id']}", headers=w.customer.headers)).status_code == 409
    r = await http.get(f"/api/v1/customer/shipments/{s['id']}", headers=w.customer.headers)
    assert [b["id"] for b in r.json()["bookings"]] == [bid]
    r = await http.get("/api/v1/customer/shipments?tab=pending", headers=w.customer.headers)
    assert [x["id"] for x in r.json()["items"]] == [s["id"]] and r.json()["items"][0]["currentBooking"]["id"] == bid
    s2 = await create_shipment(http, w, TIRUPPUR, SALEM)
    assert (await http.delete(f"/api/v1/customer/shipments/{s2['id']}", headers=w.customer.headers)).status_code == 204
    r = await http.get("/api/v1/customer/shipments", headers=w.customer.headers)
    assert r.json()["items"] == []


async def test_intermediate_match_and_wrong_order(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await make_world(http, clock)
    s = await create_shipment(http, w, TIRUPPUR, ERODE)
    r = await http.get(f"/api/v1/customer/shipments/{s['id']}/offers", headers=w.customer.headers)
    assert r.status_code == 200, r.text
    (offer,) = r.json()["items"]
    assert offer["matchType"] == "intermediate"
    assert (offer["pickup"]["checkpointIndex"], offer["drop"]["checkpointIndex"]) == (1, 2)
    assert offer["distanceSource"] == "road" and offer["pickup"]["distanceKm"] == 0.0
    assert [st["role"] for st in offer["route"]] == [None, "pickup", "drop", None]
    assert offer["pricing"]["distanceKm"] == offer["segmentKm"] < 160
    r = await request(http, w, s["id"])
    assert r.status_code == 201 and r.json()["matchType"] == "intermediate"

    back = await create_shipment(http, w, ERODE, TIRUPPUR)
    r = await http.get(f"/api/v1/customer/shipments/{back['id']}/offers", headers=w.customer.headers)
    assert r.json()["items"] == [] and r.json()["excludedForCapacity"] == 0
    r = await request(http, w, back["id"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "not_on_route"


async def test_goods_restriction_and_capacity_exclusions(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await make_world(http, clock)
    s = await create_shipment(http, w, COIMBATORE, SALEM, goodsCategory="perishables")
    r = await http.get(f"/api/v1/customer/shipments/{s['id']}/offers", headers=w.customer.headers)
    assert r.json()["items"] == [] and r.json()["excludedForRestrictions"] == 1
    r = await request(http, w, s["id"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "goods_not_accepted"
    s2 = await create_shipment(http, w, COIMBATORE, SALEM, specialHandling=["temperature_sensitive"])
    r = await request(http, w, s2["id"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "handling_not_supported"
    s3 = await create_shipment(http, w, COIMBATORE, SALEM, weight=1500)
    r = await http.get(f"/api/v1/customer/shipments/{s3['id']}/offers", headers=w.customer.headers)
    assert r.json()["items"] == [] and r.json()["excludedForCapacity"] == 1
    r = await request(http, w, s3["id"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "insufficient_capacity"


async def test_guest_search_filters_and_trip_details(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await make_world(http, clock)
    day = ist_day(w.start)
    q = {"fromPlaceId": COIMBATORE, "toPlaceId": ERODE, "weightKg": 200, "date": day}
    r = await http.get("/api/v1/customer/search", params=q)
    assert r.status_code == 200, r.text
    (offer,) = r.json()["items"]
    assert offer["vehicle"]["photoUrl"] is None and offer["matchType"] == "intermediate"
    assert r.json()["date"] == day
    r = await http.get("/api/v1/customer/search", params={**q, "maxPrice": 10})
    assert r.json()["items"] == []
    r = await http.get("/api/v1/customer/search", params={**q, "vehicleClass": "Heavy Truck"})
    assert r.json()["items"] == []
    r = await http.get("/api/v1/customer/search", params={**q, "date": ist_day(clock.now() - timedelta(days=1))})
    assert r.status_code == 422 and r.json()["error"]["code"] == "past_date"
    r = await http.get("/api/v1/customer/search", params={**q, "toPlaceId": "fake_mumbai"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "outside_service_area"
    r = await http.get(
        f"/api/v1/customer/trips/{w.trip['id']}",
        params={"fromPlaceId": COIMBATORE, "toPlaceId": SALEM, "weightKg": 100},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["problem"] is None and d["routePolyline"] and len(d["legs"]) == 3 and d["agencyInfo"]["delivered"] == 0
    s = await create_shipment(http, w, COIMBATORE, SALEM)
    bid = (await request(http, w, s["id"])).json()["id"]
    r = await http.get(
        f"/api/v1/customer/trips/{w.trip['id']}", params={"shipmentId": s["id"]}, headers=w.customer.headers
    )
    assert r.status_code == 200 and r.json()["existingBookingId"] == bid
    r = await http.get(
        f"/api/v1/customer/trips/{w.trip['id']}",
        params={"fromPlaceId": SALEM, "toPlaceId": COIMBATORE, "weightKg": 100},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "not_on_route"
    assert (
        await http.get("/api/v1/customer/trips/trp_aaaaaaaaaaaaaaaaaaaa", params=q | {"weightKg": 10})
    ).status_code == 404
