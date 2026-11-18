"""Payment fixtures: emulator Firestore, FakeCashfree, and a test double of D4's booking port.

The booking double stores a minimal booking in ``testPaymentBookings/{id}`` (not D4's ``bookings``),
reads it inside the payment transaction and writes with partial ``tx.update`` calls, exactly as the
port contract in ``app/services/payment_service.py`` requires.
"""

from __future__ import annotations

import asyncio
import os
import secrets
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import httpx
import pytest
from fastapi import FastAPI
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.core.context import CurrentUser
from app.deps import get_current_user
from app.integrations.cashfree.gateway import CashfreeGateway, DevGateway, GatewayRegistry
from app.integrations.cashfree.settings import PaymentSettings
from app.models.payment import PaymentDoc
from app.repositories.base import doc_ref, doc_to_dict, get_doc
from app.services.payment_service import PayableBooking, PaymentService, get_payment_service, set_payment_service
from app.tests_support.fake_cashfree import TEST_SECRET, FakeCashfreeClient
from tests.support.app import build_app, client_for
from tests.support.emulator import emulators_running

BOOKINGS = "testPaymentBookings"
# A named Firestore database keeps these tests isolated from suites that wipe "(default)".
TEST_DATABASE = "d5-payments"
_EMU: bool | None = None
_clients: dict[int, firestore.AsyncClient] = {}


def _require_emulators() -> None:
    global _EMU
    if _EMU is None:
        _EMU = emulators_running()
    if not _EMU:
        pytest.skip("Firebase emulators are not running")


def _isolated_db() -> firestore.AsyncClient:
    loop_id = id(asyncio.get_running_loop())
    client = _clients.get(loop_id)
    if client is None:
        client = firestore.AsyncClient(
            project=os.environ.get("FIREBASE_PROJECT_ID", "demo-taki"),
            database=TEST_DATABASE,
            credentials=AnonymousCredentials(),
        )
        _clients[loop_id] = client
    return client


@pytest.fixture(autouse=True)
def _use_isolated_database(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.repositories.base as base
    import app.repositories.payments as payments_repo
    import app.services.jobs_service as jobs

    for mod in (base, payments_repo, jobs):
        monkeypatch.setattr(mod, "get_db", _isolated_db)


class FakeBookingPort:
    """D4's ``booking_service`` payment port, minimal and Firestore-backed."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str | None]] = []

    async def create(
        self,
        customer: CurrentUser,
        *,
        amount_rupees: int = 1234,
        due_in: timedelta = timedelta(hours=2),
        payment_status: str = "due",
        approval: str = "accepted",
    ) -> str:
        bid = "TAKI" + "".join(secrets.choice("0123456789") for _ in range(8))
        now = datetime.now(UTC)
        await doc_ref(BOOKINGS, bid).set(
            {
                "id": bid,
                "customerId": customer.uid,
                "agencyId": "agc_test",
                "totalPayable": amount_rupees,
                "approvalStatus": approval,
                "paymentStatus": payment_status,
                "reservationStatus": "held",
                "fulfilmentStatus": "not_started",
                "closure": None,
                "paymentId": None,
                "paymentDueAt": now + due_in,
                "holdDueAt": now + due_in,
                "capacityFree": True,
                "routeLabel": "Coimbatore → Erode",
                "customerName": customer.name,
                "customerPhone": customer.phone,
            }
        )
        return bid

    async def get(self, booking_id: str) -> dict[str, Any]:
        doc = await get_doc(BOOKINGS, booking_id)
        assert doc is not None
        return doc

    async def patch(self, booking_id: str, **fields: Any) -> None:
        await doc_ref(BOOKINGS, booking_id).update(fields)

    async def load_for_payment(
        self, tx: AsyncTransaction | None, booking_id: str, *, now: datetime
    ) -> PayableBooking | None:
        ref = doc_ref(BOOKINGS, booking_id)
        d = doc_to_dict(await ref.get(transaction=tx) if tx is not None else await ref.get())
        if d is None:
            return None
        held = d["reservationStatus"] == "held"
        hold_active = d["reservationStatus"] == "committed" or (held and d["holdDueAt"] > now)
        status = {"paid": "confirmed", "failed": "payment_failed"}.get(d["paymentStatus"], "pending_payment")
        if d["closure"]:
            status = "cancelled"
        return PayableBooking(
            id=d["id"],
            customer_id=d["customerId"],
            agency_id=d["agencyId"],
            amount_paise=d["totalPayable"] * 100,
            approval_status=d["approvalStatus"],
            payment_status=d["paymentStatus"],
            reservation_status=d["reservationStatus"],
            fulfilment_status=d["fulfilmentStatus"],
            closed=bool(d["closure"]),
            payment_id=d["paymentId"],
            payment_due_at=d["paymentDueAt"],
            hold_active=hold_active,
            hold_refittable=held and not hold_active and d["capacityFree"],
            customer_name=d["customerName"],
            customer_phone=d["customerPhone"],
            route_label=d["routeLabel"],
            status=status,
            closure=d["closure"],
        )

    async def start_payment(
        self, tx: AsyncTransaction, booking: PayableBooking, *, payment_id: str, hold_due_at: datetime, now: datetime
    ) -> None:
        self.calls.append(("start_payment", booking.id, payment_id))
        tx.update(
            doc_ref(BOOKINGS, booking.id),
            {"paymentStatus": "processing", "paymentId": payment_id, "holdDueAt": hold_due_at},
        )

    async def apply_payment_result(
        self,
        tx: AsyncTransaction,
        booking: PayableBooking,
        *,
        payment: PaymentDoc,
        result: Literal["paid", "failed", "expired"],
        now: datetime,
    ) -> None:
        self.calls.append((f"apply_{result}", booking.id, payment.id))
        patch: dict[str, Any] = {"paymentStatus": {"paid": "paid", "failed": "failed", "expired": "due"}[result]}
        if result == "paid":
            patch.update({"reservationStatus": "committed", "paymentId": payment.id, "paidAt": now})
        tx.update(doc_ref(BOOKINGS, booking.id), patch)

    async def expire_payment_window(self, tx: AsyncTransaction, booking: PayableBooking, *, now: datetime) -> None:
        self.calls.append(("expire_window", booking.id, None))
        tx.update(doc_ref(BOOKINGS, booking.id), {"paymentStatus": "expired", "reservationStatus": "released"})

    async def apply_refund_result(
        self, tx: AsyncTransaction, booking: PayableBooking, *, payment: PaymentDoc, now: datetime
    ) -> None:
        self.calls.append((f"refund_{payment.status}", booking.id, payment.id))
        if booking.payment_id == payment.id:
            tx.update(doc_ref(BOOKINGS, booking.id), {"paymentStatus": payment.status})


def cashfree_settings(**kw: Any) -> PaymentSettings:
    base: dict[str, Any] = {
        "APP_ENV": "test",
        "PAYMENT_PROVIDER": "cashfree",
        "CASHFREE_APP_ID": "TEST_APP",
        "CASHFREE_SECRET_KEY": TEST_SECRET,
        "CASHFREE_ENV": "sandbox",
        "APP_ORIGIN": "http://localhost:3000",
        "PUBLIC_API_BASE_URL": "http://localhost:8000",
    }
    base.update(kw)
    return PaymentSettings(_env_file=None, **base)  # type: ignore[call-arg]


def new_customer() -> CurrentUser:
    return CurrentUser(uid="cust" + secrets.token_hex(6), role="customer", phone="+919876500001", name="Ravi Kumar")


@pytest.fixture
def emulator() -> None:
    _require_emulators()


@pytest.fixture
def fake_cf() -> FakeCashfreeClient:
    return FakeCashfreeClient()


@pytest.fixture
def bookings() -> FakeBookingPort:
    return FakeBookingPort()


@pytest.fixture
def service(emulator: None, fake_cf: FakeCashfreeClient, bookings: FakeBookingPort) -> AsyncIterator[PaymentService]:
    registry = GatewayRegistry(cashfree_settings(), cashfree=CashfreeGateway(fake_cf, "sandbox"))
    svc = PaymentService(registry, bookings)  # type: ignore[arg-type]
    set_payment_service(svc)
    yield svc  # type: ignore[misc]
    set_payment_service(None)


@pytest.fixture
def dev_service(emulator: None, bookings: FakeBookingPort) -> AsyncIterator[PaymentService]:
    s = cashfree_settings(PAYMENT_PROVIDER="dev", CASHFREE_APP_ID=None, CASHFREE_SECRET_KEY=None)
    svc = PaymentService(GatewayRegistry(s, dev=DevGateway("dev-secret")), bookings)  # type: ignore[arg-type]
    set_payment_service(svc)
    yield svc  # type: ignore[misc]
    set_payment_service(None)


@pytest.fixture
def customer() -> CurrentUser:
    return new_customer()


@pytest.fixture
def api(service: PaymentService, customer: CurrentUser) -> FastAPI:
    app = build_app()
    app.dependency_overrides[get_payment_service] = lambda: service
    app.dependency_overrides[get_current_user] = lambda: customer
    return app


@pytest.fixture
async def http(api: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with client_for(api) as c:
        yield c
