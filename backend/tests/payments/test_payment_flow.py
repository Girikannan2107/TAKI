"""Payment service + endpoints against the Firestore emulator, FakeCashfree and a booking-port double."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.core.context import CurrentUser
from app.core.errors import AppError
from app.repositories import payments as payments_repo
from app.repositories import webhook_events as events_repo
from app.services import jobs_service
from app.services.payment_service import PaymentService
from app.tests_support.fake_cashfree import FakeCashfreeClient, signed_webhook
from tests.payments.conftest import FakeBookingPort, new_customer

pytestmark = pytest.mark.emulator


def key() -> str:
    return "idem-" + secrets.token_hex(8)


def now() -> datetime:
    return datetime.now(UTC)


async def _order(
    service: PaymentService, bookings: FakeBookingPort, customer: CurrentUser, **kw: object
) -> tuple[str, str]:
    bid = await bookings.create(customer, **kw)  # type: ignore[arg-type]
    res = await service.create_order(customer, bid, key(), now=now())
    return bid, res.response.payment_id


# ── create order ────────────────────────────────────────────────────────────────────────────


async def test_create_order_happy_path(
    service: PaymentService, bookings: FakeBookingPort, customer: CurrentUser, fake_cf: FakeCashfreeClient
) -> None:
    bid = await bookings.create(customer, amount_rupees=1234)
    k = key()
    res = await service.create_order(customer, bid, k, now=now())
    r = res.response
    assert res.created and not r.reused
    assert r.amount_rupees == 1234 and r.provider == "cashfree" and not r.test_payment
    assert r.checkout.kind == "cashfree" and r.checkout.mode == "sandbox"
    assert r.checkout.payment_session_id == f"session_{r.payment_id}"
    sent = fake_cf.orders[r.payment_id].req
    assert sent.amount_paise == 123400 and sent.customer_phone == "+919876500001"
    assert sent.notify_url.endswith("/api/v1/payments/cashfree/webhook")
    assert sent.return_url.endswith(f"/customer/payment/return?paymentId={r.payment_id}")
    assert sent.expires_at_iso.endswith("+05:30")
    p = await payments_repo.get(r.payment_id)
    assert p is not None and p.status == "pending" and p.booking_id == bid
    b = await bookings.get(bid)
    assert b["paymentStatus"] == "processing" and b["paymentId"] == r.payment_id

    # Same Idempotency-Key → same payment, no second Cashfree order.
    again = await service.create_order(customer, bid, k, now=now())
    assert again.response.payment_id == r.payment_id and again.response.reused and not again.created
    # New key while the order is open → reused as well.
    third = await service.create_order(customer, bid, key(), now=now())
    assert third.response.payment_id == r.payment_id and third.response.reused
    assert [c for c in fake_cf.calls if c[0] == "create_order"] == [("create_order", r.payment_id)]


async def test_idempotency_key_reuse_for_another_booking(
    service: PaymentService, bookings: FakeBookingPort, customer: CurrentUser
) -> None:
    k = key()
    await service.create_order(customer, await bookings.create(customer), k, now=now())
    with pytest.raises(AppError) as exc:
        await service.create_order(customer, await bookings.create(customer), k, now=now())
    assert exc.value.code == "idempotency_key_reused"


async def test_create_order_guards(service: PaymentService, bookings: FakeBookingPort, customer: CurrentUser) -> None:
    other = new_customer()
    bid = await bookings.create(other)
    with pytest.raises(AppError) as exc:
        await service.create_order(customer, bid, key(), now=now())
    assert exc.value.code == "not_found"
    pending = await bookings.create(customer, approval="pending", payment_status="not_due")
    with pytest.raises(AppError) as exc:
        await service.create_order(customer, pending, key(), now=now())
    assert exc.value.code == "invalid_transition"
    paid = await bookings.create(customer, payment_status="paid")
    with pytest.raises(AppError) as exc:
        await service.create_order(customer, paid, key(), now=now())
    assert exc.value.code == "already_paid"


async def test_window_closed_expires_booking(
    service: PaymentService, bookings: FakeBookingPort, customer: CurrentUser
) -> None:
    bid = await bookings.create(customer, due_in=timedelta(minutes=-1))
    await bookings.patch(bid, capacityFree=False)
    with pytest.raises(AppError) as exc:
        await service.create_order(customer, bid, key(), now=now())
    assert exc.value.code == "payment_window_closed" and exc.value.status == 410
    assert (await bookings.get(bid))["paymentStatus"] == "expired"


async def test_gateway_failure_marks_payment_failed(
    service: PaymentService, bookings: FakeBookingPort, customer: CurrentUser, fake_cf: FakeCashfreeClient
) -> None:
    from app.integrations.cashfree.errors import CashfreeError

    bid = await bookings.create(customer)
    fake_cf.fail_next = CashfreeError(http_status=500)
    with pytest.raises(AppError) as exc:
        await service.create_order(customer, bid, key(), now=now())
    assert exc.value.code == "gateway_error" and exc.value.status == 502
    b = await bookings.get(bid)
    p = await payments_repo.get(b["paymentId"])
    assert p is not None and (p.status, p.failure_reason) == ("failed", "gateway_error")
    assert b["paymentStatus"] == "failed"
    # Retry works and supersedes nothing open.
    res = await service.create_order(customer, bid, key(), now=now())
    assert res.created and res.response.payment_id != p.id


# ── confirmation via webhook / verify ───────────────────────────────────────────────────────


async def test_signed_webhook_confirms_after_api_recheck_and_replay_is_idempotent(
    http: httpx.AsyncClient,
    service: PaymentService,
    bookings: FakeBookingPort,
    customer: CurrentUser,
    fake_cf: FakeCashfreeClient,
) -> None:
    bid, pid = await _order(service, bookings, customer)
    payment = fake_cf.mark_paid(pid)
    body, headers = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", pid, payment=payment, amount_rupees=1234)

    r = await http.post("/api/v1/payments/cashfree/webhook", content=body, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "outcome": "applied"}
    assert ("get_order", pid) in fake_cf.calls  # the webhook only triggered an API re-check
    p = await payments_repo.get(pid)
    assert p is not None and p.status == "succeeded" and p.confirmation is not None
    assert p.confirmation.source == "webhook" and p.method_label == "UPI" and p.paid_at is not None
    b = await bookings.get(bid)
    assert b["paymentStatus"] == "paid" and b["reservationStatus"] == "committed"

    replay = await http.post("/api/v1/payments/cashfree/webhook", content=body, headers=headers)
    assert replay.status_code == 200 and replay.json()["outcome"] == "duplicate"
    assert bookings.calls.count(("apply_paid", bid, pid)) == 1
    ev = await events_repo.get(f"PAYMENT_SUCCESS_WEBHOOK:{pid}:{payment.cf_payment_id}:SUCCESS")
    assert ev is not None and ev.outcome == "applied" and "customer_details" not in ev.payload["data"]  # type: ignore[operator]


async def test_webhook_without_paid_order_does_not_confirm(
    http: httpx.AsyncClient,
    service: PaymentService,
    bookings: FakeBookingPort,
    customer: CurrentUser,
    fake_cf: FakeCashfreeClient,
) -> None:
    """A forged-but-signed success (e.g. leaked secret replay) is ignored when the API says ACTIVE."""
    from app.integrations.cashfree.models import CfPayment

    bid, pid = await _order(service, bookings, customer)
    fake = CfPayment(cf_payment_id=999, payment_status="SUCCESS", payment_amount=1234)
    body, headers = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", pid, payment=fake, amount_rupees=1234)
    r = await http.post("/api/v1/payments/cashfree/webhook", content=body, headers=headers)
    assert r.status_code == 200 and r.json()["outcome"] == "ignored"
    assert (await payments_repo.get(pid)).status == "pending"  # type: ignore[union-attr]
    assert (await bookings.get(bid))["paymentStatus"] == "processing"


async def test_unsigned_tampered_and_stale_webhooks_are_rejected(
    http: httpx.AsyncClient,
    service: PaymentService,
    bookings: FakeBookingPort,
    customer: CurrentUser,
    fake_cf: FakeCashfreeClient,
) -> None:
    _, pid = await _order(service, bookings, customer)
    payment = fake_cf.mark_paid(pid)
    body, headers = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", pid, payment=payment)

    r = await http.post("/api/v1/payments/cashfree/webhook", content=body, headers={"content-type": "application/json"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_signature"
    r = await http.post("/api/v1/payments/cashfree/webhook", content=body + b" ", headers=headers)
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_signature"
    old = str(int((now() - timedelta(minutes=10)).timestamp() * 1000))
    body2, headers2 = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", pid, payment=payment, timestamp=old)
    r = await http.post("/api/v1/payments/cashfree/webhook", content=body2, headers=headers2)
    assert r.status_code == 401 and r.json()["error"]["code"] == "stale_timestamp"
    assert (await payments_repo.get(pid)).status == "pending"  # type: ignore[union-attr]


async def test_webhook_not_configured_is_501(dev_service: PaymentService, customer: CurrentUser) -> None:
    from app.services.payment_service import get_payment_service
    from tests.support.app import build_app, client_for

    app = build_app()
    app.dependency_overrides[get_payment_service] = lambda: dev_service
    body, headers = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", "pay_aaaaaaaaaaaaaaaaaaaa")
    async with client_for(app) as c:
        r = await c.post("/api/v1/payments/cashfree/webhook", content=body, headers=headers)
    assert r.status_code == 501 and r.json()["error"]["code"] == "webhook_not_configured"


async def test_payments_not_configured_is_501(emulator: None, bookings: FakeBookingPort, customer: CurrentUser) -> None:
    from app.integrations.cashfree.gateway import GatewayRegistry
    from tests.payments.conftest import cashfree_settings

    svc = PaymentService(GatewayRegistry(cashfree_settings(CASHFREE_APP_ID=None)), bookings)  # type: ignore[arg-type]
    with pytest.raises(AppError) as exc:
        await svc.create_order(customer, await bookings.create(customer), key(), now=now())
    assert exc.value.code == "payments_not_configured" and exc.value.status == 501


async def test_unknown_event_type_is_acknowledged(http: httpx.AsyncClient) -> None:
    from app.integrations.cashfree.webhook import compute_signature
    from app.tests_support.fake_cashfree import TEST_SECRET

    body = b'{"type":"SETTLEMENT_WEBHOOK","data":{}}'
    ts = str(int(now().timestamp() * 1000))
    r = await http.post(
        "/api/v1/payments/cashfree/webhook",
        content=body,
        headers={"x-webhook-timestamp": ts, "x-webhook-signature": compute_signature(TEST_SECRET, ts, body)},
    )
    assert r.status_code == 200 and r.json()["outcome"] == "ignored"


async def test_verify_endpoint_confirms_and_reports_failures(
    http: httpx.AsyncClient,
    service: PaymentService,
    bookings: FakeBookingPort,
    customer: CurrentUser,
    fake_cf: FakeCashfreeClient,
) -> None:
    bid, pid = await _order(service, bookings, customer)
    r = await http.post(f"/api/v1/payments/{pid}/verify")
    assert r.status_code == 200 and r.json()["status"] == "pending"
    fake_cf.mark_dropped(pid)
    r = await http.post(f"/api/v1/payments/{pid}/verify")
    body = r.json()
    assert body["status"] == "failed" and body["failureReason"] == "user_dropped"
    assert body["bookingState"]["paymentStatus"] == "failed"
    # Retry: new order supersedes nothing (old one failed), then pays.
    res = await service.create_order(customer, bid, key(), now=now())
    pid2 = res.response.payment_id
    fake_cf.mark_paid(pid2, group="credit_card")
    r = await http.post(f"/api/v1/payments/{pid2}/verify")
    body = r.json()
    assert body["status"] == "succeeded" and body["bookingState"]["paymentStatus"] == "paid"
    assert body["methodLabel"] == "Credit Card ••4242" and body["bookingStatus"] == "confirmed"
    r = await http.get(f"/api/v1/payments/{pid2}")
    assert r.status_code == 200 and r.json()["status"] == "succeeded"


async def test_other_customers_payment_is_404(
    http: httpx.AsyncClient, service: PaymentService, bookings: FakeBookingPort
) -> None:
    other = new_customer()
    _, pid = await _order(service, bookings, other)
    assert (await http.get(f"/api/v1/payments/{pid}")).status_code == 404
    assert (await http.post(f"/api/v1/payments/{pid}/verify")).status_code == 404


async def test_amount_mismatch_never_confirms(
    service: PaymentService, bookings: FakeBookingPort, customer: CurrentUser, fake_cf: FakeCashfreeClient
) -> None:
    bid, pid = await _order(service, bookings, customer)
    fake_cf.mark_paid(pid, amount_rupees=1.0)
    await service.verify(customer, pid, now=now())
    p = await payments_repo.get(pid)
    assert p is not None and (p.status, p.failure_reason) == ("failed", "amount_mismatch")
    assert (await bookings.get(bid))["paymentStatus"] == "failed"


# ── late / duplicate payments → refunds ─────────────────────────────────────────────────────


async def test_late_payment_after_booking_closed_is_refunded(
    service: PaymentService, bookings: FakeBookingPort, customer: CurrentUser, fake_cf: FakeCashfreeClient
) -> None:
    bid, pid = await _order(service, bookings, customer)
    await bookings.patch(bid, closure={"kind": "cancelled", "reason": "customer"}, paymentStatus="voided")
    fake_cf.mark_paid(pid)
    _, jobs = await service.verify(customer, pid, now=now())
    p = await payments_repo.get(pid)
    assert p is not None and p.status == "refund_pending" and p.refund is not None
    assert p.refund.reason == "late_payment" and p.refund.refund_id == "rf_" + pid[4:]
    assert len(jobs) == 1
    assert (await jobs_service.run_jobs(jobs, now())) == {jobs[0]: "pending"}  # Cashfree: refund PENDING
    later = now() + timedelta(minutes=2)
    assert await jobs_service.run_job(jobs[0], later) == "succeeded"  # status re-check → SUCCESS
    p = await payments_repo.get(pid)
    assert p is not None and p.status == "refunded" and p.refund is not None and p.refund.status == "succeeded"
    # The refunded payment was the booking's own attempt, so D4 mirrors the refund onto it.
    assert (await bookings.get(bid))["paymentStatus"] == "refunded"


async def test_duplicate_payment_is_refunded(
    service: PaymentService, bookings: FakeBookingPort, customer: CurrentUser, fake_cf: FakeCashfreeClient
) -> None:
    bid, pid1 = await _order(service, bookings, customer)
    fake_cf.mark_dropped(pid1)
    await service.verify(customer, pid1, now=now())
    pid2 = (await service.create_order(customer, bid, key(), now=now())).response.payment_id
    fake_cf.mark_paid(pid2)
    await service.verify(customer, pid2, now=now())
    fake_cf.mark_paid(pid1)  # the "dropped" attempt actually went through later
    _, jobs = await service.verify(customer, pid1, now=now())
    p1 = await payments_repo.get(pid1)
    assert p1 is not None and p1.status == "refund_pending" and p1.refund.reason == "duplicate_payment"  # type: ignore[union-attr]
    assert (await bookings.get(bid))["paymentStatus"] == "paid" and len(jobs) == 1


async def test_refund_webhook_is_applied_once(
    http: httpx.AsyncClient,
    service: PaymentService,
    bookings: FakeBookingPort,
    customer: CurrentUser,
    fake_cf: FakeCashfreeClient,
) -> None:
    bid, pid = await _order(service, bookings, customer)
    await bookings.patch(bid, closure={"kind": "cancelled"}, paymentStatus="voided")
    fake_cf.mark_paid(pid)
    await service.verify(customer, pid, now=now())
    refund_id = "rf_" + pid[4:]
    body, headers = signed_webhook(
        "REFUND_STATUS_WEBHOOK", pid, refund={"refund_id": refund_id, "cf_refund_id": 42, "refund_status": "SUCCESS"}
    )
    r = await http.post("/api/v1/payments/cashfree/webhook", content=body, headers=headers)
    assert r.json()["outcome"] == "applied"
    p = await payments_repo.get(pid)
    assert p is not None and p.status == "refunded" and p.refund.provider_refund_id == "42"  # type: ignore[union-attr]
    r = await http.post("/api/v1/payments/cashfree/webhook", content=body, headers=headers)
    assert r.json()["outcome"] == "duplicate"


async def test_refund_gives_up_after_max_attempts_and_admin_retry(
    service: PaymentService, bookings: FakeBookingPort, customer: CurrentUser, fake_cf: FakeCashfreeClient
) -> None:
    from app.integrations.cashfree.errors import CashfreeError

    bid, pid = await _order(service, bookings, customer)
    await bookings.patch(bid, closure={"kind": "cancelled"}, paymentStatus="voided")
    fake_cf.mark_paid(pid)
    _, jobs = await service.verify(customer, pid, now=now())
    t = now()
    for _ in range(jobs_service.MAX_ATTEMPTS):
        fake_cf.fail_next = CashfreeError(http_status=500)
        status = await jobs_service.run_job(jobs[0], t)
        t += timedelta(hours=2)
    assert status == "failed"
    p = await payments_repo.get(pid)
    assert p is not None and p.status == "refund_failed"
    with pytest.raises(AppError) as exc:
        await service.retry_refund("pay_" + "z" * 20, now=t)
    assert exc.value.code == "not_found"
    p2, new_jobs = await service.retry_refund(pid, now=t)
    assert p2.status == "refund_pending" and p2.refund is not None and p2.refund.refund_id == "rf_" + pid[4:]
    with pytest.raises(AppError) as exc:
        await service.retry_refund(pid, now=t)
    assert exc.value.code == "refund_not_allowed"
    assert await jobs_service.run_job(new_jobs[0], t) in ("pending", "succeeded")


# ── history ─────────────────────────────────────────────────────────────────────────────────


async def test_history_is_newest_first_and_paginated(
    http: httpx.AsyncClient, service: PaymentService, bookings: FakeBookingPort, customer: CurrentUser
) -> None:
    for _ in range(3):
        await _order(service, bookings, customer)
    r = await http.get("/api/v1/payments/history", params={"limit": 2})
    assert r.status_code == 200, r.text
    page = r.json()
    assert len(page["items"]) == 2 and page["nextCursor"]
    assert page["items"][0]["createdAt"] >= page["items"][1]["createdAt"]
    assert page["items"][0]["routeLabel"] == "Coimbatore → Erode"
    r2 = await http.get("/api/v1/payments/history", params={"limit": 2, "cursor": page["nextCursor"]})
    rest = r2.json()
    assert len(rest["items"]) == 1 and rest["nextCursor"] is None
    ids = {i["id"] for i in page["items"]} | {i["id"] for i in rest["items"]}
    assert len(ids) == 3


async def test_create_order_endpoint_requires_idempotency_key(
    http: httpx.AsyncClient, bookings: FakeBookingPort, customer: CurrentUser
) -> None:
    bid = await bookings.create(customer)
    r = await http.post("/api/v1/payments/orders", json={"bookingId": bid})
    assert r.status_code == 400 and r.json()["error"]["code"] == "idempotency_key_required"
    r = await http.post("/api/v1/payments/orders", json={"bookingId": bid}, headers={"Idempotency-Key": key()})
    assert r.status_code == 201, r.text
    assert r.json()["checkout"]["kind"] == "cashfree"
    r2 = await http.post("/api/v1/payments/orders", json={"bookingId": bid}, headers={"Idempotency-Key": key()})
    assert r2.status_code == 200 and r2.json()["reused"] is True
