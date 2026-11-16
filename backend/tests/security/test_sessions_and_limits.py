"""T3 · Revocation, lockout and rate limits (P2 §5.3, §5.8) with real Auth-emulator tokens.

Accounts are created through the real signup API (phone proof from the Auth emulator, phones
``+9170030xxxxx``) on the ``t3-security`` database. Rate-limit windows are shrunk with
``monkeypatch`` on ``RATE_LIMITS`` so the tests stay fast; every test uses its own client IP.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from app.core import constants
from tests.security.conftest import auth, bearer, client_with_ip, err, forge_token, t3_phone
from tests.support.builders import make_customer
from tests.support.tokens import exchange_custom_token, phone_proof

pytestmark = pytest.mark.emulator
PASSWORD = "Secret2026"
NEW_PASSWORD = "Better2027x"


async def signup(http: httpx.AsyncClient) -> tuple[str, str, str]:
    """Returns (uid, phone, session token)."""
    phone = t3_phone()
    proof = await phone_proof(phone)
    r = await http.post(
        "/api/v1/auth/signup/customer",
        json={
            "fullName": "Security Tester",
            "dob": "1990-05-17",
            "acceptTerms": True,
            "password": PASSWORD,
            "confirmPassword": PASSWORD,
        },
        headers=bearer(proof.id_token),
    )
    assert r.status_code == 201, r.text
    return proof.uid, phone, await exchange_custom_token(r.json()["customToken"])


async def login(http: httpx.AsyncClient, phone: str, password: str = PASSWORD, role: str = "customer") -> httpx.Response:
    return await http.post("/api/v1/auth/login", json={"role": role, "phone": phone, "password": password})


async def session_from(r: httpx.Response) -> str:
    assert r.status_code == 200, r.text
    return await exchange_custom_token(r.json()["customToken"])


async def me(http: httpx.AsyncClient, token: str) -> httpx.Response:
    return await http.get("/api/v1/me", headers=bearer(token))


async def _tick() -> None:
    # sessionsValidAfter is compared with auth_time in whole seconds.
    await asyncio.sleep(1.1)


async def test_logout_all_devices_revokes_old_tokens(http: httpx.AsyncClient) -> None:
    _, phone, t1 = await signup(http)
    t2 = await session_from(await login(http, phone))
    assert (await me(http, t1)).status_code == 200
    await _tick()
    r = await http.post("/api/v1/auth/logout", json={"allDevices": False}, headers=bearer(t1))
    assert r.status_code == 204
    assert (await me(http, t2)).status_code == 200  # single-device logout is client-side only
    r = await http.post("/api/v1/auth/logout", json={"allDevices": True}, headers=bearer(t1))
    assert r.status_code == 204
    for t in (t1, t2):
        r = await me(http, t)
        assert (r.status_code, err(r)) == (401, "session_revoked")
    await _tick()
    assert (await me(http, await session_from(await login(http, phone)))).status_code == 200


async def test_password_reset_revokes_sessions_and_old_password(http: httpx.AsyncClient) -> None:
    uid, phone, t1 = await signup(http)
    await _tick()
    proof = await phone_proof(phone)
    r = await http.post(
        "/api/v1/auth/password/reset",
        json={"password": NEW_PASSWORD, "confirmPassword": NEW_PASSWORD},
        headers=bearer(proof.id_token),
    )
    assert r.status_code == 200, r.text
    fresh = await exchange_custom_token(r.json()["customToken"])
    r = await me(http, t1)
    assert (r.status_code, err(r)) == (401, "session_revoked")
    assert (await me(http, fresh)).status_code == 200
    r = await login(http, phone, PASSWORD)
    assert (r.status_code, err(r)) == (401, "invalid_credentials")
    assert (await login(http, phone, NEW_PASSWORD)).status_code == 200


async def test_change_password_signs_out_other_devices(http: httpx.AsyncClient) -> None:
    _, phone, t1 = await signup(http)
    t2 = await session_from(await login(http, phone))
    await _tick()
    r = await http.post(
        "/api/v1/me/password",
        json={"currentPassword": PASSWORD, "password": NEW_PASSWORD, "confirmPassword": NEW_PASSWORD},
        headers=bearer(t1),
    )
    assert r.status_code == 200, r.text
    fresh = await exchange_custom_token(r.json()["customToken"])
    for t in (t1, t2):
        assert err(await me(http, t)) == "session_revoked"
    assert (await me(http, fresh)).status_code == 200


async def test_phone_change_revokes_sessions_and_moves_login(http: httpx.AsyncClient) -> None:
    _, old_phone, t1 = await signup(http)
    await _tick()
    new_phone = t3_phone()
    proof = await phone_proof(new_phone)
    # Wrong password: nothing changes.
    r = await http.post(
        "/api/v1/me/phone",
        json={"currentPassword": "wrong-password"},
        headers={**bearer(t1), "X-Phone-Proof": proof.id_token},
    )
    assert (r.status_code, err(r)) == (401, "invalid_credentials")
    r = await http.post(
        "/api/v1/me/phone",
        json={"currentPassword": PASSWORD},
        headers={**bearer(t1), "X-Phone-Proof": proof.id_token},
    )
    assert r.status_code == 200, r.text
    fresh = await exchange_custom_token(r.json()["customToken"])
    assert err(await me(http, t1)) == "session_revoked"
    body = (await me(http, fresh)).json()
    assert new_phone[-4:] in str(body)
    assert (await login(http, old_phone)).status_code == 401
    assert (await login(http, new_phone)).status_code == 200


async def test_phone_change_to_a_registered_number_is_refused(http: httpx.AsyncClient) -> None:
    _, _, t1 = await signup(http)
    _, other_phone, _ = await signup(http)
    proof = await phone_proof(other_phone)
    r = await http.post(
        "/api/v1/me/phone", json={"currentPassword": PASSWORD}, headers={**bearer(t1), "X-Phone-Proof": proof.id_token}
    )
    assert (r.status_code, err(r)) == (409, "phone_taken")


async def test_login_lockout_after_five_failures(http: httpx.AsyncClient) -> None:
    _, phone, _ = await signup(http)
    codes = [err(await login(http, phone, "Wrong-pass1")) for _ in range(5)]
    assert codes == ["invalid_credentials"] * 5
    r = await login(http, phone, PASSWORD)  # even the right password is refused while locked
    assert (r.status_code, err(r)) == (423, "account_locked") and r.json()["error"]["details"]["lockedUntil"]


async def test_login_generic_error_and_wrong_role_only_after_correct_password(http: httpx.AsyncClient) -> None:
    _, phone, _ = await signup(http)
    unknown = await login(http, t3_phone(), "Whatever1")
    wrong_pw = await login(http, phone, "Whatever1", role="agency")
    assert unknown.json()["error"] == wrong_pw.json()["error"]  # no enumeration
    r = await login(http, phone, PASSWORD, role="agency")
    assert (r.status_code, err(r)) == (403, "wrong_role")


async def test_login_rate_limit_per_phone(http: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(constants.RATE_LIMITS, "login_phone", (3, 900))
    phone = t3_phone()
    statuses = [(await login(http, phone, "Wrong-pass1")).status_code for _ in range(4)]
    assert statuses[:3] == [401, 401, 401] and statuses[3] == 429


async def test_login_rate_limit_per_ip(sec_app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(constants.RATE_LIMITS, "login_ip", (3, 900))
    async with client_with_ip(sec_app) as c:
        statuses = [(await login(c, t3_phone(), "Wrong-pass1")).status_code for _ in range(4)]
    assert statuses == [401, 401, 401, 429]
    r_retry = None
    async with client_with_ip(sec_app) as c:
        r_retry = await login(c, t3_phone(), "Wrong-pass1")
    assert r_retry.status_code == 401  # another IP has its own window


@pytest.mark.xfail(
    strict=True,
    reason="T3-1: client_ip trusts the FIRST X-Forwarded-For hop (client-controlled) when "
    "TRUST_PROXY_HEADERS=true, so per-IP limits are bypassed by rotating the header",
)
async def test_login_ip_limit_cannot_be_bypassed_with_spoofed_forwarded_for(
    sec_app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.middleware import rate_limit as rl

    real = rl.get_settings()
    monkeypatch.setattr(rl, "get_settings", lambda: real.model_copy(update={"TRUST_PROXY_HEADERS": True}))
    monkeypatch.setitem(constants.RATE_LIMITS, "login_ip", (3, 900))
    real_client = f"203.0.113.{10 + (id(sec_app) % 200)}"
    statuses = []
    async with client_with_ip(sec_app) as c:
        for i in range(5):
            # Cloud Run / Google front ends APPEND the real client address to whatever the client sent.
            spoof = {"X-Forwarded-For": f"198.51.100.{i + 1}, {real_client}"}
            r = await c.post(
                "/api/v1/auth/login",
                json={"role": "customer", "phone": t3_phone(), "password": "Wrong-pass1"},
                headers=spoof,
            )
            statuses.append(r.status_code)
    assert 429 in statuses, statuses


async def test_phone_proof_endpoints_are_rate_limited(http: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(constants.RATE_LIMITS, "phone_proof_uid", (3, 3600))
    uid = "t3proof" + t3_phone()[-6:]
    proof = bearer(forge_token(uid, provider="phone", phone=t3_phone()))
    statuses = [(await http.post("/api/v1/auth/phone/status", headers=proof)).status_code for _ in range(4)]
    assert statuses == [200, 200, 200, 429]
    r = await http.post(
        "/api/v1/auth/password/reset", json={"password": NEW_PASSWORD, "confirmPassword": NEW_PASSWORD}, headers=proof
    )
    assert r.status_code == 429 and r.headers.get("Retry-After")


async def test_geocode_rate_limit_applies_to_phone_proof_and_session(
    http: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(constants.RATE_LIMITS, "maps_uid", (2, 3600))
    cust = await make_customer()
    body: dict[str, Any] = {"placeId": "fake_coimbatore"}
    for headers in (auth(cust), bearer(forge_token("t3geo" + t3_phone()[-6:], provider="phone", phone=t3_phone()))):
        statuses = [(await http.post("/api/v1/maps/geocode", json=body, headers=headers)).status_code for _ in range(3)]
        assert statuses == [200, 200, 429], statuses
