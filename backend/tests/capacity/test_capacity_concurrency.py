"""Concurrent capacity holds on one trip (P2 §8.5 T1/T1b + "last capacity" race) against the emulator.

Each hold runs the same read-modify-write a booking accept does (D4 calls ``domain/capacity`` inside
its transaction): read the trip in the transaction, ``with_hold`` on the segment, write ``holds`` +
``capacitySummary`` + ``version``. Firestore serialises the transactions; losers retry, re-read the
holds and fail with ``insufficient_capacity``.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import httpx
from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.core.errors import AppError
from app.domain import capacity
from app.repositories import trips as trips_repo
from app.repositories.base import run_transaction
from tests.support.builders import create_trip, create_vehicle, make_agency, make_driver, raw_trip


async def _hold(trip_id: str, booking_id: str, kg: int, i: int, j: int) -> str:
    now = datetime.now(UTC)

    async def _tx(tx: AsyncTransaction) -> None:
        t = await trips_repo.tx_get_trip(tx, trip_id)
        assert t is not None
        holds = capacity.with_hold(t, booking_id, kg, i, j, now + timedelta(hours=2), now)
        nxt = {**t, "holds": holds}
        trips_repo.tx_update(
            tx,
            trip_id,
            {"holds": holds, "capacitySummary": capacity.summary(nxt, now), "version": int(t["version"]) + 1},
        )

    try:
        await run_transaction(_tx)
    except AppError as e:
        return e.code
    return "ok"


async def _published_trip(api: httpx.AsyncClient, offered: int) -> str:
    a = await make_agency()
    d = await make_driver(a)
    v = await create_vehicle(api, a)
    t = await create_trip(api, a, v["id"], d.uid, offered_kg=offered)
    assert t["status"] == "published"
    return str(t["id"])


async def test_last_capacity_on_a_leg_exactly_one_wins(api: httpx.AsyncClient) -> None:
    trip_id = await _published_trip(api, offered=1000)
    assert await _hold(trip_id, "TAKI00000001", 700, 0, 2) == "ok"
    # 300 kg left on legs 0–1: two parallel 300 kg holds overlapping leg 1 → exactly one wins.
    results = await asyncio.gather(_hold(trip_id, "TAKI00000002", 300, 1, 3), _hold(trip_id, "TAKI00000003", 300, 0, 2))
    assert sorted(results) == ["insufficient_capacity", "ok"]
    t = await raw_trip(trip_id)
    now = datetime.now(UTC)
    assert capacity.max_leg_load(t, now) == 1000
    assert len(t["holds"]) == 2
    assert t["capacitySummary"]["maxLegLoadKg"] == 1000


async def test_t1_parallel_accepts_never_overbook(api: httpx.AsyncClient) -> None:
    """T1 (scaled to 10 × 100 kg on 600 kg). The emulator resolves lock conflicts by timing out, so a
    request may end as 409 ``contention`` (the client retries it); none may ever overbook."""
    trip_id = await _published_trip(api, offered=600)
    ids = [f"TAKI{n:08d}" for n in range(10)]
    results = dict(zip(ids, await asyncio.gather(*(_hold(trip_id, b, 100, 0, 3) for b in ids)), strict=True))
    assert set(results.values()) <= {"ok", "insufficient_capacity", "contention"}
    assert list(results.values()).count("ok") <= 6
    for bid, r in results.items():  # client retries of contended requests
        if r == "contention":
            results[bid] = await _hold(trip_id, bid, 100, 0, 3)
    assert list(results.values()).count("ok") == 6
    assert list(results.values()).count("insufficient_capacity") == 4
    t = await raw_trip(trip_id)
    now = datetime.now(UTC)
    assert capacity.leg_loads(t, now) == [600, 600, 600]
    bookings = [
        {
            "id": bid,
            "reservationStatus": "held",
            "weightKg": 100,
            "pickup": {"checkpointIndex": 0},
            "drop": {"checkpointIndex": 3},
        }
        for bid in t["holds"]
    ]
    assert capacity.invariant(t, bookings, now) == []


async def test_t1b_disjoint_legs_in_parallel(api: httpx.AsyncClient) -> None:
    trip_id = await _published_trip(api, offered=1000)
    r1, r2 = await asyncio.gather(_hold(trip_id, "TAKI10000001", 600, 0, 1), _hold(trip_id, "TAKI10000002", 600, 1, 3))
    assert (r1, r2) == ("ok", "ok")
    assert await _hold(trip_id, "TAKI10000003", 500, 0, 3) == "insufficient_capacity"
    assert await _hold(trip_id, "TAKI10000004", 400, 0, 3) == "ok"
