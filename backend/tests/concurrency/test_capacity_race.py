"""Concurrency (P2 §8.5) against the emulator: accepts serialise on the trip document."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from app.core.clock import FrozenClock
from app.domain import capacity
from tests.bookings.support import (
    COIMBATORE,
    ERODE,
    SALEM,
    TIRUPPUR,
    accept,
    book,
    booking_doc,
    create_shipment,
    idem,
    make_world,
    trip_doc,
)

pytestmark = [pytest.mark.emulator, pytest.mark.slow]


async def _invariant(trip_id: str, ids: list[str], clock: FrozenClock) -> list[str]:
    trip = await trip_doc(trip_id)
    return capacity.invariant(trip, [await booking_doc(i) for i in ids], clock.now())


async def test_two_concurrent_accepts_on_the_last_capacity(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await make_world(http, clock, offered_kg=1000)
    a = await book(http, w, weight=600)
    b = await book(http, w, weight=600)
    ra, rb = await asyncio.gather(accept(http, w, a), accept(http, w, b))
    codes = sorted([ra.status_code, rb.status_code])
    assert codes == [200, 409], (ra.text, rb.text)
    loser = ra if ra.status_code == 409 else rb
    assert loser.json()["error"]["code"] == "insufficient_capacity"
    assert loser.json()["error"]["details"]["availableKg"] == 400
    trip = await trip_doc(w.trip["id"])
    assert len(trip["holds"]) == 1 and capacity.max_leg_load(trip, clock.now()) == 600
    assert await _invariant(w.trip["id"], [a, b], clock) == []


async def test_many_concurrent_accepts(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    w = await make_world(http, clock, offered_kg=1000)
    ids = [await book(http, w, weight=400) for _ in range(3)]

    async def accept_retrying(bid: str) -> httpx.Response:
        for _ in range(5):  # 409 ``contention`` is retryable (clients retry it)
            r = await accept(http, w, bid)
            if r.status_code != 409 or r.json()["error"]["code"] != "contention":
                return r
        return r

    results = await asyncio.gather(*(accept_retrying(i) for i in ids))
    ok = [r for r in results if r.status_code == 200]
    assert len(ok) == 2 and all(
        r.json()["error"]["code"] == "insufficient_capacity" for r in results if r.status_code != 200
    )
    assert await _invariant(w.trip["id"], ids, clock) == []


async def test_disjoint_legs_share_capacity(http: httpx.AsyncClient, clock: FrozenClock) -> None:
    """T1b: A→B 600 and B→D 600 both fit (disjoint legs); A→D 500 does not."""
    w = await make_world(http, clock, offered_kg=1000)
    ab = await book(http, w, COIMBATORE, TIRUPPUR, weight=600)
    bd = await book(http, w, TIRUPPUR, SALEM, weight=600)
    ad = await book(http, w, COIMBATORE, SALEM, weight=500)
    assert (await accept(http, w, ab)).status_code == 200
    assert (await accept(http, w, bd)).status_code == 200
    r = await accept(http, w, ad)
    assert r.status_code == 409 and r.json()["error"]["code"] == "insufficient_capacity"
    s = await create_shipment(http, w, TIRUPPUR, ERODE, weight=400)
    r = await http.get(f"/api/v1/customer/shipments/{s['id']}/offers", headers=w.customer.headers)
    assert r.json()["items"][0]["availableCapacityKg"] == 400  # the customer's own segment
    assert await _invariant(w.trip["id"], [ab, bd, ad], clock) == []


async def test_same_idempotency_key_concurrently_creates_one_booking(
    http: httpx.AsyncClient, clock: FrozenClock
) -> None:
    w = await make_world(http, clock)
    s = await create_shipment(http, w, COIMBATORE, SALEM)
    headers = {**w.customer.headers, **idem()}
    body = {"shipmentId": s["id"], "tripId": w.trip["id"]}
    results = await asyncio.gather(
        *(http.post("/api/v1/customer/bookings", json=body, headers=headers) for _ in range(5))
    )
    ok = [r for r in results if r.status_code in (200, 201)]
    assert len({r.json()["id"] for r in ok}) == 1 and [r.status_code for r in ok].count(201) == 1
    assert all(r.status_code in (200, 201, 409) for r in results)
    # another key for the same shipment → one open booking per shipment
    r = await http.post("/api/v1/customer/bookings", json=body, headers={**w.customer.headers, **idem()})
    assert r.status_code == 409 and r.json()["error"]["code"] == "shipment_has_open_booking"
    # the same key with a different body is rejected
    s2 = await create_shipment(http, w, TIRUPPUR, SALEM)
    r = await http.post("/api/v1/customer/bookings", json={**body, "shipmentId": s2["id"]}, headers=headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "idempotency_key_reused"
    r = await http.post("/api/v1/customer/bookings", json=body, headers=w.customer.headers)
    assert r.status_code == 400 and r.json()["error"]["code"] == "idempotency_key_required"
