"""Booking rules: cancellation with full refund, lazy expiry, reject, refuse pickup, OTP regeneration,
role / ownership visibility, failed payment webhook."""

from __future__ import annotations

from datetime import timedelta

import httpx
import pytest

from app.core.clock import FrozenClock
from app.repositories import payments as payments_repo
from app.repositories.base import C, get_doc
from app.services import jobs_service
from app.tests_support.fake_cashfree import FakeCashfreeClient, signed_webhook
from tests.bookings.support import (
    accept,
    book,
    booking_doc,
    customer_view,
    idem,
    make_customer,
    make_driver,
    make_world,
    pay,
    trip_doc,
)

pytestmark = pytest.mark.emulator


async def test_cancel_paid_booking_before_pickup_refunds_in_full(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    w = await make_world(http, clock)
    bid = await book(http, w)
    assert (await accept(http, w, bid)).status_code == 200
    pid = await pay(http, w, bid, fake_cf, clock)
    total = (await booking_doc(bid))["pricing"]["totalPayable"]
    r = await http.post(
        f"/api/v1/customer/bookings/{bid}/cancel", headers=w.customer.headers, json={"reason": "Plans changed"}
    )
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["status"] == "cancelled" and v["cancellation"]["reason"] == "customer_cancelled"
    assert v["state"]["reservationStatus"] == "released" and v["otps"] is None and not v["canCancel"]
    trip = await trip_doc(w.trip["id"])
    assert bid not in trip["holds"] and trip["counts"]["committed"] == 0
    p = await payments_repo.get(pid)
    assert p is not None and p.status in ("refund_pending", "refunded") and p.refund is not None
    assert p.refund.amount_paise == total * 100  # 100 %, TAKI fee included
    await jobs_service.run_due_jobs(clock.now() + timedelta(minutes=2))
    p = await payments_repo.get(pid)
    assert p is not None and p.status == "refunded"
    doc = await booking_doc(bid)
    assert doc["paymentStatus"] == "refunded" and doc["status"] == "cancelled"
    s = await get_doc(C.shipments, doc["shipmentId"])
    assert s is not None and s["status"] == "open" and s["currentBookingId"] is None
    # repeating cancel is idempotent
    assert (
        await http.post(f"/api/v1/customer/bookings/{bid}/cancel", headers=w.customer.headers, json={})
    ).status_code == 200
    # the driver keeps a record without contacts
    r = await http.get(f"/api/v1/driver/shipments/{bid}", headers=w.driver.headers)
    assert r.status_code == 200 and r.json()["customer"]["phone"] is None and r.json()["allowedActions"] == []


async def test_withdraw_and_reject(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await make_world(http, clock)
    bid = await book(http, w)
    r = await http.post(f"/api/v1/customer/bookings/{bid}/cancel", headers=w.customer.headers, json={})
    assert r.status_code == 200 and r.json()["state"]["approvalStatus"] == "withdrawn"
    assert (await trip_doc(w.trip["id"]))["counts"]["awaiting"] == 0
    bid2 = await book(http, w)
    r = await http.post(f"/api/v1/agency/bookings/{bid2}/reject", headers=w.agency.headers, json={"reason": "x"})
    assert r.status_code == 400
    r = await http.post(
        f"/api/v1/agency/bookings/{bid2}/reject", headers=w.agency.headers, json={"reason": "No space left"}
    )
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert (await accept(http, w, bid2)).status_code == 409
    v = await customer_view(http, w, bid2)
    assert v["rejection"]["reason"] == "agency_rejected" and v["rejection"]["note"] == "No space left"
    kinds = [n["kind"] for n in (await http.get("/api/v1/notifications", headers=w.customer.headers)).json()["items"]]
    assert "booking_rejected" in kinds


async def test_lazy_expiry_of_requests_and_payment_windows(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await make_world(http, clock)
    bid = await book(http, w)
    clock.advance(hours=2, minutes=1)  # past respondBy (pickup − 60 min)
    r = await accept(http, w, bid)
    assert r.status_code == 410 and r.json()["error"]["code"] == "request_expired"
    doc = await booking_doc(bid)
    assert doc["approvalStatus"] == "expired" and doc["closure"]["reason"] == "no_response_before_departure"

    w2 = await make_world(http, clock, lead=timedelta(hours=6))
    bid2 = await book(http, w2)
    assert (await accept(http, w2, bid2)).status_code == 200
    due = (await booking_doc(bid2))["paymentDueAt"]
    clock.set(due + timedelta(minutes=1))
    v = await customer_view(http, w2, bid2)  # GET applies the expiry first
    assert v["status"] == "cancelled" and v["cancellation"]["reason"] == "payment_window_expired"
    trip = await trip_doc(w2.trip["id"])
    assert bid2 not in trip["holds"] and trip["counts"]["held"] == 0
    r = await http.post("/api/v1/payments/orders", json={"bookingId": bid2}, headers={**w2.customer.headers, **idem()})
    assert r.status_code == 409


async def test_visibility_and_roles(http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient) -> None:
    w = await make_world(http, clock)
    bid = await book(http, w)
    other = await make_customer("Kavya Sharma")
    stranger_driver = await make_driver(w.agency, name="Other Driver")
    other_world = await make_world(http, clock)
    # other customer / other agency / unassigned driver → 404; wrong role → 403
    assert (await http.get(f"/api/v1/customer/bookings/{bid}", headers=other.headers)).status_code == 404
    assert (await http.get(f"/api/v1/agency/bookings/{bid}", headers=other_world.agency.headers)).status_code == 404
    assert (
        await http.post(f"/api/v1/agency/bookings/{bid}/accept", headers=other_world.agency.headers)
    ).status_code == 404
    assert (await http.get(f"/api/v1/customer/bookings/{bid}", headers=w.agency.headers)).status_code == 403
    assert (await http.post(f"/api/v1/agency/bookings/{bid}/accept", headers=w.customer.headers)).status_code == 403
    assert (await http.get("/api/v1/driver/shipments", headers=w.customer.headers)).status_code == 403
    assert (await http.get("/api/v1/notifications")).status_code == 401
    # the assigned driver sees nothing before payment
    assert (await http.get(f"/api/v1/driver/shipments/{bid}", headers=w.driver.headers)).status_code == 404
    assert (await accept(http, w, bid)).status_code == 200
    assert (await http.get(f"/api/v1/driver/shipments/{bid}", headers=w.driver.headers)).status_code == 404
    await pay(http, w, bid, fake_cf, clock)
    assert (await http.get(f"/api/v1/driver/shipments/{bid}", headers=w.driver.headers)).status_code == 200
    assert (await http.get(f"/api/v1/driver/shipments/{bid}", headers=stranger_driver.headers)).status_code == 404
    otp = (await customer_view(http, w, bid))["otps"]["pickup"]
    r = await http.post(f"/api/v1/driver/shipments/{bid}/pickup", headers=stranger_driver.headers, json={"otp": otp})
    assert r.status_code == 404
    unlinked = await make_driver(None, name="Loner", link=None)
    r = await http.get("/api/v1/driver/shipments", headers=unlinked.headers)
    assert r.status_code == 403 and r.json()["error"]["code"] == "driver_not_linked"
    r = await http.get("/api/v1/driver/dashboard", headers=unlinked.headers)
    assert r.status_code == 200 and r.json()["approved"] is False
    r = await http.get("/api/v1/driver/dashboard", headers=w.driver.headers)
    assert r.json()["pendingPickups"] == 1 and r.json()["nextActions"][0]["bookingId"] == bid


async def test_otp_lockout_regeneration_and_refuse_pickup(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    w = await make_world(http, clock)
    bid = await book(http, w)
    await accept(http, w, bid)
    await pay(http, w, bid, fake_cf, clock)
    old = (await customer_view(http, w, bid))["otps"]["pickup"]
    wrong = "123456" if old != "123456" else "654321"
    r = await http.post(
        f"/api/v1/customer/bookings/{bid}/otp/regenerate", headers=w.customer.headers, json={"which": "pickup"}
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "otp_not_exhausted"
    codes = []
    for _ in range(5):
        r = await http.post(f"/api/v1/driver/shipments/{bid}/pickup", headers=w.driver.headers, json={"otp": wrong})
        codes.append(r.json()["error"]["code"])
    assert codes[-1] == "too_many_attempts" and codes[:4] == ["otp_invalid"] * 4
    r = await http.post(f"/api/v1/driver/shipments/{bid}/pickup", headers=w.driver.headers, json={"otp": old})
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_many_attempts"
    assert (await customer_view(http, w, bid))["otps"]["pickupLocked"] is True
    r = await http.post(
        f"/api/v1/customer/bookings/{bid}/otp/regenerate", headers=w.customer.headers, json={"which": "pickup"}
    )
    assert r.status_code == 200, r.text
    new = r.json()["otps"]["pickup"]
    assert new and len(new) == 6 and r.json()["otps"]["pickupLocked"] is False
    # refuse pickup → full refund; booking closed
    r = await http.post(
        f"/api/v1/driver/shipments/{bid}/refuse-pickup", headers=w.driver.headers, json={"reason": "Prohibited goods"}
    )
    assert r.status_code == 200, r.text
    doc = await booking_doc(bid)
    assert doc["fulfilmentStatus"] == "pickup_refused" and doc["paymentStatus"] == "refund_pending"
    assert doc["closure"]["reason"] == "pickup_refused" and doc["status"] == "cancelled"
    r = await http.post(f"/api/v1/driver/shipments/{bid}/pickup", headers=w.driver.headers, json={"otp": new})
    assert r.status_code == 409


async def test_failed_payment_webhook_keeps_booking_payable(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    w = await make_world(http, clock)
    bid = await book(http, w)
    await accept(http, w, bid)
    r = await http.post("/api/v1/payments/orders", json={"bookingId": bid}, headers={**w.customer.headers, **idem()})
    assert r.status_code == 201, r.text
    pid = r.json()["paymentId"]
    assert (await booking_doc(bid))["paymentStatus"] == "processing"
    payment = fake_cf.mark_failed(pid)
    ts = str(int(clock.now().timestamp() * 1000))
    body, headers = signed_webhook("PAYMENT_FAILED_WEBHOOK", pid, payment=payment, timestamp=ts)
    r = await http.post("/api/v1/payments/cashfree/webhook", content=body, headers=headers)
    assert r.status_code == 200, r.text
    v = await customer_view(http, w, bid)
    assert v["status"] == "payment_failed" and v["canPay"] and v["state"]["reservationStatus"] == "held"
    # a browser can never mark it paid: only the verified webhook path does
    await pay(http, w, bid, fake_cf, clock)
    assert (await customer_view(http, w, bid))["status"] == "confirmed"
