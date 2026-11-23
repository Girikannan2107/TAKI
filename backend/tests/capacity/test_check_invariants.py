"""scripts/check_invariants.py over the d3-data database."""

from __future__ import annotations

import httpx
from scripts.check_invariants import check

from app.repositories.base import C, doc_ref
from tests.support.builders import create_trip, make_world


async def test_clean_world_has_no_violations_and_orphan_hold_is_reported(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    t = await create_trip(api, w.agency, w.vehicles[0]["id"], w.drivers[0].uid)
    await create_trip(api, w.agency, w.vehicles[1]["id"], w.drivers[1].uid, publish=False)
    assert await check() == []
    await doc_ref(C.trips, t["id"]).update(
        {"holds.TAKI12345678": {"kg": 1500, "fromIndex": 0, "toIndex": 3, "state": "committed", "dueAt": None}}
    )
    problems = await check()
    assert any("hold TAKI12345678 has no booking" in p for p in problems)
    assert any("max leg load 1500" in p for p in problems)
    assert any("capacitySummary" in p for p in problems)
