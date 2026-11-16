"""D4 test support (P2 §15.3). Owner: D4.

Every D4 suite runs on the **named** Firestore database ``d4-bookings`` (other suites wipe
``(default)`` between tests). Accounts, vehicles and published trips are built with D3's builders
(``tests/support/builders.py``: D2's document shapes, D3's trip publish API); authentication is the
header-driven ``X-Test-Uid`` override that still runs D2's ``user_from_claims`` checks. Payments use
D5's ``FakeCashfreeClient`` and the real ``PaymentService`` wired to D4's ``booking_service`` port.
Maps is D5's deterministic fake gazetteer (place ids ``fake_<town>``).
"""

from __future__ import annotations

import asyncio
import secrets
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI, Header

from app.core.clock import FrozenClock, get_clock
from app.core.context import CurrentUser
from app.deps import get_current_user, get_optional_user
from app.integrations.cashfree.gateway import CashfreeGateway, GatewayRegistry
from app.integrations.cashfree.settings import PaymentSettings
from app.repositories import base
from app.repositories.base import C, get_doc
from app.services.payment_service import PaymentService, get_payment_service, set_payment_service
from app.tests_support.fake_cashfree import TEST_SECRET, FakeCashfreeClient, signed_webhook
from tests.support.app import build_app, client_for
from tests.support.builders import (
    COIMBATORE,
    ERODE,
    SALEM,
    TIRUPPUR,
    Account,
    _test_user,
    create_trip,
    create_vehicle,
    make_agency,
    make_customer,
    make_driver,
)
from tests.support.emulator import FIRESTORE_URL, PROJECT, emulators_running

TEST_DATABASE = "d4-bookings"
STOPS = [COIMBATORE, TIRUPPUR, ERODE, SALEM]
_EMU: bool | None = None


def require_emulators() -> None:
    global _EMU
    if _EMU is None:
        _EMU = emulators_running()
    if not _EMU:
        pytest.skip("Firebase emulators are not running (firebase emulators:start --project demo-taki)")


async def clear_database() -> None:
    """Wipe ``d4-bookings``. A 409 "Transaction lock timeout" (a transaction left open by an interrupted
    run) clears once the emulator releases the lock, so retry for up to ~60 s."""
    async with httpx.AsyncClient(timeout=10) as c:
        for _ in range(30):
            r = await c.delete(f"{FIRESTORE_URL}/emulator/v1/projects/{PROJECT}/databases/{TEST_DATABASE}/documents")
            if r.status_code != 409:
                r.raise_for_status()
                return
            await asyncio.sleep(2)
        r.raise_for_status()


def cashfree_settings() -> PaymentSettings:
    return PaymentSettings(  # type: ignore[call-arg]
        _env_file=None,
        APP_ENV="test",
        PAYMENT_PROVIDER="cashfree",
        CASHFREE_APP_ID="TEST_APP",
        CASHFREE_SECRET_KEY=TEST_SECRET,
        CASHFREE_ENV="sandbox",
        APP_ORIGIN="http://localhost:3000",
        PUBLIC_API_BASE_URL="http://localhost:8000",
    )


# ── fixtures ──────────────────────────────────────────────────────────────────
@pytest.fixture
async def d4_db() -> AsyncIterator[None]:
    require_emulators()
    base.use_database(TEST_DATABASE)
    await clear_database()
    try:
        yield
    finally:
        await base.close_named_clients()
        base.use_database(None)


@pytest.fixture
def clock() -> FrozenClock:
    return FrozenClock(datetime.now(UTC).replace(microsecond=0))


@pytest.fixture
def fake_cf() -> FakeCashfreeClient:
    return FakeCashfreeClient()


@pytest.fixture
def payments(d4_db: None, fake_cf: FakeCashfreeClient) -> AsyncIterator[PaymentService]:
    svc = PaymentService(GatewayRegistry(cashfree_settings(), cashfree=CashfreeGateway(fake_cf, "sandbox")))
    set_payment_service(svc)
    yield svc  # type: ignore[misc]
    set_payment_service(None)


async def _optional_user(x_test_uid: str | None = Header(default=None)) -> CurrentUser | None:
    if not x_test_uid:
        return None
    return await _test_user(x_test_uid)


@pytest.fixture
def d4_app(d4_db: None, clock: FrozenClock, payments: PaymentService) -> FastAPI:
    app = build_app()
    app.dependency_overrides[get_current_user] = _test_user
    app.dependency_overrides[get_optional_user] = _optional_user
    app.dependency_overrides[get_clock] = lambda: clock
    app.dependency_overrides[get_payment_service] = lambda: payments
    return app


@pytest.fixture
async def http(d4_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with client_for(d4_app) as c:
        yield c


# ── world ─────────────────────────────────────────────────────────────────────
@dataclass
class World:
    agency: Account
    driver: Account
    vehicle: dict[str, Any]
    trip: dict[str, Any]
    customer: Account
    start: datetime


async def make_world(
    http: httpx.AsyncClient,
    clock: FrozenClock,
    *,
    stops: list[str] | None = None,
    offered_kg: int = 1000,
    lead: timedelta = timedelta(hours=3),
    **trip_kw: Any,
) -> World:
    agency = await make_agency()
    driver = await make_driver(agency, name="Selvam Driver")
    vehicle = await create_vehicle(http, agency)
    start = (clock.now() + lead).replace(second=0, microsecond=0)
    trip = await create_trip(
        http, agency, vehicle["id"], driver.uid, stops=stops or STOPS, start=start, offered_kg=offered_kg, **trip_kw
    )
    assert trip["status"] == "published", trip
    customer = await make_customer()
    return World(agency, driver, vehicle, trip, customer, start)


def address(place_id: str, state: str = "TN", line1: str = "12 Market Road") -> dict[str, Any]:
    return {"line1": line1, "pincode": "641001", "state": state, "source": "autocomplete", "placeId": place_id}


def shipment_body(src: str, dst: str, *, day: str, weight: int = 500, **pkg: Any) -> dict[str, Any]:
    package = {
        "weightKg": weight,
        "goodsCategory": "general_goods",
        "packageType": "box",
        "description": "Cotton bales",
        "pieces": 4,
        "specialHandling": [],
        "declaredValueRupees": 25000,
        "prohibitedItemsDeclaration": True,
    }
    package.update(pkg)
    return {
        "source": address(src),
        "destination": address(dst),
        "receiver": {"name": "Meena Devi", "phone": "98765 43210"},
        "package": package,
        "shippingDate": day,
    }


def ist_day(dt: datetime) -> str:
    return (dt + timedelta(hours=5, minutes=30)).date().isoformat()


async def create_shipment(http: httpx.AsyncClient, w: World, src: str, dst: str, **kw: Any) -> dict[str, Any]:
    r = await http.post(
        "/api/v1/customer/shipments",
        json=shipment_body(src, dst, day=ist_day(w.start), **kw),
        headers=w.customer.headers,
    )
    assert r.status_code == 201, r.text
    return dict(r.json())


def idem() -> dict[str, str]:
    return {"Idempotency-Key": "idem-" + secrets.token_hex(8)}


async def request(
    http: httpx.AsyncClient, w: World, shipment_id: str, customer: Account | None = None, trip_id: str | None = None
) -> httpx.Response:
    who = customer or w.customer
    return await http.post(
        "/api/v1/customer/bookings",
        json={"shipmentId": shipment_id, "tripId": trip_id or w.trip["id"]},
        headers={**who.headers, **idem()},
    )


async def book(http: httpx.AsyncClient, w: World, src: str = COIMBATORE, dst: str = SALEM, **kw: Any) -> str:
    s = await create_shipment(http, w, src, dst, **kw)
    r = await request(http, w, s["id"])
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def accept(http: httpx.AsyncClient, w: World, booking_id: str) -> httpx.Response:
    return await http.post(f"/api/v1/agency/bookings/{booking_id}/accept", headers=w.agency.headers)


async def pay(
    http: httpx.AsyncClient, w: World, booking_id: str, fake_cf: FakeCashfreeClient, clock: FrozenClock
) -> str:
    """Create a Cashfree order, mark it PAID at the (fake) gateway and deliver the signed webhook."""
    r = await http.post(
        "/api/v1/payments/orders", json={"bookingId": booking_id}, headers={**w.customer.headers, **idem()}
    )
    assert r.status_code == 201, r.text
    pid = str(r.json()["paymentId"])
    payment = fake_cf.mark_paid(pid)
    total = r.json()["amountRupees"]
    ts = str(int(clock.now().timestamp() * 1000))
    body, headers = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", pid, payment=payment, amount_rupees=total, timestamp=ts)
    r = await http.post("/api/v1/payments/cashfree/webhook", content=body, headers=headers)
    assert r.status_code == 200 and r.json()["outcome"] == "applied", r.text
    return pid


async def booking_doc(booking_id: str) -> dict[str, Any]:
    d = await get_doc(C.bookings, booking_id)
    assert d is not None
    return d


async def trip_doc(trip_id: str) -> dict[str, Any]:
    d = await get_doc(C.trips, trip_id)
    assert d is not None
    return d


async def customer_view(http: httpx.AsyncClient, w: World, booking_id: str) -> dict[str, Any]:
    r = await http.get(f"/api/v1/customer/bookings/{booking_id}", headers=w.customer.headers)
    assert r.status_code == 200, r.text
    return dict(r.json())


__all__ = [
    "COIMBATORE",
    "ERODE",
    "SALEM",
    "STOPS",
    "TEST_DATABASE",
    "TIRUPPUR",
    "World",
    "accept",
    "book",
    "booking_doc",
    "clock",
    "create_shipment",
    "customer_view",
    "d4_app",
    "d4_db",
    "fake_cf",
    "http",
    "idem",
    "ist_day",
    "make_customer",
    "make_driver",
    "make_world",
    "pay",
    "payments",
    "request",
    "shipment_body",
    "trip_doc",
]
