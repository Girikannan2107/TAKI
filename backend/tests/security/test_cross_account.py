"""T3 · Cross-account access (P2 §12.3): customer A vs customer B, agency A vs agency B, and drivers
that are not assigned to a booking. Every foreign read/write must be 403/404 and change nothing.
Contacts: the driver's phone reaches the customer only for a paid booking until delivery; the
customer/receiver phones reach only the assigned driver of a paid booking."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.core.clock import FrozenClock
from app.tests_support.fake_cashfree import FakeCashfreeClient
from tests.bookings.support import (
    COIMBATORE,
    SALEM,
    accept,
    booking_doc,
    create_shipment,
    customer_view,
    idem,
    ist_day,
    make_world,
    pay,
    request,
    shipment_body,
    trip_doc,
)
from tests.security.conftest import err
from tests.support.builders import create_vehicle, jpeg_bytes, make_agency, make_customer, make_driver, trip_body

pytestmark = pytest.mark.emulator
DENIED = {403, 404}


async def _probe(
    http: httpx.AsyncClient, calls: list[tuple[str, str, dict[str, Any]]], headers: dict[str, str]
) -> list[str]:
    bad = []
    for method, path, kw in calls:
        r = await http.request(method, path, headers=headers, **kw)
        if r.status_code not in DENIED:
            bad.append(f"{method} {path} -> {r.status_code} {err(r)}")
    return bad


async def test_cross_account_access_is_denied(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    w = await make_world(http, clock)
    s = await create_shipment(http, w, COIMBATORE, SALEM, weight=300)
    r = await request(http, w, s["id"])
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    tid, vid = w.trip["id"], w.vehicle["id"]

    cust_b = await make_customer("Other Customer")
    agency_b = await make_agency("Other Transports")
    driver_a2 = await make_driver(w.agency, name="Unassigned Driver")  # same agency, not on the trip
    driver_b = await make_driver(agency_b, name="Foreign Driver")
    failures: list[str] = []

    # Before payment the assigned driver sees nothing.
    r = await http.get(f"/api/v1/driver/shipments/{bid}", headers=w.driver.headers)
    if r.status_code not in DENIED:
        failures.append(f"assigned driver before payment -> {r.status_code}")

    # Agency B cannot act on agency A's booking request.
    failures += await _probe(
        http,
        [
            ("GET", f"/api/v1/agency/bookings/{bid}", {}),
            ("POST", f"/api/v1/agency/bookings/{bid}/accept", {"json": {}}),
            ("POST", f"/api/v1/agency/bookings/{bid}/reject", {"json": {"reason": "not today"}}),
        ],
        agency_b.headers,
    )
    assert (await accept(http, w, bid)).status_code == 200
    pid = await pay(http, w, bid, fake_cf, clock)
    before = await booking_doc(bid)

    # Customer B on customer A's shipment / booking / tracking / review / payment.
    calls_b = [
        ("GET", f"/api/v1/customer/shipments/{s['id']}", {}),
        (
            "PATCH",
            f"/api/v1/customer/shipments/{s['id']}",
            {"json": shipment_body(COIMBATORE, SALEM, day=ist_day(w.start))},
        ),
        ("DELETE", f"/api/v1/customer/shipments/{s['id']}", {}),
        ("GET", f"/api/v1/customer/shipments/{s['id']}/offers", {}),
        ("GET", f"/api/v1/customer/bookings/{bid}", {}),
        ("POST", f"/api/v1/customer/bookings/{bid}/cancel", {"json": {}}),
        ("POST", f"/api/v1/customer/bookings/{bid}/otp/regenerate", {"json": {"which": "pickup"}}),
        ("GET", f"/api/v1/customer/bookings/{bid}/tracking", {}),
        ("POST", f"/api/v1/customer/bookings/{bid}/review", {"json": {"rating": 1}}),
        ("GET", f"/api/v1/payments/{pid}", {}),
        ("POST", f"/api/v1/payments/{pid}/verify", {}),
    ]
    failures += await _probe(http, calls_b, cust_b.headers)
    r = await http.post("/api/v1/payments/orders", json={"bookingId": bid}, headers={**cust_b.headers, **idem()})
    if r.status_code not in DENIED | {409}:
        failures.append(f"customer B creates an order for A's booking -> {r.status_code} {err(r)}")
    r = await http.post(
        "/api/v1/customer/bookings", json={"shipmentId": s["id"], "tripId": tid}, headers={**cust_b.headers, **idem()}
    )
    if r.status_code not in DENIED | {409}:
        failures.append(f"customer B books A's shipment -> {r.status_code} {err(r)}")
    r = await http.get("/api/v1/payments/history", headers=cust_b.headers)
    if pid in r.text or bid in r.text:
        failures.append("customer B payment history lists A's payment")
    r = await http.get("/api/v1/customer/bookings", headers=cust_b.headers)
    if bid in r.text:
        failures.append("customer B booking list contains A's booking")

    # Agency B on agency A's vehicles / drivers / trips / bookings.
    failures += await _probe(
        http,
        [
            ("GET", f"/api/v1/agency/vehicles/{vid}", {}),
            ("PATCH", f"/api/v1/agency/vehicles/{vid}", {"json": {"maxPayloadKg": 100}}),
            ("DELETE", f"/api/v1/agency/vehicles/{vid}", {}),
            ("GET", f"/api/v1/agency/drivers/{w.driver.uid}", {}),
            ("PATCH", f"/api/v1/agency/drivers/{w.driver.uid}", {"json": {"availability": "unavailable"}}),
            ("POST", f"/api/v1/agency/drivers/{w.driver.uid}/approve", {"json": {}}),
            ("POST", f"/api/v1/agency/drivers/{w.driver.uid}/reject", {"json": {"reason": "x"}}),
            ("DELETE", f"/api/v1/agency/drivers/{w.driver.uid}", {}),
            ("GET", f"/api/v1/agency/trips/{tid}", {}),
            ("PATCH", f"/api/v1/agency/trips/{tid}", {"json": {"offeredKg": 900}}),
            ("DELETE", f"/api/v1/agency/trips/{tid}", {}),
            ("POST", f"/api/v1/agency/trips/{tid}/unpublish", {"json": {}}),
            ("POST", f"/api/v1/agency/trips/{tid}/cancel", {"json": {"reason": "foreign cancel"}}),
            ("POST", f"/api/v1/agency/trips/{tid}/reassign", {"json": {"driverId": driver_b.uid}}),
            ("GET", f"/api/v1/agency/bookings/{bid}", {}),
        ],
        agency_b.headers,
    )
    r = await http.get("/api/v1/agency/bookings", headers=agency_b.headers)
    if bid in r.text:
        failures.append("agency B booking list contains A's booking")
    # Agency B cannot publish a trip with agency A's vehicle or driver.
    own_vehicle = await create_vehicle(http, agency_b)
    for body in (trip_body(vid, driver_b.uid), trip_body(own_vehicle["id"], w.driver.uid)):
        r = await http.post("/api/v1/agency/trips", json=body, headers=agency_b.headers)
        if r.status_code < 400:
            failures.append(f"agency B published with a foreign vehicle/driver -> {r.status_code}")

    # Drivers not assigned to the booking (same agency and other agency).
    for drv in (driver_a2, driver_b):
        failures += [
            f"{drv.name}: {x}"
            for x in await _probe(
                http,
                [
                    ("GET", f"/api/v1/driver/shipments/{bid}", {}),
                    ("POST", f"/api/v1/driver/shipments/{bid}/pickup", {"json": {"otp": "123456"}}),
                    ("POST", f"/api/v1/driver/shipments/{bid}/refuse-pickup", {"json": {"reason": "goods damaged"}}),
                    ("POST", f"/api/v1/driver/shipments/{bid}/remarks", {"json": {"text": "foreign remark"}}),
                    (
                        "POST",
                        f"/api/v1/driver/shipments/{bid}/deliver",
                        {"data": {"otp": "123456"}, "files": [("proof", ("p.jpg", jpeg_bytes(), "image/jpeg"))]},
                    ),
                    ("GET", f"/api/v1/driver/trips/{tid}", {}),
                    ("POST", f"/api/v1/driver/trips/{tid}/checkpoints/0/depart", {"json": {}}),
                    ("POST", f"/api/v1/driver/trips/{tid}/complete", {}),
                ],
                drv.headers,
            )
        ]
        r = await http.get("/api/v1/driver/shipments", headers=drv.headers)
        if w.customer.phone in r.text or bid in r.text:
            failures.append(f"{drv.name}: shipment list leaks the booking")

    after = await booking_doc(bid)
    for k in ("paymentStatus", "fulfilmentStatus", "approvalStatus", "reservationStatus", "closure"):
        if before.get(k) != after.get(k):
            failures.append(f"booking.{k} changed by a foreign actor: {before.get(k)} -> {after.get(k)}")
    trip = await trip_doc(tid)
    if trip["status"] != "published":
        failures.append(f"trip status changed by a foreign actor: {trip['status']}")

    # Positive controls: the assigned driver sees the contacts; the customer sees the driver phone.
    r = await http.get(f"/api/v1/driver/shipments/{bid}", headers=w.driver.headers)
    assert r.status_code == 200 and r.json()["customer"]["phone"] == w.customer.phone, r.text
    view = await customer_view(http, w, bid)
    assert view["driver"]["phone"] == w.driver.phone
    assert not failures, "\n".join(failures)


async def test_driver_phone_hidden_before_payment_from_customer(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await make_world(http, clock)
    s = await create_shipment(http, w, COIMBATORE, SALEM, weight=200)
    bid = (await request(http, w, s["id"])).json()["id"]
    view = await customer_view(http, w, bid)
    assert view["driver"] is None or view["driver"].get("phone") is None
    assert (await accept(http, w, bid)).status_code == 200
    view = await customer_view(http, w, bid)
    assert view["driver"]["phone"] is None and view["otps"] is None
    # The agency sees no receiver before payment and never the OTPs.
    ab = (await http.get(f"/api/v1/agency/bookings/{bid}", headers=w.agency.headers)).json()
    assert ab["receiver"] is None and "otps" not in ab
