"""E23/E24 through the ASGI app with the FAKE maps provider (no network, no emulator)."""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest

from app.core.context import CurrentUser
from app.deps import get_current_user, get_user_or_phone_proof
from app.integrations.maps import CachingMapsClient, FakeMapsClient, InMemoryMapsCache, set_maps_for_tests
from tests.support.app import build_app, client_for

USER = CurrentUser(uid="u1", role="customer", phone="+919876500001", name="Ravi")


@pytest.fixture
async def http(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[tuple[httpx.AsyncClient, FakeMapsClient]]:
    import app.middleware.rate_limit as rl

    async def _no_limit(*_a: object, **_k: object) -> None:
        return None

    monkeypatch.setattr(rl, "check", _no_limit)
    fake = FakeMapsClient()
    set_maps_for_tests(CachingMapsClient(fake, InMemoryMapsCache()))
    app = build_app()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_user_or_phone_proof] = lambda: USER
    async with client_for(app) as c:
        yield c, fake
    set_maps_for_tests(None)


async def test_geocode_by_address_and_place(http: tuple[httpx.AsyncClient, FakeMapsClient]) -> None:
    c, _ = http
    r = await c.post("/api/v1/maps/geocode", json={"address": "Gandhipuram, Coimbatore 641012"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["inServiceArea"] is True
    assert body["place"]["placeId"] == "fake_coimbatore" and body["place"]["state"] == "TN"
    assert body["place"]["stateName"] == "Tamil Nadu" and body["place"]["lat"] == 11.0168
    r = await c.post("/api/v1/maps/geocode", json={"placeId": "fake_mumbai"})
    assert r.status_code == 200 and r.json()["inServiceArea"] is False


async def test_geocode_validation_and_errors(http: tuple[httpx.AsyncClient, FakeMapsClient]) -> None:
    c, fake = http
    r = await c.post("/api/v1/maps/geocode", json={"address": "Coimbatore", "placeId": "fake_coimbatore"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_request"
    r = await c.post("/api/v1/maps/geocode", json={"address": "Atlantis under the sea"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "address_not_found"
    fake.fail_with("quota")
    r = await c.post("/api/v1/maps/geocode", json={"placeId": "fake_erode_unknown"})
    assert r.status_code == 502 and r.json()["error"]["code"] == "maps_unavailable"
    assert r.json()["error"]["details"] == {"reason": "quota"}


async def test_reverse_geocode(http: tuple[httpx.AsyncClient, FakeMapsClient]) -> None:
    c, _ = http
    r = await c.post("/api/v1/maps/reverse-geocode", json={"lat": 12.97, "lng": 77.59})
    assert r.status_code == 200 and r.json()["place"]["name"] == "Bengaluru"
    r = await c.post("/api/v1/maps/reverse-geocode", json={"lat": 95, "lng": 77.59})
    assert r.status_code == 400


async def test_maps_not_configured_is_503(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.integrations.maps as maps_pkg
    import app.middleware.rate_limit as rl
    from app.integrations.maps.settings import MapsSettings

    async def _no_limit(*_a: object, **_k: object) -> None:
        return None

    monkeypatch.setattr(rl, "check", _no_limit)
    monkeypatch.setattr(maps_pkg, "get_maps_settings", lambda: MapsSettings(_env_file=None, APP_ENV="production"))
    set_maps_for_tests(None)
    app = build_app()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_user_or_phone_proof] = lambda: USER
    async with client_for(app) as c:
        r = await c.post("/api/v1/maps/geocode", json={"placeId": "ChIJtRyXL69ZqDsRgtI-GB7IwS8"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "maps_not_configured"


@pytest.mark.emulator
async def test_geocode_accepts_phone_proof_but_reverse_geocode_does_not(monkeypatch: pytest.MonkeyPatch) -> None:
    """An agency mid-signup (phone proof, no password yet) can geocode its typed base address (E23).

    E24 and every other endpoint keep refusing phone-proof tokens. Uses a real emulator phone
    sign-in; does not wipe shared emulator data.
    """
    from tests.conftest import _require_emulators
    from tests.support.app import next_phone
    from tests.support.tokens import bearer, phone_proof

    _require_emulators()
    import app.middleware.rate_limit as rl

    async def _no_limit(*_a: object, **_k: object) -> None:
        return None

    monkeypatch.setattr(rl, "check", _no_limit)
    set_maps_for_tests(CachingMapsClient(FakeMapsClient(), InMemoryMapsCache()))
    try:
        proof = await phone_proof(next_phone())
        async with client_for(build_app()) as c:
            auth = bearer(proof.id_token)
            r = await c.post("/api/v1/maps/geocode", json={"address": "Gandhipuram, Coimbatore 641012"}, headers=auth)
            assert r.status_code == 200, r.text
            assert r.json()["place"]["placeId"] == "fake_coimbatore"
            r = await c.post(
                "/api/v1/maps/reverse-geocode", json={"lat": 11.0168, "lng": 76.9558}, headers=bearer(proof.id_token)
            )
            assert r.status_code == 403 and r.json()["error"]["code"] == "password_login_required"
            r = await c.post("/api/v1/maps/geocode", json={"address": "Coimbatore"})
            assert r.status_code == 401
    finally:
        set_maps_for_tests(None)
