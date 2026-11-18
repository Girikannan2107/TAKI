"""E129 sweep: authentication (CRON_SECRET / Google OIDC), expiry of requests and payment windows."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from app.core.clock import FrozenClock
from app.core.config import get_settings
from app.services import sweep_service
from tests.bookings.support import accept, book, booking_doc, make_world, trip_doc
from tests.support.app import make_settings

pytestmark = pytest.mark.emulator

SECRET = "cron-secret-for-tests-0123456789"


@pytest.fixture
def configure(d4_app: FastAPI) -> Iterator[Any]:
    def set_(**kw: Any) -> None:
        d4_app.dependency_overrides[get_settings] = lambda: make_settings(**kw)

    yield set_
    d4_app.dependency_overrides.pop(get_settings, None)
    sweep_service.set_oidc_verifier(None)


async def test_sweep_auth(http: httpx.AsyncClient, configure: Any) -> None:
    configure()
    r = await http.post("/api/v1/internal/sweep")
    assert r.status_code == 503 and r.json()["error"]["code"] == "cron_not_configured"
    configure(CRON_SECRET=SECRET)
    assert (await http.post("/api/v1/internal/sweep")).status_code == 401
    assert (await http.post("/api/v1/internal/sweep", headers={"Authorization": "Bearer nope"})).status_code == 401
    assert (await http.get("/api/v1/internal/sweep", headers={"Authorization": f"Bearer {SECRET}"})).status_code == 405
    r = await http.post("/api/v1/internal/sweep", headers={"Authorization": f"Bearer {SECRET}"})
    assert r.status_code == 200, r.text
    assert set(r.json()) >= {"expiredRequests", "expiredPayments", "reconciledPayments", "jobsRun", "durationMs"}

    configure(
        SWEEP_OIDC_AUDIENCE="https://api.example/api/v1/internal/sweep",
        SWEEP_INVOKER_EMAILS="sched@proj.iam.gserviceaccount.com",
    )

    def verifier(token: str, audience: str) -> dict[str, Any]:
        if token == "good":
            return {"email": "sched@proj.iam.gserviceaccount.com", "email_verified": True, "aud": audience}
        if token == "stranger":
            return {"email": "evil@example.com", "email_verified": True, "aud": audience}
        raise ValueError("bad signature")

    sweep_service.set_oidc_verifier(verifier)
    assert (await http.post("/api/v1/internal/sweep", headers={"Authorization": "Bearer good"})).status_code == 200
    assert (await http.post("/api/v1/internal/sweep", headers={"Authorization": "Bearer stranger"})).status_code == 401
    assert (await http.post("/api/v1/internal/sweep", headers={"Authorization": "Bearer forged"})).status_code == 401


async def test_sweep_expires_requests_and_unpaid_holds(
    http: httpx.AsyncClient, clock: FrozenClock, configure: Any
) -> None:
    configure(CRON_SECRET=SECRET)
    w = await make_world(http, clock, lead=timedelta(hours=5))
    pending = await book(http, w, weight=100)
    held = await book(http, w, weight=100)
    assert (await accept(http, w, held)).status_code == 200
    clock.advance(hours=2, minutes=5)  # payment window (120 min) closed; request still open
    r = await http.post("/api/v1/internal/sweep", headers={"Authorization": f"Bearer {SECRET}"})
    assert r.status_code == 200 and r.json()["expiredPayments"] == 1 and r.json()["expiredRequests"] == 0
    doc = await booking_doc(held)
    assert doc["paymentStatus"] == "expired" and doc["reservationStatus"] == "released"
    assert held not in (await trip_doc(w.trip["id"]))["holds"]
    clock.advance(hours=2)  # past respondBy of the pending request
    r = await http.post("/api/v1/internal/sweep", headers={"Authorization": f"Bearer {SECRET}"})
    assert r.json()["expiredRequests"] == 1
    doc = await booking_doc(pending)
    assert doc["approvalStatus"] == "expired" and doc["status"] == "rejected"
    kinds = [n["kind"] for n in (await http.get("/api/v1/notifications", headers=w.customer.headers)).json()["items"]]
    assert "booking_expired" in kinds and "booking_cancelled" in kinds
    r = await http.post("/api/v1/internal/sweep", headers={"Authorization": f"Bearer {SECRET}"})
    assert r.json()["expiredRequests"] == 0 and r.json()["expiredPayments"] == 0  # idempotent
