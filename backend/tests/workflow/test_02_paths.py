"""T2 §6.2 items 8, 11, 12 + P2 §7: Cashfree confirmation, cancellations, expiry via the sweep,
trip cancel cascade, reassign and per-leg capacity. In-process (clock and FakeCashfree control)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest

from app.core.clock import FrozenClock
from app.integrations.cashfree.models import CfPayment
from app.repositories.base import C
from app.tests_support.fake_cashfree import FakeCashfreeClient, signed_webhook
from tests.workflow import support as S
from tests.workflow.support import API, COIMBATORE, ERODE, SALEM, TIRUPPUR, doc, ecode, expect_error

pytestmark = [pytest.mark.emulator, pytest.mark.inprocess]

CRON = {"Authorization": f"Bearer {os.environ.get('CRON_SECRET', 't2-cron-secret-0123456789')}"}


@dataclass
class World:
    f: S.Fleet
    trip: dict[str, Any]
    cust: S.Actor
    start: datetime

    def day(self, i: int) -> str:
        return S.ist_day(datetime.fromisoformat(self.trip["checkpoints"][i]["expectedDepartureAt"].replace("Z", "+00:00")))


async def world(api: httpx.AsyncClient, clock: FrozenClock, offered_kg: int = 500, lead_min: int = 80) -> World:
    f = await S.verified_fleet(api)
    start = (clock.now() + timedelta(minutes=lead_min)).replace(second=0, microsecond=0)
    trip = await S.publish_trip(api, f, start, offered_kg=offered_kg)
    cust = await S.signup_customer(api)
    return World(f, trip, cust, start)


async def requested(api: httpx.AsyncClient, w: World, src: str = COIMBATORE, dst: str = SALEM, kg: int = 100) -> str:
    i = S.STOPS.index(src)
    s = await S.shipment(api, w.cust, src, dst, w.day(i), weight=kg)
    r = await S.request_booking(api, w.cust, s["id"], w.trip["id"])
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def accepted(api: httpx.AsyncClient, w: World, **kw: Any) -> str:
    bid = await requested(api, w, **kw)
    r = await api.post(f"{API}/agency/bookings/{bid}/accept", headers=w.f.agency.h, json={})
    assert r.status_code == 200, r.text
    return bid


async def paid_dev(api: httpx.AsyncClient, w: World, **kw: Any) -> str:
    bid = await accepted(api, w, **kw)
    _, r = await S.dev_pay(api, w.cust, bid)
    assert r.status_code == 200 and r.json()["status"] == "succeeded", r.text
    return bid


async def sweep(api: httpx.AsyncClient) -> dict[str, Any]:
    r = await api.post(f"{API}/internal/sweep", headers=CRON)
    assert r.status_code == 200, r.text
    return dict(r.json())


async def available(api: httpx.AsyncClient, w: World) -> int:
    r = await api.get(f"{API}/agency/trips/{w.trip['id']}", headers=w.f.agency.h)
    return int(r.json()["capacity"]["availableKg"])


# ── Cashfree: paid only after verified confirmation ──────────────────────────
async def test_cashfree_paid_only_after_verified_confirmation(
    api: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient, registry: S.SwitchableRegistry
) -> None:
    registry.mode = "cashfree"
    w = await world(api, clock)
    bid = await accepted(api, w)
    r = await api.post(f"{API}/payments/orders", json={"bookingId": bid}, headers={**w.cust.h, **S.idem()})
    assert r.status_code == 201, r.text
    order = r.json()
    pid, amount = order["paymentId"], order["amountRupees"]
    assert order["provider"] == "cashfree" and order["checkout"]["kind"] == "cashfree" and order["checkout"]["paymentSessionId"]
    b = await doc(C.bookings, bid)
    assert b["paymentStatus"] == "processing" and amount == b["pricing"]["totalPayable"]

    # unsigned and forged webhooks change nothing
    r = await api.post(f"{API}/payments/cashfree/webhook", content=b'{"type":"PAYMENT_SUCCESS_WEBHOOK"}',
                       headers={"content-type": "application/json"})
    assert r.status_code in (400, 401), r.text
    # a correctly signed SUCCESS whose order Cashfree still reports ACTIVE (not paid) → not paid
    fake = CfPayment(cf_payment_id=99, order_id=pid, payment_status="SUCCESS", payment_amount=float(amount),
                     payment_time="2026-11-16T10:00:00+05:30", payment_group="upi", payment_method={"upi": {"upi_id": "x@upi"}})
    body, headers = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", pid, payment=fake, amount_rupees=amount,
                                   timestamp=str(int(clock.now().timestamp() * 1000)))
    r = await api.post(f"{API}/payments/cashfree/webhook", content=body, headers=headers)
    assert r.status_code == 200, r.text
    assert (await doc(C.bookings, bid))["paymentStatus"] != "paid", "paid without Cashfree confirming the order"

    # failed payment → payment_failed, still payable; retry with a new order → paid via verify (E44)
    r = await S.cashfree_webhook(api, fake_cf, pid, amount, ok=False, now=clock.now())
    assert r.status_code == 200, r.text
    v = await S.assert_synced(api, bid, w.cust, w.f.agency)
    assert v["customer"]["status"] == "payment_failed" and v["customer"]["canPay"], v["customer"]
    r = await api.post(f"{API}/payments/orders", json={"bookingId": bid}, headers={**w.cust.h, **S.idem()})
    assert r.status_code == 201, r.text
    pid2 = r.json()["paymentId"]
    assert pid2 != pid
    fake_cf.mark_paid(pid2)
    r = await api.get(f"{API}/payments/{pid2}", headers=w.cust.h)  # read-only: no gateway call
    assert r.json()["bookingState"]["paymentStatus"] != "paid"
    r = await api.post(f"{API}/payments/{pid2}/verify", headers=w.cust.h)
    assert r.status_code == 200, r.text
    st = r.json()
    assert st["status"] == "succeeded" and st["bookingState"]["paymentStatus"] == "paid" and st["provider"] == "cashfree"
    v = await S.assert_synced(api, bid, w.cust, w.f.agency, w.f.driver)
    assert v["customer"]["status"] == "confirmed" and v["driver_status"] == 200
    # duplicate webhook for the confirmed order: no second transition
    payment = fake_cf.orders[pid2].payments[-1]
    body, headers = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", pid2, payment=payment, amount_rupees=amount,
                                   timestamp=str(int(clock.now().timestamp() * 1000)))
    r = await api.post(f"{API}/payments/cashfree/webhook", content=body, headers=headers)
    assert r.status_code == 200 and r.json()["outcome"] in ("duplicate", "ignored"), r.text
    r = await api.post(f"{API}/payments/orders", json={"bookingId": bid}, headers={**w.cust.h, **S.idem()})
    expect_error(r, 409, "already_paid")


# ── cancellation before pickup: 100 % refund incl. TAKI fee, capacity released ─
async def test_cancel_before_pickup_full_refund_and_release(
    api: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient, registry: S.SwitchableRegistry
) -> None:
    registry.mode = "cashfree"
    w = await world(api, clock)
    bid = await accepted(api, w, kg=200)
    r = await api.post(f"{API}/payments/orders", json={"bookingId": bid}, headers={**w.cust.h, **S.idem()})
    pid, amount = r.json()["paymentId"], r.json()["amountRupees"]
    r = await S.cashfree_webhook(api, fake_cf, pid, amount, now=clock.now())
    assert r.status_code == 200 and r.json()["outcome"] == "applied", r.text
    assert await available(api, w) == 300
    b = await doc(C.bookings, bid)
    assert b["pricing"]["serviceFee"] > 0

    r = await api.post(f"{API}/customer/bookings/{bid}/cancel", headers=w.cust.h, json={"reason": "Plans changed"})
    assert r.status_code == 200, r.text
    v = await S.assert_synced(api, bid, w.cust, w.f.agency)
    st = v["customer"]["state"]
    assert v["customer"]["status"] == "cancelled" and st["reservationStatus"] == "released"
    assert st["paymentStatus"] in ("refund_pending", "refunded") and st["closure"]["reason"] == "customer_cancelled"
    assert await available(api, w) == 500 and bid not in (await doc(C.trips, w.trip["id"])).get("holds", {})
    assert (await doc(C.shipments, b["shipmentId"]))["status"] == "open"
    refunds = [x for o in fake_cf.orders.values() for x in o.refunds.values()]
    assert refunds and refunds[0].refund_amount == float(amount), (refunds, amount)  # incl. TAKI service fee
    clock.advance(minutes=6)  # the refund job waits (backoff) while Cashfree reports PENDING
    await sweep(api)  # the job re-asks Cashfree and settles the refund
    p = await doc(C.payments, pid)
    b = await doc(C.bookings, bid)
    assert p["status"] == "refunded" and b["paymentStatus"] == "refunded", (p["status"], b["paymentStatus"])
    # idempotent repeat, then the driver does not see it
    r = await api.post(f"{API}/customer/bookings/{bid}/cancel", headers=w.cust.h, json={})
    assert r.status_code == 200, r.text
    r = await api.get(f"{API}/driver/shipments?tab=pending_pickup", headers=w.f.driver.h)
    assert bid not in [x["bookingId"] for x in r.json()["items"]]


async def test_cancel_while_held_unpaid_releases_without_refund(api: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await world(api, clock)
    bid = await accepted(api, w, kg=150)
    assert await available(api, w) == 350
    r = await api.post(f"{API}/customer/bookings/{bid}/cancel", headers=w.cust.h, json={})
    assert r.status_code == 200, r.text
    b = await doc(C.bookings, bid)
    assert (b["paymentStatus"], b["reservationStatus"]) == ("voided", "released")
    assert await available(api, w) == 500


# ── expiry through the sweep ─────────────────────────────────────────────────
async def test_request_expiry_via_sweep(api: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await world(api, clock)
    bid = await requested(api, w)
    r = await api.post(f"{API}/internal/sweep")
    expect_error(r, 401, "unauthenticated")
    r = await api.post(f"{API}/internal/sweep", headers={"Authorization": "Bearer wrong-secret"})
    expect_error(r, 401, "unauthenticated")
    clock.advance(minutes=25)  # past respondBy = departure − 60 min
    res = await sweep(api)
    assert res["expiredRequests"] >= 1, res
    v = await S.assert_synced(api, bid, w.cust, w.f.agency)
    st = v["customer"]["state"]
    assert st["approvalStatus"] == "expired" and st["closure"]["reason"] == "no_response_before_departure"
    b = await doc(C.bookings, bid)
    assert (await doc(C.shipments, b["shipmentId"]))["status"] == "open"
    r = await api.post(f"{API}/agency/bookings/{bid}/accept", headers=w.f.agency.h, json={})
    assert r.status_code in (409, 410) and ecode(r) in ("request_expired", "invalid_transition"), r.text


async def test_payment_window_expiry_via_sweep(api: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await world(api, clock, lead_min=240)
    bid = await accepted(api, w, kg=300)
    b = await doc(C.bookings, bid)
    due = b["paymentDueAt"]
    assert due <= clock.now() + timedelta(minutes=121)
    assert await available(api, w) == 200
    clock.set(due + timedelta(minutes=1))
    assert await available(api, w) == 500  # an expired hold stops counting before the sweep
    res = await sweep(api)
    assert res["expiredPayments"] >= 1, res
    v = await S.assert_synced(api, bid, w.cust, w.f.agency)
    st = v["customer"]["state"]
    assert v["customer"]["status"] == "cancelled" and st["paymentStatus"] == "expired" and st["reservationStatus"] == "released"
    assert st["closure"]["reason"] == "payment_window_expired"
    assert bid not in (await doc(C.trips, w.trip["id"])).get("holds", {})
    r = await api.post(f"{API}/payments/orders", json={"bookingId": bid}, headers={**w.cust.h, **S.idem()})
    assert r.status_code in (409, 410), r.text


# ── trip cancel by the agency with a pending and a paid booking ──────────────
async def test_trip_cancel_cascade(api: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await world(api, clock)
    b_paid = await paid_dev(api, w, kg=100)
    b_pend = await requested(api, w, src=TIRUPPUR, dst=SALEM, kg=50)
    r = await api.post(f"{API}/agency/trips/{w.trip['id']}/cancel", headers=w.f.agency.h, json={"reason": "Truck breakdown"})
    assert r.status_code == 200 and r.json()["status"] == "cancelled", r.text
    v = await S.assert_synced(api, b_pend, w.cust, w.f.agency)
    assert v["customer"]["status"] == "rejected" and v["customer"]["state"]["closure"]["reason"] == "trip_cancelled"
    v = await S.assert_synced(api, b_paid, w.cust, w.f.agency)
    st = v["customer"]["state"]
    assert v["customer"]["status"] == "cancelled" and st["paymentStatus"] in ("refund_pending", "refunded")
    assert st["closure"]["reason"] == "trip_cancelled"
    t = await doc(C.trips, w.trip["id"])
    assert not t.get("holds") and not t.get("searchKeys")
    r = await api.get(f"{API}/driver/shipments?tab=pending_pickup", headers=w.f.driver.h)
    assert r.status_code == 200 and r.json()["items"] == [], r.text
    sched = await S.docs_where(C.schedules, "tripId", w.trip["id"])
    assert not [x for x in sched if x.get("status", "live") == "live"], sched


# ── driver reassign moves paid bookings to the new driver ────────────────────
async def test_driver_reassign(api: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await world(api, clock)
    bid = await paid_dev(api, w)
    d2 = await S.invite_and_signup_driver(api, w.f.agency, "Kumar Second")
    r = await api.post(f"{API}/agency/trips/{w.trip['id']}/reassign", headers=w.f.agency.h, json={"driverId": d2.uid})
    expect_error(r, 409, "driver_not_verified")
    await S.driver_documents(api, d2, dl="TN0220190005678")
    r = await api.post(f"{API}/admin/drivers/{d2.uid}/verify", headers=w.f.admin.h, json={})
    assert r.status_code == 200, r.text
    r = await api.post(f"{API}/agency/trips/{w.trip['id']}/reassign", headers=w.f.agency.h, json={"driverId": d2.uid})
    assert r.status_code == 200 and r.json()["driver"]["id"] == d2.uid, r.text
    assert (await doc(C.bookings, bid))["driverId"] == d2.uid
    assert (await api.get(f"{API}/driver/shipments/{bid}", headers=w.f.driver.h)).status_code == 404
    v = await S.assert_synced(api, bid, w.cust, w.f.agency, d2)
    assert v["driver_status"] == 200 and v["customer"]["driver"]["name"] == "Kumar Second"
    async def kinds(a: S.Actor) -> list[str]:
        r = await api.get(f"{API}/notifications?limit=50", headers=a.h)
        return [n["kind"] for n in r.json()["items"]]

    assert "trip_published" in await kinds(d2)  # new driver: "New trip assigned"
    assert "driver_reassigned" in await kinds(w.f.driver)
    assert "driver_reassigned" in await kinds(w.cust)
    tl = (await api.get(f"{API}/customer/bookings/{bid}/tracking", headers=w.cust.h)).json()["events"]
    assert "driver_reassigned" in [e["type"] for e in tl]


# ── per-leg capacity: space frees after the drop stop; overbooking refused ───
async def test_per_leg_capacity(api: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await world(api, clock, offered_kg=500)
    a = await accepted(api, w, src=COIMBATORE, dst=TIRUPPUR, kg=400)  # leg 0
    c = await requested(api, w, src=TIRUPPUR, dst=SALEM, kg=200)  # legs 1–2: free while only requested
    b = await accepted(api, w, src=ERODE, dst=SALEM, kg=400)  # leg 2: no overlap with a → fits
    legs = (await api.get(f"{API}/agency/trips/{w.trip['id']}", headers=w.f.agency.h)).json()["legs"]
    assert [x["loadKg"] for x in legs] == [400, 0, 400], legs
    # a new request that no longer fits is refused at request time (E34 409)
    s = await S.shipment(api, w.cust, TIRUPPUR, SALEM, w.day(1), weight=200)
    r = await S.request_booking(api, w.cust, s["id"], w.trip["id"])
    expect_error(r, 409, "insufficient_capacity")
    assert r.json()["error"]["details"]["availableKg"] == 100
    r = await api.post(f"{API}/agency/bookings/{c}/accept", headers=w.f.agency.h, json={})
    expect_error(r, 409, "insufficient_capacity")
    assert (await doc(C.bookings, c))["reservationStatus"] == "none"
    # the customer cancels b (held): leg 2 is free again and c fits
    r = await api.post(f"{API}/customer/bookings/{b}/cancel", headers=w.cust.h, json={})
    assert r.status_code == 200, r.text
    r = await api.post(f"{API}/agency/bookings/{c}/accept", headers=w.f.agency.h, json={})
    assert r.status_code == 200, r.text
    legs = (await api.get(f"{API}/agency/trips/{w.trip['id']}", headers=w.f.agency.h)).json()["legs"]
    assert [x["loadKg"] for x in legs] == [400, 200, 200], legs
    assert a
