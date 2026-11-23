"""Full three-role workflow against the emulator: shipment → offers → request → accept → Cashfree
webhook → driver pickup (OTP) → checkpoints → out for delivery → delivery (OTP + photo) → review."""

from __future__ import annotations

import io
from datetime import timedelta

import httpx
import pytest
from PIL import Image

from app.core.clock import FrozenClock
from app.domain import capacity
from app.repositories import booking_secrets as secrets_repo
from app.repositories import events as events_repo
from app.repositories.base import C, get_doc
from app.tests_support.fake_cashfree import FakeCashfreeClient
from tests.bookings.support import (
    COIMBATORE,
    SALEM,
    accept,
    booking_doc,
    create_shipment,
    customer_view,
    idem,
    make_world,
    pay,
    trip_doc,
)

pytestmark = pytest.mark.emulator


def jpeg() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (8, 8), (10, 200, 30)).save(out, format="JPEG")
    return out.getvalue()


async def test_full_workflow_happy_path(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    w = await make_world(http, clock)
    cust, agency, driver = w.customer.headers, w.agency.headers, w.driver.headers

    # 1. shipment + offers (exact match on the whole route)
    s = await create_shipment(http, w, COIMBATORE, SALEM, weight=500)
    assert s["status"] == "open" and s["editable"] and s["source"]["place"]["placeId"] == COIMBATORE
    r = await http.get(f"/api/v1/customer/shipments/{s['id']}/offers", headers=cust)
    assert r.status_code == 200, r.text
    offers = r.json()
    assert [o["tripId"] for o in offers["items"]] == [w.trip["id"]]
    offer = offers["items"][0]
    assert (
        offer["matchType"] == "exact"
        and offer["pickup"]["checkpointIndex"] == 0
        and offer["drop"]["checkpointIndex"] == 3
    )
    p = offer["pricing"]
    assert p["pricingVersion"] == 3 and p["totalPayable"] == sum(line["amount"] for line in p["lines"])
    assert offer["availableCapacityKg"] == 1000

    # 2. request (idempotent replay returns the same booking with 200)
    headers = {**cust, **idem()}
    body = {"shipmentId": s["id"], "tripId": w.trip["id"]}
    r = await http.post("/api/v1/customer/bookings", json=body, headers=headers)
    assert r.status_code == 201, r.text
    b = r.json()
    bid = b["id"]
    assert b["status"] == "awaiting_agency" and b["state"]["approvalStatus"] == "pending"
    assert b["driver"] is None and b["vehicle"] is None and b["otps"] is None
    r2 = await http.post("/api/v1/customer/bookings", json=body, headers=headers)
    assert r2.status_code == 200 and r2.json()["id"] == bid
    shipment = await get_doc(C.shipments, s["id"])
    assert shipment is not None and shipment["status"] == "requested" and shipment["currentBookingId"] == bid

    # agency sees the request without the customer's phone or full address
    r = await http.get(f"/api/v1/agency/bookings/{bid}", headers=agency)
    assert r.status_code == 200, r.text
    ab = r.json()
    assert ab["customer"]["phone"] is None and ab["addresses"]["pickup"]["line"] is None and ab["receiver"] is None
    assert ab["capacity"] == {"availableKg": 1000, "afterAcceptKg": 500}

    # 3. accept → capacity held, payment due
    r = await accept(http, w, bid)
    assert r.status_code == 200, r.text
    ab = r.json()
    assert ab["state"]["approvalStatus"] == "accepted" and ab["state"]["paymentStatus"] == "due"
    assert ab["state"]["reservationStatus"] == "held" and ab["customer"]["phone"] == w.customer.phone
    trip = await trip_doc(w.trip["id"])
    assert trip["holds"][bid]["state"] == "held" and capacity.trip_available_kg(trip, clock.now()) == 500
    assert trip["counts"]["held"] == 1 and trip["counts"]["awaiting"] == 0
    view = await customer_view(http, w, bid)
    assert view["status"] == "pending_payment" and view["canPay"] and view["driver"]["phone"] is None
    assert view["vehicle"]["registrationNumber"]
    # accept is idempotent
    assert (await accept(http, w, bid)).status_code == 200

    # 4. paid only through the verified Cashfree webhook
    await pay(http, w, bid, fake_cf, clock)
    doc = await booking_doc(bid)
    assert doc["paymentStatus"] == "paid" and doc["reservationStatus"] == "committed" and doc["status"] == "confirmed"
    assert doc["driverTab"] == "pending_pickup" and doc["paidAt"] is not None
    trip = await trip_doc(w.trip["id"])
    assert trip["holds"][bid]["state"] == "committed" and trip["counts"]["committed"] == 1
    assert (await get_doc(C.shipments, s["id"]))["status"] == "booked"  # type: ignore[index]
    view = await customer_view(http, w, bid)
    otps = view["otps"]
    assert otps and len(otps["pickup"]) == 6 and len(otps["delivery"]) == 6 and otps["pickup"] != otps["delivery"]
    assert view["driver"]["phone"] == w.driver.phone and view["payment"]["status"] == "succeeded"
    sec = await secrets_repo.get(bid)
    assert sec is not None and otps["pickup"] not in str(sec)  # stored encrypted only

    # 5. driver: contacts visible once paid; no OTPs or pricing in the driver DTO
    r = await http.get(f"/api/v1/driver/shipments/{bid}", headers=driver)
    assert r.status_code == 200, r.text
    ds = r.json()
    assert ds["customer"]["phone"] == w.customer.phone and ds["receiver"]["phone"] == "+919876543210"
    assert ds["pickupAddress"]["mapsUrl"].startswith("https://www.google.com/maps/dir/?api=1&destination=")
    assert "otps" not in ds and "pricing" not in ds and ds["allowedActions"] == ["pickup", "refuse_pickup", "remark"]
    r = await http.get("/api/v1/driver/shipments?tab=pending_pickup", headers=driver)
    assert [x["bookingId"] for x in r.json()["items"]] == [bid]

    # 6. start the trip (depart checkpoint 0 from departure − 2 h)
    r = await http.post(f"/api/v1/driver/trips/{w.trip['id']}/checkpoints/0/depart", headers=driver, json={})
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_early"
    clock.advance(hours=1, minutes=30)
    r = await http.post(f"/api/v1/driver/trips/{w.trip['id']}/checkpoints/0/depart", headers=driver, json={})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "in_progress" and r.json()["nextStep"]["kind"] == "arrive"

    # 7. pickup: wrong OTP counts an attempt, the right one picks up
    r = await http.post(
        f"/api/v1/driver/shipments/{bid}/pickup",
        headers=driver,
        json={"otp": "000000" if otps["pickup"] != "000000" else "111111"},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "otp_invalid"
    assert r.json()["error"]["details"]["attemptsLeft"] == 4
    r = await http.post(
        f"/api/v1/driver/shipments/{bid}/pickup", headers=driver, json={"otp": otps["pickup"], "remarks": "4 bales"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "picked_up"
    # repeat is idempotent
    r = await http.post(f"/api/v1/driver/shipments/{bid}/pickup", headers=driver, json={"otp": otps["pickup"]})
    assert r.status_code == 200

    # 8. checkpoints fan out to the booking; arrival at the drop → out for delivery
    tid = w.trip["id"]
    for path in ("1/arrive", "1/depart", "2/arrive", "2/depart", "3/arrive"):
        clock.advance(minutes=30)
        r = await http.post(
            f"/api/v1/driver/trips/{tid}/checkpoints/{path}", headers=driver, json={"remarks": "on time"}
        )
        assert r.status_code == 200, (path, r.text)
        if path == "1/depart":
            assert (await booking_doc(bid))["fulfilmentStatus"] == "in_transit"
    doc = await booking_doc(bid)
    assert doc["fulfilmentStatus"] == "out_for_delivery" and doc["status"] == "out_for_delivery"
    r = await http.post(f"/api/v1/driver/trips/{tid}/checkpoints/2/arrive", headers=driver, json={})
    assert r.status_code == 200  # already recorded: idempotent

    # cancellation after pickup is refused
    r = await http.post(f"/api/v1/customer/bookings/{bid}/cancel", headers=cust, json={})
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_transition"
    # complete is refused while a shipment is undelivered
    r = await http.post(f"/api/v1/driver/trips/{tid}/complete", headers=driver)
    assert r.status_code == 409 and r.json()["error"]["code"] == "undelivered_shipments"

    # review is only possible after delivery
    r = await http.post(f"/api/v1/customer/bookings/{bid}/review", headers=cust, json={"rating": 5})
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_transition"

    # 9. delivery: OTP mandatory, photo optional (one sent here)
    r = await http.post(
        f"/api/v1/driver/shipments/{bid}/deliver",
        headers=driver,
        data={"otp": otps["delivery"], "receivedBy": "Meena", "remarks": "Handed over"},
        files=[("proof", ("p.jpg", jpeg(), "image/jpeg"))],
    )
    assert r.status_code == 200, r.text
    ds = r.json()
    assert ds["status"] == "delivered" and ds["delivery"]["proofUrls"]
    assert ds["customer"]["phone"] is None and ds["receiver"]["phone"] is None  # contact window closed
    doc = await booking_doc(bid)
    assert doc["reservationStatus"] == "consumed" and doc["deliveredAt"] is not None
    trip = await trip_doc(tid)
    assert bid not in trip["holds"] and trip["counts"]["delivered"] == 1
    earning = await get_doc(C.earnings, bid)
    assert (
        earning is not None and earning["agencyNet"] == doc["pricing"]["agencyNet"] and earning["status"] == "pending"
    )
    assert (await get_doc(C.shipments, s["id"]))["status"] == "delivered"  # type: ignore[index]

    # 10. one synchronised timeline for every role; no fabricated location
    r = await http.get(f"/api/v1/customer/bookings/{bid}/tracking", headers=cust)
    assert r.status_code == 200, r.text
    tr = r.json()
    assert tr["liveLocation"] is None and tr["proofUrls"]
    types = [e["type"] for e in tr["events"]]
    for t in (
        "requested",
        "accepted",
        "payment_succeeded",
        "confirmed",
        "picked_up",
        "in_transit",
        "checkpoint_arrived",
        "out_for_delivery",
        "delivered",
    ):
        assert t in types, (t, types)
    stamps = [e["at"] for e in tr["events"]]
    assert stamps == sorted(stamps) and all(s.endswith("Z") and len(s) == 24 for s in stamps)
    stages = {st["key"]: st["state"] for st in tr["stages"]}
    assert stages["delivered"] == "done" and stages["pickup"] == "done"
    agency_tl = (await http.get(f"/api/v1/agency/bookings/{bid}", headers=agency)).json()["timeline"]
    driver_ev = (await http.get(f"/api/v1/driver/shipments/{bid}", headers=driver)).json()["events"]
    all_ev = await events_repo.list_booking_events(bid)
    shared = [e["id"] for e in all_ev if {"customer", "agency", "driver"} <= set(e["visibility"])]
    assert [e["id"] for e in agency_tl if e["id"] in shared] == [e["id"] for e in driver_ev if e["id"] in shared]

    # 11. review once
    r = await http.post(f"/api/v1/customer/bookings/{bid}/review", headers=cust, json={"rating": 4, "comment": "Good"})
    assert r.status_code == 201, r.text
    assert r.json()["customerFirstName"] == "Ravi"
    r = await http.post(f"/api/v1/customer/bookings/{bid}/review", headers=cust, json={"rating": 4})
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_reviewed"
    agency_doc = await get_doc(C.agencies, w.agency.agency_id or "")
    assert agency_doc is not None and agency_doc["stats"]["ratingCount"] == 1 and agency_doc["stats"]["ratingAvg"] == 4
    r = await http.get(f"/api/v1/reviews?driverId={w.driver.uid}", headers=cust)
    assert r.status_code == 200 and len(r.json()["items"]) == 1

    # 12. complete the trip; history and notifications
    r = await http.post(f"/api/v1/driver/trips/{tid}/complete", headers=driver)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "completed"
    r = await http.get("/api/v1/driver/history", headers=driver)
    assert [x["bookingId"] for x in r.json()["items"]] == [bid] and r.json()["items"][0]["proofThumbUrl"]
    r = await http.get("/api/v1/notifications/unread-count", headers=cust)
    assert r.json()["count"] >= 5
    kinds = [n["kind"] for n in (await http.get("/api/v1/notifications?limit=50", headers=cust)).json()["items"]]
    for k in ("booking_accepted", "payment_succeeded", "pickup_confirmed", "out_for_delivery", "delivered"):
        assert k in kinds, (k, kinds)
    assert (await http.post("/api/v1/notifications/read", headers=cust, json={"all": True})).status_code == 204
    assert (await http.get("/api/v1/notifications/unread-count", headers=cust)).json()["count"] == 0
    r = await http.get("/api/v1/customer/dashboard", headers=cust)
    assert r.status_code == 200 and r.json()["counts"]["delivered"] == 1 and r.json()["firstName"] == "Ravi"
    assert clock.now() > w.start - timedelta(hours=1)
