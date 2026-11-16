"""T3 · Concurrency (P2 §8): last-capacity races between customers, overlapping trip publishes for
one driver / one vehicle, and idempotency keys. 409 ``contention`` is acceptable; overbooking or
double assignment is not."""

from __future__ import annotations

import asyncio
from datetime import timedelta

import httpx
import pytest

from app.core.clock import FrozenClock
from app.domain import capacity
from google.cloud.firestore_v1.base_query import FieldFilter

from app.repositories.base import C, col, query_docs
from tests.bookings.support import (
    COIMBATORE,
    SALEM,
    accept,
    booking_doc,
    create_shipment,
    make_world,
    shipment_body,
    ist_day,
    trip_doc,
)
from tests.security.conftest import err, idem
from tests.support.builders import create_vehicle, make_customer, make_driver, trip_body

pytestmark = [pytest.mark.emulator, pytest.mark.slow]


async def _retry(fn, attempts: int = 6) -> httpx.Response:  # type: ignore[no-untyped-def]
    for i in range(attempts):
        r = await fn()
        if r.status_code != 409 or err(r) != "contention":
            return r
        await asyncio.sleep(0.2 * (i + 1))
    return r


async def test_two_customers_race_for_the_last_capacity(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await make_world(http, clock, offered_kg=1000)
    other = await make_customer("Second Customer")
    ids = []
    for cust in (w.customer, other):
        r = await http.post(
            "/api/v1/customer/shipments", json=shipment_body(COIMBATORE, SALEM, day=ist_day(w.start), weight=700),
            headers=cust.headers,
        )
        assert r.status_code == 201, r.text
        sid = r.json()["id"]
        r = await http.post(
            "/api/v1/customer/bookings", json={"shipmentId": sid, "tripId": w.trip["id"]},
            headers={**cust.headers, **idem()},
        )
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    rs = await asyncio.gather(*(_retry(lambda b=b: accept(http, w, b)) for b in ids))
    assert sorted(r.status_code for r in rs) == [200, 409], [r.text for r in rs]
    assert {err(r) for r in rs if r.status_code == 409} == {"insufficient_capacity"}
    trip = await trip_doc(w.trip["id"])
    assert capacity.max_leg_load(trip, clock.now()) <= 1000
    assert capacity.invariant(trip, [await booking_doc(b) for b in ids], clock.now()) == []


async def test_concurrent_publish_same_driver_overlapping(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await make_world(http, clock)
    v2 = await create_vehicle(http, w.agency)
    start = (clock.now() + timedelta(days=3)).replace(second=0, microsecond=0)
    bodies = [
        trip_body(w.vehicle["id"], w.driver.uid, start=start),
        trip_body(v2["id"], w.driver.uid, start=start + timedelta(hours=1)),
    ]
    rs = await asyncio.gather(
        *(_retry(lambda b=b: http.post("/api/v1/agency/trips", json=b, headers=w.agency.headers)) for b in bodies)
    )
    ok = [r for r in rs if r.status_code == 201]
    assert len(ok) == 1, [(r.status_code, r.text[:200]) for r in rs]
    loser = next(r for r in rs if r.status_code != 201)
    assert loser.status_code == 409 and err(loser) in ("driver_schedule_conflict", "contention"), loser.text


async def test_concurrent_publish_same_vehicle_overlapping(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await make_world(http, clock)
    d2 = await make_driver(w.agency, name="Second Driver")
    start = (clock.now() + timedelta(days=4)).replace(second=0, microsecond=0)
    bodies = [
        trip_body(w.vehicle["id"], w.driver.uid, start=start),
        trip_body(w.vehicle["id"], d2.uid, start=start + timedelta(minutes=30)),
    ]
    rs = await asyncio.gather(
        *(_retry(lambda b=b: http.post("/api/v1/agency/trips", json=b, headers=w.agency.headers)) for b in bodies)
    )
    assert sorted(r.status_code for r in rs) == [201, 409], [(r.status_code, r.text[:200]) for r in rs]
    loser = next(r for r in rs if r.status_code != 201)
    assert err(loser) in ("vehicle_schedule_conflict", "contention"), loser.text


async def test_booking_idempotency_key_concurrent_and_reuse(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await make_world(http, clock)
    s = await create_shipment(http, w, COIMBATORE, SALEM, weight=100)
    key = idem()
    body = {"shipmentId": s["id"], "tripId": w.trip["id"]}
    rs = await asyncio.gather(
        *(
            _retry(lambda: http.post("/api/v1/customer/bookings", json=body, headers={**w.customer.headers, **key}))
            for _ in range(3)
        )
    )
    good = [r for r in rs if r.status_code in (200, 201)]
    assert good and len({r.json()["id"] for r in good}) == 1, [(r.status_code, r.text[:150]) for r in rs]
    assert all(r.status_code in (200, 201, 409) for r in rs)
    docs = await query_docs(col(C.bookings).where(filter=FieldFilter("shipmentId", "==", s["id"])))
    assert len(docs) == 1, [d["id"] for d in docs]
    # Same key, different body → refused, never a second booking.
    s2 = await create_shipment(http, w, COIMBATORE, SALEM, weight=120)
    r = await http.post(
        "/api/v1/customer/bookings", json={"shipmentId": s2["id"], "tripId": w.trip["id"]},
        headers={**w.customer.headers, **key},
    )
    assert r.status_code in (409, 422) and err(r) == "idempotency_key_reused", r.text


async def test_payment_order_idempotency(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await make_world(http, clock)
    s = await create_shipment(http, w, COIMBATORE, SALEM, weight=100)
    bid = (await http.post(
        "/api/v1/customer/bookings", json={"shipmentId": s["id"], "tripId": w.trip["id"]},
        headers={**w.customer.headers, **idem()},
    )).json()["id"]
    assert (await accept(http, w, bid)).status_code == 200
    key = idem()
    rs = await asyncio.gather(
        *(
            _retry(lambda: http.post("/api/v1/payments/orders", json={"bookingId": bid},
                                     headers={**w.customer.headers, **key}))
            for _ in range(3)
        )
    )
    good = [r for r in rs if r.status_code in (200, 201)]
    assert good and len({r.json()["paymentId"] for r in good}) == 1, [(r.status_code, r.text[:150]) for r in rs]
    pays = await query_docs(col(C.payments).where(filter=FieldFilter("bookingId", "==", bid)))
    open_pays = [p for p in pays if p["status"] in ("created", "pending")]
    assert len(open_pays) == 1, [(p["id"], p["status"]) for p in pays]
