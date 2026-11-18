"""T3 · Public endpoints: per-IP rate limits (P2 §5.8 ``search:ip`` covers guest search AND trip
detail) and request-size limits (P2 §12.2)."""

from __future__ import annotations

import httpx
import pytest

from app.core import constants
from app.core.clock import FrozenClock
from tests.bookings.support import ist_day, make_world
from tests.security.conftest import err

pytestmark = pytest.mark.emulator


async def test_guest_search_is_rate_limited_per_ip(http: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(constants.RATE_LIMITS, "search_ip", (2, 3600))
    params = {"fromPlaceId": "fake_coimbatore", "toPlaceId": "fake_salem", "weightKg": 100, "date": "2030-01-01"}
    statuses = [(await http.get("/api/v1/customer/search", params=params)).status_code for _ in range(3)]
    assert statuses[2] == 429, statuses


async def test_public_trip_detail_is_rate_limited_per_ip(
    http: httpx.AsyncClient, clock: FrozenClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    w = await make_world(http, clock)
    monkeypatch.setitem(constants.RATE_LIMITS, "search_ip", (2, 3600))
    path = f"/api/v1/customer/trips/{w.trip['id']}"
    params = {"fromPlaceId": "fake_coimbatore", "toPlaceId": "fake_salem", "weightKg": 100, "date": ist_day(w.start)}
    statuses = [(await http.get(path, params=params)).status_code for _ in range(4)]
    assert 429 in statuses, statuses


async def test_public_contact_is_rate_limited_per_ip(http: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(constants.RATE_LIMITS, "contact_ip", (1, 3600))
    body = {"name": "T3 Tester", "phone": "9876543210", "message": "Security test message, please ignore."}
    r1 = await http.post("/api/v1/public/contact", json=body)
    r2 = await http.post("/api/v1/public/contact", json=body)
    assert r2.status_code == 429, (r1.status_code, r1.text, r2.status_code)


async def test_oversized_json_body_is_refused(http: httpx.AsyncClient) -> None:
    r = await http.post(
        "/api/v1/auth/login",
        content=b'{"role":"customer","phone":"9876543210","password":"' + b"a" * (1024 * 1024 + 10) + b'"}',
        headers={"Content-Type": "application/json"},
    )
    # Contract §0: an oversized JSON body is a 400 (413 is reserved for multipart uploads).
    assert (r.status_code, err(r)) == (400, "invalid_request") and "too large" in r.text, r.text
