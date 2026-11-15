"""The dev TEST gateway (owner decision: local/e2e only) goes through the same confirm path."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime

import pytest

from app.core.context import CurrentUser
from app.core.errors import AppError
from app.integrations.cashfree.gateway import CashfreeGateway, GatewayRegistry
from app.repositories import payments as payments_repo
from app.services.payment_service import PaymentService
from app.tests_support.fake_cashfree import FakeCashfreeClient
from tests.payments.conftest import FakeBookingPort, cashfree_settings

pytestmark = pytest.mark.emulator


def now() -> datetime:
    return datetime.now(UTC)


async def test_dev_checkout_is_labelled_and_needs_explicit_approval(
    dev_service: PaymentService, bookings: FakeBookingPort, customer: CurrentUser
) -> None:
    bid = await bookings.create(customer)
    res = await dev_service.create_order(customer, bid, "idem-" + secrets.token_hex(6), now=now())
    r = res.response
    assert r.provider == "dev" and r.test_payment
    assert r.checkout.kind == "dev" and r.checkout.label == "Test payment"
    # Verify never confirms a dev payment on its own.
    status, _ = await dev_service.verify(customer, r.payment_id, now=now())
    assert status.status == "pending" and status.test_payment
    with pytest.raises(AppError) as exc:
        await dev_service.dev_confirm(customer, r.payment_id, "success", "0" * 40, now=now())
    assert exc.value.code == "forbidden"
    status, _ = await dev_service.dev_confirm(customer, r.payment_id, "success", r.checkout.dev_token, now=now())
    assert status.status == "succeeded" and status.method_label == "Test payment"
    p = await payments_repo.get(r.payment_id)
    assert p is not None and p.confirmation is not None and p.confirmation.source == "dev_confirm"
    assert (await bookings.get(bid))["paymentStatus"] == "paid"


async def test_dev_confirm_is_404_when_dev_gateway_disabled(
    emulator: None, bookings: FakeBookingPort, customer: CurrentUser
) -> None:
    svc = PaymentService(
        GatewayRegistry(cashfree_settings(), cashfree=CashfreeGateway(FakeCashfreeClient(), "sandbox")),
        bookings,  # type: ignore[arg-type]
    )
    with pytest.raises(AppError) as exc:
        await svc.dev_confirm(customer, "pay_" + "a" * 20, "success", "x" * 40, now=now())
    assert exc.value.code == "not_found"


async def test_dev_provider_in_staging_is_not_configured(
    emulator: None, bookings: FakeBookingPort, customer: CurrentUser
) -> None:
    svc = PaymentService(GatewayRegistry(cashfree_settings(APP_ENV="staging", PAYMENT_PROVIDER="dev")), bookings)  # type: ignore[arg-type]
    with pytest.raises(AppError) as exc:
        await svc.create_order(customer, await bookings.create(customer), "idem-abcdefgh", now=now())
    assert exc.value.code == "payments_not_configured"
