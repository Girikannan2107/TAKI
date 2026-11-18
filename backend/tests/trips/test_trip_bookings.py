"""Trip commands with real bookings (D4 booking_service hooks), on the ``d3-data`` database:
cancel cascade + refunds, reassign fan-out, unpublish / structural edits refused, trip detail lists."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi import FastAPI

from app.core.clock import FrozenClock, get_clock
from app.deps import get_optional_user
from app.domain import capacity
from app.integrations.cashfree.gateway import CashfreeGateway, GatewayRegistry
from app.services.payment_service import PaymentService, get_payment_service, set_payment_service
from app.tests_support.fake_cashfree import FakeCashfreeClient
from tests.bookings.support import World, accept, book, booking_doc, cashfree_settings, make_world, pay, trip_doc
from tests.support.app import client_for
from tests.support.builders import _test_user, make_driver, trip_body

T = "/api/v1/agency/trips"


@pytest.fixture
def clock() -> FrozenClock:
    return FrozenClock(datetime.now(UTC).replace(microsecond=0))


@pytest.fixture
def fake_cf() -> FakeCashfreeClient:
    return FakeCashfreeClient()


@pytest.fixture
def payments(d3_db: None, fake_cf: FakeCashfreeClient) -> AsyncIterator[PaymentService]:
    svc = PaymentService(GatewayRegistry(cashfree_settings(), cashfree=CashfreeGateway(fake_cf, "sandbox")))
    set_payment_service(svc)
    yield svc  # type: ignore[misc]
    set_payment_service(None)


@pytest.fixture
async def http(d3_app: FastAPI, clock: FrozenClock, payments: PaymentService) -> AsyncIterator[httpx.AsyncClient]:
    async def _optional(x_test_uid: str | None = None) -> object:
        return await _test_user(x_test_uid) if x_test_uid else None

    d3_app.dependency_overrides[get_optional_user] = _optional
    d3_app.dependency_overrides[get_clock] = lambda: clock
    d3_app.dependency_overrides[get_payment_service] = lambda: payments
    async with client_for(d3_app) as c:
        yield c


async def _world(http: httpx.AsyncClient, clock: FrozenClock) -> World:
    return await make_world(http, clock, lead=timedelta(hours=6))


async def test_trip_detail_lists_bookings_and_leg_loads(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await _world(http, clock)
    b1 = await book(http, w)  # Coimbatore → Salem (legs 0..2)
    assert (await accept(http, w, b1)).status_code == 200
    r = await http.get(f"{T}/{w.trip['id']}", headers=w.agency.headers)
    assert r.status_code == 200, r.text
    t = r.json()
    assert [b["id"] for b in t["bookings"]] == [b1]
    assert t["counts"]["held"] == 1
    assert [leg["loadKg"] for leg in t["legs"]] == [500, 500, 500]
    assert t["capacity"]["reservedKg"] == 500 and t["capacity"]["availableKg"] == 500


async def test_unpublish_and_structural_edits_refused_with_bookings(
    http: httpx.AsyncClient, clock: FrozenClock
) -> None:
    w = await _world(http, clock)
    await book(http, w)  # awaiting agency
    r = await http.post(f"{T}/{w.trip['id']}/unpublish", headers=w.agency.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "trip_has_bookings"
    later = trip_body(w.vehicle["id"], w.driver.uid, start=w.start + timedelta(hours=2))["checkpoints"]
    r = await http.patch(f"{T}/{w.trip['id']}", json={"checkpoints": later}, headers=w.agency.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "trip_has_bookings"
    r = await http.patch(f"{T}/{w.trip['id']}", json={"ratePerKmPaise": 1300}, headers=w.agency.headers)
    assert r.status_code == 200 and r.json()["rates"]["perKmPaise"] == 1300  # safe field


async def test_cancel_cascades_to_bookings_and_refunds(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    w = await _world(http, clock)
    pending = await book(http, w)
    held = await book(http, w, weight=200)
    paid = await book(http, w, weight=100)
    for b in (held, paid):
        assert (await accept(http, w, b)).status_code == 200
    await pay(http, w, paid, fake_cf, clock)
    assert (await trip_doc(w.trip["id"]))["holds"][paid]["state"] == "committed"

    r = await http.post(f"{T}/{w.trip['id']}/cancel", json={"reason": "Vehicle breakdown"}, headers=w.agency.headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"
    t = await trip_doc(w.trip["id"])
    assert t["holds"] == {} and t["searchKeys"] == []
    assert capacity.max_leg_load(t, clock.now()) == 0
    assert (await booking_doc(pending))["approvalStatus"] == "withdrawn"
    hb = await booking_doc(held)
    assert hb["reservationStatus"] == "released" and hb["closure"]["reason"] == "trip_cancelled"
    pb = await booking_doc(paid)
    assert pb["reservationStatus"] == "released" and pb["paymentStatus"] in ("refund_pending", "refunded")


async def test_reassign_fans_out_to_open_bookings(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await _world(http, clock)
    b = await book(http, w)
    assert (await accept(http, w, b)).status_code == 200
    d2 = await make_driver(w.agency, name="Murugan")
    r = await http.post(f"{T}/{w.trip['id']}/reassign", json={"driverId": d2.uid}, headers=w.agency.headers)
    assert r.status_code == 200, r.text
    doc = await booking_doc(b)
    assert doc["driverId"] == d2.uid and doc["display"]["driverName"] == "Murugan"
