"""T2 deeper checks: concurrent accepts never overbook, checkout grace on the payment window, late
Cashfree payment after expiry, earnings/settlement arithmetic, dashboards and history."""

from __future__ import annotations

import asyncio
from datetime import timedelta
from typing import Any

import httpx
import pytest

from app.core.clock import FrozenClock
from app.repositories.base import C
from app.tests_support.fake_cashfree import FakeCashfreeClient
from tests.workflow import support as S
from tests.workflow.support import API, COIMBATORE, ERODE, SALEM, TIRUPPUR, doc, ecode, expect_error, expect_keys
from tests.workflow.test_02_paths import CRON, accepted, paid_dev, requested, sweep, world

pytestmark = [pytest.mark.emulator, pytest.mark.inprocess]


async def test_concurrent_accepts_never_overbook(api: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await world(api, clock, offered_kg=500)
    b1 = await requested(api, w, kg=300)
    b2 = await requested(api, w, src=TIRUPPUR, dst=SALEM, kg=300)
    rs = await asyncio.gather(*[api.post(f"{API}/agency/bookings/{b}/accept", headers=w.f.agency.h, json={}) for b in (b1, b2)])
    codes = sorted((r.status_code, ecode(r)) for r in rs)
    assert codes == [(200, None), (409, "insufficient_capacity")], [r.text for r in rs]
    t = await doc(C.trips, w.trip["id"])
    assert len(t["holds"]) == 1 and max(h["kg"] for h in t["holds"].values()) == 300
    # the same idempotency key sent twice concurrently → one booking
    s = await S.shipment(api, w.cust, ERODE, SALEM, w.day(2), weight=50)
    key = S.idem()
    body = {"shipmentId": s["id"], "tripId": w.trip["id"]}
    rs = await asyncio.gather(*[api.post(f"{API}/customer/bookings", json=body, headers={**w.cust.h, **key}) for _ in range(2)])
    assert sorted(r.status_code for r in rs) in ([200, 201], [201, 409]), [r.text for r in rs]
    assert len(await S.docs_where(C.bookings, "shipmentId", s["id"])) == 1


async def test_checkout_extends_payment_window(api: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await world(api, clock, lead_min=240)
    bid = await accepted(api, w)
    due = (await doc(C.bookings, bid))["paymentDueAt"]
    clock.set(due - timedelta(minutes=5))
    r = await api.post(f"{API}/payments/orders", json={"bookingId": bid}, headers={**w.cust.h, **S.idem()})
    assert r.status_code == 201, r.text
    order = r.json()
    hold = (await doc(C.trips, w.trip["id"]))["holds"][bid]
    assert hold["dueAt"] >= clock.now() + timedelta(minutes=15) - timedelta(seconds=1), (hold, clock.now())
    clock.set(due + timedelta(minutes=2))  # past the original window, inside the checkout grace
    res = await sweep(api)
    b = await doc(C.bookings, bid)
    assert b["closure"] is None and b["reservationStatus"] == "held", (res, b["paymentStatus"], b["closure"])
    r = await api.post(f"{API}/payments/dev/confirm", headers=w.cust.h,
                       json={"paymentId": order["paymentId"], "outcome": "success", "devToken": order["checkout"]["devToken"]})
    assert r.status_code == 200 and r.json()["bookingState"]["paymentStatus"] == "paid", r.text


async def test_late_cashfree_success_after_expiry_is_refunded(
    api: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient, registry: S.SwitchableRegistry
) -> None:
    registry.mode = "cashfree"
    w = await world(api, clock, lead_min=240)
    bid = await accepted(api, w)
    r = await api.post(f"{API}/payments/orders", json={"bookingId": bid}, headers={**w.cust.h, **S.idem()})
    pid, amount = r.json()["paymentId"], r.json()["amountRupees"]
    hold_due = (await doc(C.trips, w.trip["id"]))["holds"][bid]["dueAt"]
    clock.set(hold_due + timedelta(minutes=1))
    await sweep(api)
    b = await doc(C.bookings, bid)
    assert b["closure"] and b["closure"]["reason"] == "payment_window_expired", b.get("closure")
    r = await S.cashfree_webhook(api, fake_cf, pid, amount, now=clock.now())
    assert r.status_code == 200, r.text
    b = await doc(C.bookings, bid)
    p = await doc(C.payments, pid)
    assert b["paymentStatus"] != "paid" and b["reservationStatus"] == "released", b["paymentStatus"]
    assert p["status"] in ("refund_pending", "refunded"), p["status"]
    assert bid not in (await doc(C.trips, w.trip["id"])).get("holds", {})


async def _deliver(api: httpx.AsyncClient, w: Any, bids: list[str]) -> None:
    drv, tid = w.f.driver, w.trip["id"]
    otps = {b: (await api.get(f"{API}/customer/bookings/{b}", headers=w.cust.h)).json()["otps"] for b in bids}
    r = await api.post(f"{API}/driver/trips/{tid}/checkpoints/0/depart", headers=drv.h, json={})
    assert r.status_code == 200, r.text
    for b in bids:
        r = await api.post(f"{API}/driver/shipments/{b}/pickup", headers=drv.h, json={"otp": otps[b]["pickup"]})
        assert r.status_code == 200, r.text
    for path in ("1/arrive", "1/depart", "2/arrive", "2/depart", "3/arrive"):
        r = await api.post(f"{API}/driver/trips/{tid}/checkpoints/{path}", headers=drv.h, json={})
        assert r.status_code == 200, (path, r.text)
    for b in bids:
        r = await api.post(f"{API}/driver/shipments/{b}/deliver", headers=drv.h, files={"otp": (None, otps[b]["delivery"])})
        assert r.status_code == 200, r.text
    r = await api.post(f"{API}/driver/trips/{tid}/complete", headers=drv.h, json={})
    assert r.status_code == 200, r.text


async def test_earnings_settlement_and_dashboards(api: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await world(api, clock)
    b1 = await paid_dev(api, w, kg=120)
    b2 = await paid_dev(api, w, src=COIMBATORE, dst=SALEM, kg=80)
    b3 = await accepted(api, w, src=TIRUPPUR, dst=SALEM, kg=50)  # never paid: no earning
    await api.post(f"{API}/customer/bookings/{b3}/cancel", headers=w.cust.h, json={})
    adm, ag = w.f.admin, w.f.agency
    r = await api.post(f"{API}/admin/settlements", headers=adm.h,
                       json={"agencyId": ag.agency_id, "through": S.ist_day(clock.now()), "reference": "UTRNONE01"})
    expect_error(r, 409, "conflict")  # nothing delivered yet
    await _deliver(api, w, [b1, b2])
    bdocs = {b: await doc(C.bookings, b) for b in (b1, b2)}
    r = await api.get(f"{API}/agency/earnings", headers=ag.h)
    assert r.status_code == 200, r.text
    e = r.json()
    rows = {x["bookingId"]: x for x in e["byBooking"]}
    assert set(rows) == {b1, b2}, rows
    for b, d in bdocs.items():
        p = d["pricing"]
        x = rows[b]
        assert (x["customerPaid"], x["platformFee"], x["agencyNet"]) == (p["totalPayable"], p["serviceFee"], p["agencyNet"]), (x, p)
        assert x["additionalCharges"] == x["handlingFee"] == p["additionalCharges"]
    net = sum(d["pricing"]["agencyNet"] for d in bdocs.values())
    assert e["summary"]["total"] == net and e["summary"]["pending"] == net and e["summary"]["settled"] == 0, e["summary"]
    assert all(pay["status"] == "succeeded" for pay in e["payments"]) and len(e["payments"]) == 2, e["payments"]

    r = await api.get(f"{API}/admin/settlements", headers=adm.h)
    row = next(x for x in r.json()["items"] if x["agencyId"] == ag.agency_id)
    assert (row["pendingAmount"], row["pendingCount"]) == (net, 2), row
    ref = "UTR" + S.secrets.token_hex(4).upper()
    r = await api.post(f"{API}/admin/settlements", headers=adm.h,
                       json={"agencyId": ag.agency_id, "through": S.ist_day(clock.now() + timedelta(days=1)), "reference": ref})
    assert r.status_code == 201, r.text
    res = r.json()
    assert (res["amount"], res["count"]) == (net, 2), res
    stl = await doc(C.settlements, res["settlementId"])
    assert stl["agencyId"] == ag.agency_id and stl["reference"] == ref
    e = (await api.get(f"{API}/agency/earnings", headers=ag.h)).json()
    assert e["summary"]["settled"] == net and e["summary"]["pending"] == 0 and len(e["settlements"]) == 1, e["summary"]
    kinds = [n["kind"] for n in (await api.get(f"{API}/notifications?limit=50", headers=ag.h)).json()["items"]]
    assert "settlement_recorded" in kinds, kinds
    r = await api.get(f"{API}/admin/settlements/history", params={"agencyId": ag.agency_id}, headers=adm.h)
    assert [x["reference"] for x in r.json()["items"]] == [ref], r.text

    # dashboards and history reflect the same records
    r = await api.get(f"{API}/customer/dashboard", headers=w.cust.h)
    assert r.status_code == 200 and r.json()["counts"]["delivered"] == 2, r.text
    r = await api.get(f"{API}/agency/dashboard", headers=ag.h)
    assert r.status_code == 200, r.text
    r = await api.get(f"{API}/driver/dashboard", headers=w.f.driver.h)
    assert r.status_code == 200, r.text
    r = await api.get(f"{API}/driver/history", headers=w.f.driver.h)
    assert sorted(x["bookingId"] for x in r.json()["items"]) == sorted([b1, b2]), r.text
    r = await api.get(f"{API}/agency/history", params={"type": "bookings", "q": b1}, headers=ag.h)
    assert r.status_code == 200 and b1 in r.text, r.text
    r = await api.get(f"{API}/customer/bookings", params={"tab": "delivered"}, headers=w.cust.h)
    assert sorted(x["id"] for x in r.json()["items"]) == sorted([b1, b2]), r.text
    r = await api.get(f"{API}/customer/bookings/counts", headers=w.cust.h)
    assert r.json()["delivered"] == 2 and r.json()["cancelled"] == 1, r.json()
    r = await api.get(f"{API}/agency/bookings", params={"tab": "confirmed", "tripId": w.trip["id"]}, headers=ag.h)
    assert sorted(x["id"] for x in r.json()["items"]) == sorted([b1, b2]), r.text
    assert r.json()["counts"]["cancelled"] == 1, r.json()["counts"]
    expect_keys(r.json()["items"][0], ["id", "status", "state", "matchType", "capacity"], "E80 AgencyBookingListItem")
    _ = CRON
