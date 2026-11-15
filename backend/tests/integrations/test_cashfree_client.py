"""Cashfree HTTP client and gateway mapping against respx mocks (no network, no real keys)."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from app.core.errors import AppError
from app.integrations.cashfree import client as client_mod
from app.integrations.cashfree.client import HttpCashfreeClient
from app.integrations.cashfree.gateway import CashfreeGateway, DevGateway, GatewayRegistry
from app.integrations.cashfree.models import CreateOrderRequest
from app.integrations.cashfree.settings import PaymentSettings, check_payment_startup

BASE = "https://sandbox.cashfree.com/pg"


@pytest.fixture(autouse=True)
def _no_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(client_mod, "GET_RETRY_BACKOFF_SECONDS", 0)


def _client() -> HttpCashfreeClient:
    return HttpCashfreeClient(app_id="TEST_APP", secret_key="TEST_SECRET", base_url=BASE, api_version="2025-01-01")


def _req(order_id: str = "pay_aaaaaaaaaaaaaaaaaaaa") -> CreateOrderRequest:
    return CreateOrderRequest(
        order_id=order_id,
        amount_paise=123450,
        customer_id="uid123",
        customer_phone="+919876543210",
        customer_name="Ravi Kumar",
        return_url="https://www.example.test/customer/payment/return?paymentId=" + order_id,
        notify_url="https://api.example.test/api/v1/payments/cashfree/webhook",
        expires_at_iso="2026-11-16T10:30:00+05:30",
        tags={"bookingId": "TAKI12345678"},
    )


@respx.mock
async def test_create_order_request_shape() -> None:
    route = respx.post(f"{BASE}/orders").mock(
        return_value=httpx.Response(
            200,
            json={
                "order_id": "pay_aaaaaaaaaaaaaaaaaaaa",
                "order_status": "ACTIVE",
                "payment_session_id": "session_abc",
                "order_amount": 1234.5,
            },
        )
    )
    order = await _client().create_order(_req(), request_id="req-1")
    assert order.payment_session_id == "session_abc"
    sent = route.calls.last.request
    assert sent.headers["x-client-id"] == "TEST_APP"
    assert sent.headers["x-client-secret"] == "TEST_SECRET"
    assert sent.headers["x-api-version"] == "2025-01-01"
    assert sent.headers["x-request-id"] == "req-1"
    assert sent.headers["x-idempotency-key"] == "pay_aaaaaaaaaaaaaaaaaaaa"
    body = json.loads(sent.content)
    assert body == {
        "order_id": "pay_aaaaaaaaaaaaaaaaaaaa",
        "order_amount": 1234.5,
        "order_currency": "INR",
        "customer_details": {"customer_id": "uid123", "customer_phone": "9876543210", "customer_name": "Ravi Kumar"},
        "order_meta": {
            "return_url": "https://www.example.test/customer/payment/return?paymentId=pay_aaaaaaaaaaaaaaaaaaaa",
            "notify_url": "https://api.example.test/api/v1/payments/cashfree/webhook",
        },
        "order_expiry_time": "2026-11-16T10:30:00+05:30",
        "order_tags": {"bookingId": "TAKI12345678"},
    }


@respx.mock
async def test_post_is_not_retried_and_maps_to_gateway_error() -> None:
    route = respx.post(f"{BASE}/orders").mock(return_value=httpx.Response(503, json={"code": "upstream"}))
    with pytest.raises(AppError) as exc:
        await _client().create_order(_req())
    assert exc.value.code == "gateway_error" and exc.value.status == 502
    assert route.call_count == 1


@respx.mock
async def test_get_retries_on_5xx_then_succeeds() -> None:
    route = respx.get(f"{BASE}/orders/pay_x").mock(
        side_effect=[
            httpx.Response(500),
            httpx.ConnectError("boom"),
            httpx.Response(200, json={"order_id": "pay_x", "order_status": "ACTIVE"}),
        ]
    )
    order = await _client().get_order("pay_x")
    assert order.order_status == "ACTIVE" and route.call_count == 3


@respx.mock
async def test_get_4xx_is_final() -> None:
    route = respx.get(f"{BASE}/orders/pay_x").mock(return_value=httpx.Response(404, json={"code": "order_not_found"}))
    with pytest.raises(AppError) as exc:
        await _client().get_order("pay_x")
    assert getattr(exc.value, "http_status", None) == 404 and route.call_count == 1


@respx.mock
async def test_timeout_maps_to_gateway_error() -> None:
    respx.get(f"{BASE}/orders/pay_x").mock(side_effect=httpx.ReadTimeout("slow"))
    with pytest.raises(AppError) as exc:
        await _client().get_order("pay_x")
    assert exc.value.code == "gateway_error" and getattr(exc.value, "timeout", False)


@respx.mock
async def test_create_order_conflict_continues_with_existing_order() -> None:
    respx.post(f"{BASE}/orders").mock(return_value=httpx.Response(409, json={"code": "order_already_exists"}))
    respx.get(f"{BASE}/orders/pay_aaaaaaaaaaaaaaaaaaaa").mock(
        return_value=httpx.Response(
            200,
            json={
                "order_id": "pay_aaaaaaaaaaaaaaaaaaaa",
                "order_status": "ACTIVE",
                "payment_session_id": "session_existing",
            },
        )
    )
    created = await CashfreeGateway(_client(), "sandbox").create_order(_req())
    assert created.checkout == {
        "kind": "cashfree",
        "mode": "sandbox",
        "paymentSessionId": "session_existing",
        "orderId": "pay_aaaaaaaaaaaaaaaaaaaa",
    }


@respx.mock
async def test_order_status_mapping() -> None:
    gw = CashfreeGateway(_client(), "sandbox")
    respx.get(f"{BASE}/orders/pay_paid").mock(
        return_value=httpx.Response(200, json={"order_id": "pay_paid", "order_status": "PAID", "order_amount": 100})
    )
    respx.get(f"{BASE}/orders/pay_paid/payments").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "cf_payment_id": 1,
                    "payment_status": "FAILED",
                    "payment_amount": 100,
                    "payment_time": "2026-11-16T10:00",
                },
                {
                    "cf_payment_id": 2,
                    "payment_status": "SUCCESS",
                    "payment_amount": 100,
                    "payment_group": "upi",
                    "payment_time": "2026-11-16T10:01",
                },
            ],
        )
    )
    s = await gw.fetch_order_status("pay_paid")
    assert (s.status, s.amount_paise, s.provider_payment_id, s.method_label) == ("paid", 10000, "2", "UPI")

    respx.get(f"{BASE}/orders/pay_drop").mock(
        return_value=httpx.Response(200, json={"order_id": "pay_drop", "order_status": "ACTIVE", "order_amount": 1})
    )
    respx.get(f"{BASE}/orders/pay_drop/payments").mock(
        return_value=httpx.Response(
            200, json=[{"cf_payment_id": 9, "payment_status": "USER_DROPPED", "payment_time": "2026-11-16T10:00"}]
        )
    )
    s = await gw.fetch_order_status("pay_drop")
    assert (s.status, s.failure_reason) == ("failed", "user_dropped")

    respx.get(f"{BASE}/orders/pay_open").mock(
        return_value=httpx.Response(200, json={"order_id": "pay_open", "order_status": "ACTIVE"})
    )
    respx.get(f"{BASE}/orders/pay_open/payments").mock(return_value=httpx.Response(200, json=[]))
    assert (await gw.fetch_order_status("pay_open")).status == "pending"

    respx.get(f"{BASE}/orders/pay_exp").mock(
        return_value=httpx.Response(200, json={"order_id": "pay_exp", "order_status": "EXPIRED"})
    )
    assert (await gw.fetch_order_status("pay_exp")).status == "expired"


@respx.mock
async def test_paid_order_without_success_payment_is_not_confirmed() -> None:
    gw = CashfreeGateway(_client(), "sandbox")
    respx.get(f"{BASE}/orders/pay_q").mock(
        return_value=httpx.Response(200, json={"order_id": "pay_q", "order_status": "PAID"})
    )
    respx.get(f"{BASE}/orders/pay_q/payments").mock(return_value=httpx.Response(200, json=[]))
    assert (await gw.fetch_order_status("pay_q")).status == "pending"


@respx.mock
async def test_refund_request_and_conflict_dedupe() -> None:
    gw = CashfreeGateway(_client(), "sandbox")
    route = respx.post(f"{BASE}/orders/pay_r/refunds").mock(
        return_value=httpx.Response(200, json={"refund_id": "rf_r", "cf_refund_id": 5, "refund_status": "PENDING"})
    )
    r = await gw.refund("pay_r", refund_id="rf_r", amount_paise=5000, reason="late_payment")
    assert r.status == "pending" and r.provider_refund_id == "5"
    assert json.loads(route.calls.last.request.content) == {
        "refund_amount": 50.0,
        "refund_id": "rf_r",
        "refund_note": "late_payment",
    }
    route.mock(return_value=httpx.Response(409, json={"code": "refund_already_exists"}))
    respx.get(f"{BASE}/orders/pay_r/refunds/rf_r").mock(
        return_value=httpx.Response(200, json={"refund_id": "rf_r", "refund_status": "SUCCESS"})
    )
    assert (await gw.refund("pay_r", refund_id="rf_r", amount_paise=5000, reason="x")).status == "succeeded"


# ── configuration / provider selection ──────────────────────────────────────────────────────


def _settings(**kw: object) -> PaymentSettings:
    return PaymentSettings(_env_file=None, **kw)  # type: ignore[call-arg]


def test_not_configured_reports_501() -> None:
    reg = GatewayRegistry(_settings(APP_ENV="production", PAYMENT_PROVIDER="cashfree"))
    assert not reg.configured
    with pytest.raises(AppError) as exc:
        reg.current()
    assert exc.value.code == "payments_not_configured" and exc.value.status == 501
    assert reg.webhook_secret() is None


def test_blank_credentials_count_as_unset() -> None:
    s = _settings(CASHFREE_APP_ID="", CASHFREE_SECRET_KEY=" ", CASHFREE_ENV="sandbox")
    assert not s.cashfree_configured


def test_configured_cashfree() -> None:
    reg = GatewayRegistry(_settings(CASHFREE_APP_ID="a", CASHFREE_SECRET_KEY="b", CASHFREE_ENV="production"))
    gw = reg.current()
    assert gw.provider == "cashfree" and gw.env == "production"
    assert reg.webhook_secret() == "b"


@pytest.mark.parametrize("env", ["staging", "production"])
def test_dev_provider_refused_outside_dev_and_test(env: str) -> None:
    s = _settings(APP_ENV=env, PAYMENT_PROVIDER="dev")
    with pytest.raises(RuntimeError):
        check_payment_startup(s)
    reg = GatewayRegistry(s, dev=DevGateway("x"))  # even an injected dev gateway is dropped
    assert reg.dev is None
    with pytest.raises(AppError) as exc:
        reg.current()
    assert exc.value.code == "payments_not_configured"


@pytest.mark.parametrize("env", ["development", "test", "local"])
def test_dev_provider_allowed_in_dev_and_test(env: str) -> None:
    s = _settings(APP_ENV=env, PAYMENT_PROVIDER="dev")
    warnings = check_payment_startup(s)
    assert any("TEST payment" in w for w in warnings)
    gw = GatewayRegistry(s).current()
    assert gw.provider == "dev"
    checkout = gw.checkout_for("pay_zzzzzzzzzzzzzzzzzzzz", None)
    assert checkout["kind"] == "dev" and checkout["label"] == "Test payment" and checkout["mode"] == "test"


def test_production_requires_cashfree_and_https() -> None:
    with pytest.raises(RuntimeError):
        check_payment_startup(_settings(APP_ENV="production", APP_ORIGIN="http://x", PUBLIC_API_BASE_URL="http://y"))
    check_payment_startup(_settings(APP_ENV="production", APP_ORIGIN="https://x", PUBLIC_API_BASE_URL="https://y"))


def test_dev_token_is_per_payment_and_constant_time_checked() -> None:
    dev = DevGateway("secret")
    t = dev.token_for("pay_1")
    assert dev.token_matches("pay_1", t)
    assert not dev.token_matches("pay_2", t)
    assert not dev.token_matches("pay_1", "")
