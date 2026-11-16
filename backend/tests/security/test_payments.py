"""T3 · Payments (P2 §10): webhook authenticity, replay, ordering, amount/currency checks, the
"return page cannot mark paid" rule, 501 without credentials, and the dev gateway guard.

Real ``booking_service`` + ``PaymentService`` with D5's ``FakeCashfreeClient`` (no network)."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest

from app.core.clock import FrozenClock
from app.integrations.cashfree.gateway import CashfreeGateway, DevGateway, GatewayRegistry
from app.models.payment import PaymentDoc  # noqa: F401  (import check: model used by the service)
from app.repositories.base import C, get_doc
from app.services.payment_service import PaymentService, get_payment_service
from app.tests_support.fake_cashfree import FakeCashfreeClient, signed_webhook
from tests.bookings.support import COIMBATORE, SALEM, World, accept, booking_doc, create_shipment, make_world, request
from tests.security.conftest import cashfree_settings, err, idem

pytestmark = pytest.mark.emulator
HOOK = "/api/v1/payments/cashfree/webhook"


async def _accepted(http: httpx.AsyncClient, clock: FrozenClock) -> tuple[World, str]:
    w = await make_world(http, clock)
    s = await create_shipment(http, w, COIMBATORE, SALEM, weight=250)
    r = await request(http, w, s["id"])
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    assert (await accept(http, w, bid)).status_code == 200
    return w, bid


async def _order(http: httpx.AsyncClient, w: World, bid: str) -> dict[str, Any]:
    r = await http.post("/api/v1/payments/orders", json={"bookingId": bid}, headers={**w.customer.headers, **idem()})
    assert r.status_code == 201, r.text
    return dict(r.json())


def _ts(clock: FrozenClock, skew_s: int = 0) -> str:
    return str(int((clock.now().timestamp() + skew_s) * 1000))


async def _state(bid: str, pid: str) -> tuple[str, str, str]:
    b = await booking_doc(bid)
    p = await get_doc(C.payments, pid)
    assert p is not None
    return b["paymentStatus"], b["reservationStatus"], p["status"]


async def test_webhook_authenticity(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    w, bid = await _accepted(http, clock)
    o = await _order(http, w, bid)
    pid = o["paymentId"]
    pay = fake_cf.mark_paid(pid)
    body, headers = signed_webhook(
        "PAYMENT_SUCCESS_WEBHOOK", pid, payment=pay, amount_rupees=o["amountRupees"], timestamp=_ts(clock)
    )
    cases = {
        "unsigned": ({"content-type": "application/json"}, body, "invalid_signature"),
        "bad_signature": ({**headers, "x-webhook-signature": "AAAA" + headers["x-webhook-signature"][4:]}, body,
                          "invalid_signature"),
        "other_secret": (signed_webhook("PAYMENT_SUCCESS_WEBHOOK", pid, payment=pay, secret="not-the-secret",
                                        timestamp=_ts(clock))[1], body, "invalid_signature"),
        "body_changed": (headers, body.replace(b"Test", b"Tost"), "invalid_signature"),
        "stale": (signed_webhook("PAYMENT_SUCCESS_WEBHOOK", pid, payment=pay, amount_rupees=o["amountRupees"],
                                 timestamp=_ts(clock, -3600))[1], None, "stale_timestamp"),
        "future": (signed_webhook("PAYMENT_SUCCESS_WEBHOOK", pid, payment=pay, amount_rupees=o["amountRupees"],
                                  timestamp=_ts(clock, +3600))[1], None, "stale_timestamp"),
    }
    for name, (h, b, code) in cases.items():
        if b is None:  # stale/future: re-sign the same event with the skewed timestamp
            b2, h2 = signed_webhook(
                "PAYMENT_SUCCESS_WEBHOOK", pid, payment=pay, amount_rupees=o["amountRupees"],
                timestamp=h["x-webhook-timestamp"],
            )
            b, h = b2, h2
        r = await http.post(HOOK, content=b, headers=h)
        assert (r.status_code, err(r)) == (401, code), name
    assert (await _state(bid, pid))[0] != "paid"
    r = await http.post(HOOK, content=body, headers=headers)
    assert r.status_code == 200 and r.json()["outcome"] == "applied", r.text
    assert await _state(bid, pid) == ("paid", "committed", "succeeded")


async def test_replayed_and_concurrent_webhooks_apply_once(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    w, bid = await _accepted(http, clock)
    o = await _order(http, w, bid)
    pid = o["paymentId"]
    pay = fake_cf.mark_paid(pid)
    body, headers = signed_webhook(
        "PAYMENT_SUCCESS_WEBHOOK", pid, payment=pay, amount_rupees=o["amountRupees"], timestamp=_ts(clock)
    )
    # The same event delivered concurrently 3x plus the return-page verify.
    rs = await asyncio.gather(
        *[http.post(HOOK, content=body, headers=headers) for _ in range(3)],
        http.post(f"/api/v1/payments/{pid}/verify", headers=w.customer.headers),
    )
    outcomes = sorted(r.json().get("outcome", r.json().get("status", "?")) for r in rs[:3] if r.status_code == 200)
    assert all(r.status_code in (200, 409) for r in rs), [(r.status_code, r.text) for r in rs]
    assert outcomes.count("applied") <= 1
    # Retries of the identical body later are duplicates.
    r = await http.post(HOOK, content=body, headers=headers)
    assert r.status_code == 200 and r.json()["outcome"] in ("duplicate", "ignored")
    assert await _state(bid, pid) == ("paid", "committed", "succeeded")
    p = await get_doc(C.payments, pid)
    assert p is not None and p.get("refund") is None, p.get("refund")
    trip = await get_doc(C.trips, w.trip["id"])
    assert trip is not None and trip["counts"]["committed"] == 1
    assert [c for c in fake_cf.calls if c[0] == "create_refund"] == []


async def test_out_of_order_failed_after_success_changes_nothing(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    w, bid = await _accepted(http, clock)
    o = await _order(http, w, bid)
    pid = o["paymentId"]
    failed = fake_cf.mark_failed(pid)  # first attempt declined at the gateway ...
    ok = fake_cf.mark_paid(pid)  # ... second attempt succeeded: order PAID
    body_ok, h_ok = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", pid, payment=ok, amount_rupees=o["amountRupees"],
                                   timestamp=_ts(clock))
    body_f, h_f = signed_webhook("PAYMENT_FAILED_WEBHOOK", pid, payment=failed, amount_rupees=o["amountRupees"],
                                 timestamp=_ts(clock))
    # The FAILED event arrives first: the server re-fetches the order (PAID) and confirms anyway.
    r = await http.post(HOOK, content=body_f, headers=h_f)
    assert r.status_code == 200, r.text
    assert await _state(bid, pid) == ("paid", "committed", "succeeded")
    r = await http.post(HOOK, content=body_ok, headers=h_ok)
    assert r.status_code == 200 and r.json()["outcome"] in ("duplicate", "ignored")
    r = await http.post(HOOK, content=body_f, headers=h_f)
    assert r.status_code == 200
    assert await _state(bid, pid) == ("paid", "committed", "succeeded")


async def test_forged_success_event_without_gateway_payment_does_not_mark_paid(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    """A correctly signed SUCCESS body (e.g. replay of an old body) is only a trigger: Cashfree says ACTIVE."""
    w, bid = await _accepted(http, clock)
    o = await _order(http, w, bid)
    pid = o["paymentId"]
    body, headers = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", pid, amount_rupees=o["amountRupees"],
                                   timestamp=_ts(clock))
    r = await http.post(HOOK, content=body, headers=headers)
    assert r.status_code == 200, r.text
    assert (await _state(bid, pid))[0] != "paid"
    # The return page's verify call cannot mark it paid either while the order is ACTIVE.
    r = await http.post(f"/api/v1/payments/{pid}/verify", headers=w.customer.headers)
    assert r.status_code == 200 and r.json()["status"] in ("pending", "created"), r.text
    assert (await _state(bid, pid))[0] != "paid"
    r = await http.get(f"/api/v1/customer/bookings/{bid}", headers=w.customer.headers)
    assert r.json()["otps"] is None and r.json()["driver"]["phone"] is None


async def test_webhook_for_unknown_order_is_ignored(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    for oid in ("pay_" + "z" * 20, "order_from_elsewhere"):
        body, headers = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", oid, amount_rupees=10, timestamp=_ts(clock))
        r = await http.post(HOOK, content=body, headers=headers)
        assert r.status_code == 200 and r.json()["outcome"] == "ignored", r.text


async def test_amount_mismatch_never_confirms(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    w, bid = await _accepted(http, clock)
    o = await _order(http, w, bid)
    pid = o["paymentId"]
    pay = fake_cf.mark_paid(pid, amount_rupees=1.0)
    body, headers = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", pid, payment=pay, amount_rupees=o["amountRupees"],
                                   timestamp=_ts(clock))
    r = await http.post(HOOK, content=body, headers=headers)
    assert r.status_code == 200, r.text
    b, _, p = await _state(bid, pid)
    assert b != "paid" and p == "failed"
    assert (await get_doc(C.payments, pid))["failureReason"] == "amount_mismatch"  # type: ignore[index]


@pytest.mark.xfail(strict=True, reason="T3-2: order/payment currency is never checked; a non-INR order is confirmed")
async def test_currency_mismatch_never_confirms(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    w, bid = await _accepted(http, clock)
    o = await _order(http, w, bid)
    pid = o["paymentId"]
    pay = fake_cf.mark_paid(pid)
    original = fake_cf._cf_order
    monkeypatch.setattr(fake_cf, "_cf_order", lambda oid: original(oid).model_copy(update={"order_currency": "USD"}))
    body, headers = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", pid, payment=pay, amount_rupees=o["amountRupees"],
                                   timestamp=_ts(clock))
    r = await http.post(HOOK, content=body, headers=headers)
    assert r.status_code == 200, r.text
    assert (await _state(bid, pid))[0] != "paid"


async def test_double_order_then_both_paid_refunds_the_second(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    """Two checkouts for one booking both captured: the booking is paid once, the other is refunded."""
    w, bid = await _accepted(http, clock)
    o1 = await _order(http, w, bid)
    fake_cf.orders[o1["paymentId"]].status = "ACTIVE"
    fake_cf.mark_dropped(o1["paymentId"])
    r = await http.post(f"/api/v1/payments/{o1['paymentId']}/verify", headers=w.customer.headers)
    assert r.status_code == 200, r.text
    o2 = await _order(http, w, bid)
    assert o2["paymentId"] != o1["paymentId"]
    p1, p2 = fake_cf.mark_paid(o1["paymentId"]), fake_cf.mark_paid(o2["paymentId"])
    hooks = [
        signed_webhook("PAYMENT_SUCCESS_WEBHOOK", o["paymentId"], payment=p, amount_rupees=o["amountRupees"],
                       timestamp=_ts(clock))
        for o, p in ((o2, p2), (o1, p1))
    ]
    rs = await asyncio.gather(*[http.post(HOOK, content=b, headers=h) for b, h in hooks])
    assert all(r.status_code in (200, 409) for r in rs), [r.text for r in rs]
    for r, (b, h) in zip(rs, hooks, strict=True):  # contention → Cashfree retries
        if r.status_code == 409:
            assert (await http.post(HOOK, content=b, headers=h)).status_code == 200
    statuses = sorted([(await get_doc(C.payments, o["paymentId"]))["status"] for o in (o1, o2)])  # type: ignore[index]
    assert statuses[0].startswith("refund") and statuses[1] == "succeeded", statuses
    assert (await booking_doc(bid))["paymentStatus"] == "paid"


async def test_payments_not_configured_returns_501(http: httpx.AsyncClient, sec_app: Any, clock: FrozenClock) -> None:
    w, bid = await _accepted(http, clock)
    s = cashfree_settings(CASHFREE_APP_ID=None, CASHFREE_SECRET_KEY=None, CASHFREE_ENV=None)
    svc = PaymentService(GatewayRegistry(s))
    sec_app.dependency_overrides[get_payment_service] = lambda: svc
    r = await http.post("/api/v1/payments/orders", json={"bookingId": bid}, headers={**w.customer.headers, **idem()})
    assert (r.status_code, err(r)) == (501, "payments_not_configured")
    body, headers = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", "pay_" + "q" * 20, timestamp=_ts(clock))
    r = await http.post(HOOK, content=body, headers=headers)
    assert r.status_code == 501, r.text
    assert (await booking_doc(bid))["paymentStatus"] != "paid"


@pytest.mark.parametrize("app_env", ["production", "staging"])
def test_dev_gateway_never_exists_outside_dev(app_env: str) -> None:
    s = cashfree_settings(APP_ENV=app_env, PAYMENT_PROVIDER="dev", CASHFREE_APP_ID=None, CASHFREE_SECRET_KEY=None)
    reg = GatewayRegistry(s, dev=DevGateway("x" * 32))
    assert reg.dev is None and not reg.configured


async def test_dev_confirm_unreachable_with_cashfree_provider(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    w, bid = await _accepted(http, clock)
    o = await _order(http, w, bid)
    r = await http.post(
        "/api/v1/payments/dev/confirm",
        json={"paymentId": o["paymentId"], "outcome": "success", "devToken": "x" * 32},
        headers=w.customer.headers,
    )
    assert r.status_code == 404, r.text
    assert (await booking_doc(bid))["paymentStatus"] != "paid"


async def test_dev_confirm_requires_matching_token_even_in_dev(
    http: httpx.AsyncClient, sec_app: Any, clock: FrozenClock
) -> None:
    s = cashfree_settings(PAYMENT_PROVIDER="dev", CASHFREE_APP_ID=None, CASHFREE_SECRET_KEY=None)
    dev = DevGateway("t3-dev-secret-0123456789abcdef")
    svc = PaymentService(GatewayRegistry(s, dev=dev))
    sec_app.dependency_overrides[get_payment_service] = lambda: svc
    w, bid = await _accepted(http, clock)
    o = await _order(http, w, bid)
    pid = o["paymentId"]
    r = await http.post(
        "/api/v1/payments/dev/confirm",
        json={"paymentId": pid, "outcome": "success", "devToken": "f" * 32},
        headers=w.customer.headers,
    )
    assert (r.status_code, err(r)) == (403, "forbidden")
    from tests.support.builders import make_customer

    other = await make_customer()
    r = await http.post(
        "/api/v1/payments/dev/confirm",
        json={"paymentId": pid, "outcome": "success", "devToken": dev.token_for(pid)},
        headers=other.headers,
    )
    assert r.status_code == 404
    assert (await booking_doc(bid))["paymentStatus"] != "paid"


_ = CashfreeGateway
