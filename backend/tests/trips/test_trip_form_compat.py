"""T1 blocker: the Add Trip form sends ``maxCapacityKg`` (trip maximum capacity) on create and PATCH."""

from __future__ import annotations

import httpx

from tests.support.builders import make_world, trip_body

T = "/api/v1/agency/trips"


async def test_max_capacity_is_accepted_and_validated(api: httpx.AsyncClient) -> None:
    w = await make_world(api)
    v, d = w.vehicles[0]["id"], w.drivers[0].uid  # payload 3000 kg
    body = {**trip_body(v, d, publish=False, offered_kg=1200), "maxCapacityKg": 3000}
    r = await api.post(T, json=body, headers=w.agency.headers)
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    assert r.json()["capacity"]["vehicleMaxKg"] == 3000 and r.json()["capacity"]["offeredKg"] == 1200

    r = await api.patch(f"{T}/{tid}", json={"maxCapacityKg": 2500, "offeredKg": 1500}, headers=w.agency.headers)
    assert r.status_code == 200, r.text
    assert r.json()["capacity"]["offeredKg"] == 1500

    r = await api.post(T, json={**body, "maxCapacityKg": 3500}, headers=w.agency.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "capacity_exceeds_vehicle"
    assert "maxCapacityKg" in r.json()["error"]["fields"]
    r = await api.post(T, json={**body, "maxCapacityKg": 1000}, headers=w.agency.headers)
    assert r.status_code == 400 and "offeredKg" in r.json()["error"]["fields"]

    # Published trips: the form's pricing step PATCH may resend it.
    r = await api.post(f"{T}/{tid}/publish", headers=w.agency.headers)
    assert r.status_code == 200, r.text
    r = await api.patch(
        f"{T}/{tid}",
        json={"maxCapacityKg": 3000, "ratePerKmPaise": 1600, "ratePerKgPaise": 80},
        headers=w.agency.headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["rates"]["perKmPaise"] == 1600
    r = await api.patch(f"{T}/{tid}", json={"maxCapacityKg": 1000}, headers=w.agency.headers)
    assert r.status_code == 400 and "offeredKg" in r.json()["error"]["fields"]
    r = await api.patch(f"{T}/{tid}", json={"maxCapacityKg": 4000}, headers=w.agency.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "capacity_exceeds_vehicle"
