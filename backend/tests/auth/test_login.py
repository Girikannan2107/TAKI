"""Login (E8), lockout, wrong role, password reset (E9), logout (E10), revocation."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import FastAPI

from app.core.clock import FrozenClock, get_clock
from tests.support.app import PASSWORD, login, make_admin, next_phone, signup_customer
from tests.support.tokens import bearer, exchange_custom_token, phone_proof


async def test_login_success_and_failures(client: httpx.AsyncClient) -> None:
    acct = await signup_customer(client)
    r = await login(client, "customer", acct.phone)
    assert r.status_code == 200, r.text
    token = await exchange_custom_token(r.json()["customToken"])
    assert (await client.get("/api/v1/me", headers=bearer(token))).json()["role"] == "customer"

    # Phone formats are normalised.
    r = await login(client, "customer", "0" + acct.phone[-10:])
    assert r.status_code == 200

    r = await login(client, "customer", acct.phone, "Wrong12345")
    assert r.status_code == 401
    assert r.json() == {"error": {"code": "invalid_credentials", "message": "Phone number or password is incorrect."}}
    r = await login(client, "customer", next_phone())
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_credentials"


async def test_wrong_role_revealed_only_after_correct_password(client: httpx.AsyncClient) -> None:
    acct = await signup_customer(client)
    r = await login(client, "agency", acct.phone, "Wrong12345")
    assert r.json()["error"]["code"] == "invalid_credentials"
    r = await login(client, "agency", acct.phone)
    assert r.status_code == 403
    err = r.json()["error"]
    assert err["code"] == "wrong_role"
    assert err["details"] == {"role": "customer"}
    assert err["message"] == "This number is registered as a Customer account. Switch to Customer login."


async def test_admin_login_and_hidden_role(client: httpx.AsyncClient) -> None:
    admin = await make_admin()
    r = await login(client, "admin", admin.phone)
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "admin"
    r = await login(client, "customer", admin.phone)
    assert r.status_code == 403
    assert r.json()["error"] == {"code": "wrong_role", "message": "This number can't sign in here."}


async def test_lockout_after_five_failures(app: FastAPI, client: httpx.AsyncClient) -> None:
    clock = FrozenClock(datetime.now(UTC))
    app.dependency_overrides[get_clock] = lambda: clock
    acct = await signup_customer(client)
    for i in range(5):
        r = await login(client, "customer", acct.phone, f"Wrong{i}abcd")
        assert r.status_code == 401, i
    clock.advance(minutes=1)
    r = await login(client, "customer", acct.phone)
    assert r.status_code == 423
    err = r.json()["error"]
    assert err["code"] == "account_locked"
    locked_until = datetime.fromisoformat(err["details"]["lockedUntil"].replace("Z", "+00:00"))
    assert timedelta(minutes=13) < locked_until - clock.now() <= timedelta(minutes=15)
    clock.advance(minutes=16)
    r = await login(client, "customer", acct.phone)
    assert r.status_code == 200, r.text


async def test_login_rate_limit_per_phone(app: FastAPI, client: httpx.AsyncClient) -> None:
    clock = FrozenClock(datetime.now(UTC))
    app.dependency_overrides[get_clock] = lambda: clock
    phone = next_phone()  # unknown phone: no lockout, only the per-phone window applies
    for _ in range(10):
        assert (await login(client, "customer", phone)).status_code == 401
    r = await login(client, "customer", phone)
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "rate_limited"
    assert int(r.headers["retry-after"]) > 0
    assert r.json()["error"]["details"]["retryAfterSeconds"] > 0


async def test_password_reset_revokes_sessions(client: httpx.AsyncClient) -> None:
    acct = await signup_customer(client)
    await asyncio.sleep(1.1)  # auth_time has second precision
    proof = await phone_proof(acct.phone)
    r = await client.post(
        "/api/v1/auth/password/reset",
        headers=bearer(proof.id_token),
        json={"password": "NewPass2027", "confirmPassword": "NewPass2027"},
    )
    assert r.status_code == 200, r.text
    new_token = await exchange_custom_token(r.json()["customToken"])
    assert (await client.get("/api/v1/me", headers=bearer(new_token))).status_code == 200
    old = await client.get("/api/v1/me", headers=acct.headers)
    assert old.status_code == 401
    assert old.json()["error"]["code"] == "session_revoked"
    assert (await login(client, "customer", acct.phone)).status_code == 401
    assert (await login(client, "customer", acct.phone, "NewPass2027")).status_code == 200

    unknown = await phone_proof(next_phone())
    r = await client.post(
        "/api/v1/auth/password/reset",
        headers=bearer(unknown.id_token),
        json={"password": "NewPass2027", "confirmPassword": "NewPass2027"},
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "account_not_found"
    # A session token cannot reset a password.
    r = await client.post(
        "/api/v1/auth/password/reset",
        headers=bearer(new_token),
        json={"password": "Another2028", "confirmPassword": "Another2028"},
    )
    assert r.json()["error"]["code"] == "phone_proof_required"


async def test_logout_everywhere(client: httpx.AsyncClient) -> None:
    acct = await signup_customer(client)
    r = await client.post("/api/v1/auth/logout", headers=acct.headers, json={"allDevices": False})
    assert r.status_code == 204
    assert (await client.get("/api/v1/me", headers=acct.headers)).status_code == 200
    await asyncio.sleep(1.1)
    r = await client.post("/api/v1/auth/logout", headers=acct.headers, json={"allDevices": True})
    assert r.status_code == 204
    r = await client.get("/api/v1/me", headers=acct.headers)
    assert r.json()["error"]["code"] == "session_revoked"
    r = await login(client, "customer", acct.phone)
    fresh = await exchange_custom_token(r.json()["customToken"])
    assert (await client.get("/api/v1/me", headers=bearer(fresh))).status_code == 200


async def test_change_password_signs_out_other_devices(client: httpx.AsyncClient) -> None:
    acct = await signup_customer(client)
    await asyncio.sleep(1.1)
    r = await client.post(
        "/api/v1/me/password",
        headers=acct.headers,
        json={"currentPassword": "Wrong9999", "password": "Fresh2027x", "confirmPassword": "Fresh2027x"},
    )
    assert r.status_code == 401
    assert r.json()["error"]["fields"] == {"currentPassword": "Incorrect password"}
    r = await client.post(
        "/api/v1/me/password",
        headers=acct.headers,
        json={"currentPassword": PASSWORD, "password": PASSWORD, "confirmPassword": PASSWORD},
    )
    assert r.json()["error"]["fields"]["password"] == "Choose a password you haven't used here"
    r = await client.post(
        "/api/v1/me/password",
        headers=acct.headers,
        json={"currentPassword": PASSWORD, "password": "Fresh2027x", "confirmPassword": "Fresh2027x"},
    )
    assert r.status_code == 200, r.text
    this_device = await exchange_custom_token(r.json()["customToken"])
    assert (await client.get("/api/v1/me", headers=bearer(this_device))).status_code == 200
    assert (await client.get("/api/v1/me", headers=acct.headers)).json()["error"]["code"] == "session_revoked"
    assert (await login(client, "customer", acct.phone, "Fresh2027x")).status_code == 200
