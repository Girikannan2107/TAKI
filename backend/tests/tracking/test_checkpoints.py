"""Driver checkpoints: order rules, idempotency, fan-out to intermediate-segment bookings, manual
fallback steps, remarks visible to every role, delivery without a photo."""

from __future__ import annotations

import httpx
import pytest

from app.core.clock import FrozenClock
from app.tests_support.fake_cashfree import FakeCashfreeClient
from tests.bookings.support import (
    ERODE,
    SALEM,
    TIRUPPUR,
    accept,
    book,
    booking_doc,
    customer_view,
    make_world,
    pay,
)

pytestmark = pytest.mark.emulator


async def test_checkpoint_order_fan_out_and_manual_steps(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    w = await make_world(http, clock)
    a = await book(http, w, TIRUPPUR, ERODE, weight=100)  # intermediate segment 1 → 2
    b = await book(http, w, TIRUPPUR, SALEM, weight=100)  # 1 → 3
    for bid in (a, b):
        assert (await accept(http, w, bid)).status_code == 200
        await pay(http, w, bid, fake_cf, clock)
    tid, drv = w.trip["id"], w.driver.headers
    base = f"/api/v1/driver/trips/{tid}/checkpoints"
    r = await http.post(f"{base}/0/arrive", headers=drv, json={})
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_transition"
    clock.advance(hours=1, minutes=30)
    r = await http.post(f"{base}/1/arrive", headers=drv, json={})
    assert r.status_code == 409 and r.json()["error"]["code"] in ("invalid_transition", "checkpoint_out_of_order")
    assert (
        await http.post(f"{base}/0/depart", headers=drv, json={"clientAt": "2026-11-16T10:00:00+05:30"})
    ).status_code == 200
    r = await http.post(f"{base}/1/depart", headers=drv, json={})
    assert r.status_code == 409 and r.json()["error"]["details"]["expected"] == {"kind": "arrive", "index": 1}
    assert (await http.post(f"{base}/1/arrive", headers=drv, json={})).status_code == 200
    otps = {bid: (await customer_view(http, w, bid))["otps"] for bid in (a, b)}
    for bid in (a, b):
        r = await http.post(f"/api/v1/driver/shipments/{bid}/pickup", headers=drv, json={"otp": otps[bid]["pickup"]})
        assert r.status_code == 200, r.text
    assert (await http.post(f"{base}/1/depart", headers=drv, json={})).status_code == 200
    assert (await booking_doc(a))["fulfilmentStatus"] == "in_transit"
    assert (await http.post(f"{base}/2/arrive", headers=drv, json={})).status_code == 200
    assert (await booking_doc(a))["fulfilmentStatus"] == "out_for_delivery"  # drop of a
    assert (await booking_doc(b))["fulfilmentStatus"] == "in_transit"  # b continues
    kinds = [
        n["kind"]
        for n in (await http.get("/api/v1/notifications?limit=50", headers=w.customer.headers)).json()["items"]
    ]
    assert "checkpoint_reached" in kinds and "out_for_delivery" in kinds

    # delivery without a photo (optional); remark visible to customer and agency
    r = await http.post(f"/api/v1/driver/shipments/{a}/remarks", headers=drv, json={"text": "Gate 2"})
    assert r.status_code == 201 and r.json()["type"] == "remark" and r.json()["byRole"] == "driver"
    r = await http.post(
        f"/api/v1/driver/shipments/{a}/deliver", headers=drv, files=[("otp", (None, otps[a]["delivery"]))]
    )
    assert r.status_code == 200, r.text
    assert r.json()["delivery"]["proofUrls"] == []
    tr = (await http.get(f"/api/v1/customer/bookings/{a}/tracking", headers=w.customer.headers)).json()
    assert any(e["type"] == "remark" and e["remarks"] == "Gate 2" for e in tr["events"])
    tl = (await http.get(f"/api/v1/agency/bookings/{a}", headers=w.agency.headers)).json()["timeline"]
    assert any(e["type"] == "remark" for e in tl)
    stages = {s["key"]: s for s in tr["stages"]}
    assert stages["delivered"]["state"] == "done" and tr["checkpoints"][1]["actualArrivalAt"]

    # manual fallback: out for delivery for b before reaching its drop
    r = await http.post(f"/api/v1/driver/shipments/{b}/out-for-delivery", headers=drv, json={"remarks": "Early drop"})
    assert r.status_code == 200 and r.json()["status"] == "out_for_delivery"
    r = await http.post(f"/api/v1/driver/shipments/{b}/start-transit", headers=drv, json={})
    assert r.status_code == 200 and r.json()["status"] == "out_for_delivery"  # already past: no-op
    r = await http.post(
        f"/api/v1/driver/shipments/{b}/deliver",
        headers=drv,
        files=[("otp", (None, "000000" if otps[b]["delivery"] != "000000" else "111111"))],
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "otp_invalid"
    r = await http.post(
        f"/api/v1/driver/shipments/{b}/deliver", headers=drv, files=[("otp", (None, otps[b]["delivery"]))]
    )
    assert r.status_code == 200 and r.json()["status"] == "delivered"
    r = await http.get(f"/api/v1/driver/trips/{tid}", headers=drv)
    assert r.status_code == 200 and r.json()["canComplete"] is False  # destination not reached yet
    r = await http.post(f"/api/v1/driver/trips/{tid}/complete", headers=drv)
    assert r.status_code == 409
    for path in ("2/depart", "3/arrive"):
        assert (await http.post(f"{base}/{path}", headers=drv, json={})).status_code == 200
    r = await http.post(f"/api/v1/driver/trips/{tid}/complete", headers=drv)
    assert r.status_code == 200 and r.json()["status"] == "completed"
    r = await http.get("/api/v1/driver/trips?status=completed", headers=drv)
    assert [t["id"] for t in r.json()["items"]] == [tid]
