"""T3 · AuthN/AuthZ matrix over every operation in the OpenAPI schema (P2 §5, contract §0).

For each operation the suite checks: no token, garbage token, tampered signature, expired token,
phone-proof token (only the documented phone-proof endpoints and E23 geocode accept one),
a valid token for a uid without a ``users`` doc, and wrong-role access per route group.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from app.repositories.base import C, doc_ref
from tests.security.conftest import auth, bearer, err, forge_token
from tests.support.builders import Account, make_agency, make_customer, make_driver

pytestmark = pytest.mark.emulator

SAMPLE = {
    "agency_id": "agc_" + "a" * 20,
    "booking_id": "TAKI00000001",
    "driver_id": "u0nonexistent",
    "file_id": "fil_" + "a" * 20,
    "index": "1",
    "invite_id": "inv_" + "a" * 20,
    "kind": "pan",
    "payment_id": "pay_" + "a" * 20,
    "shipment_id": "shp_" + "a" * 20,
    "trip_id": "trp_" + "a" * 20,
    "uid": "u0nonexistent",
    "vehicle_id": "veh_" + "a" * 20,
}

# Reachable without a session token (own auth or none).
PUBLIC = {
    ("GET", "/api/v1/health"),
    ("GET", "/api/v1/health/ready"),
    ("GET", "/api/v1/meta"),
    ("POST", "/api/v1/auth/login"),
    ("GET", "/api/v1/public/agencies"),
    ("POST", "/api/v1/public/contact"),
    ("GET", "/api/v1/files/{file_id}/content"),  # HMAC-signed URL, tested in test_files.py
    ("GET", "/api/v1/customer/search"),
    ("GET", "/api/v1/customer/trips/{trip_id}"),
    ("POST", "/api/v1/payments/cashfree/webhook"),  # Cashfree signature, tested in test_payments.py
    ("POST", "/api/v1/internal/sweep"),  # OIDC / CRON_SECRET
    ("GET", "/api/v1/auth/session"),  # optional user: {"user": null} without a session
}
# Bearer must be a phone-proof token.
PHONE_PROOF_ONLY = {
    ("POST", "/api/v1/auth/phone/status"),
    ("POST", "/api/v1/auth/signup/customer"),
    ("POST", "/api/v1/auth/signup/agency"),
    ("POST", "/api/v1/auth/signup/driver"),
    ("POST", "/api/v1/auth/password/reset"),
}
PHONE_OR_SESSION = {("POST", "/api/v1/maps/geocode")}  # E23, the single intended exception


def operations(app: FastAPI) -> list[tuple[str, str]]:
    ops = []
    for path, item in app.openapi()["paths"].items():
        for method in item:
            ops.append((method.upper(), path))
    ops.append(("POST", "/api/v1/payments/dev/confirm"))  # include_in_schema=False
    return sorted(ops)


def concrete(path: str) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: SAMPLE[m.group(1)], path)


async def call(http: httpx.AsyncClient, method: str, path: str, headers: dict[str, str]) -> httpx.Response:
    kw: dict[str, Any] = {"headers": headers}
    if method in ("POST", "PUT", "PATCH"):
        kw["json"] = {}
    return await http.request(method, concrete(path), **kw)


def session_ops(app: FastAPI) -> list[tuple[str, str]]:
    return [op for op in operations(app) if op not in PUBLIC | PHONE_PROOF_ONLY]


async def test_every_session_endpoint_rejects_missing_and_bad_tokens(http: httpx.AsyncClient, sec_app: FastAPI) -> None:
    uid = "t3nouser" + datetime.now(UTC).strftime("%H%M%S%f")
    good = forge_token(uid)
    tampered = good + "c2ln"  # a non-empty signature segment
    cases = {
        "none": ({}, 401, {"unauthenticated"}),
        "garbage": (bearer("not-a-jwt"), 401, {"unauthenticated"}),
        "basic": ({"Authorization": "Basic dXNlcjpwYXNz"}, 401, {"unauthenticated"}),
        "tampered": (bearer(tampered), 401, {"unauthenticated"}),
        "wrong_audience": (bearer(forge_token(uid, aud="other-project")), 401, {"unauthenticated"}),
        "no_users_doc": (bearer(good), 401, {"unauthenticated"}),
    }
    failures = []
    for method, path in session_ops(sec_app):
        for name, (headers, status, codes) in cases.items():
            r = await call(http, method, path, headers)
            if r.status_code != status or err(r) not in codes:
                failures.append(f"{name}: {method} {path} -> {r.status_code} {err(r)}")
    assert not failures, "\n".join(failures)


async def test_expired_token_maps_to_token_expired(
    http: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The emulator skips signature/expiry checks, so the SDK error is injected (production path)."""
    from firebase_admin import auth as sdk

    def _expired(*_a: Any, **_k: Any) -> dict[str, Any]:
        raise sdk.ExpiredIdTokenError("Token expired", cause=None)

    monkeypatch.setattr(sdk, "verify_id_token", _expired)
    for path in ("/api/v1/me", "/api/v1/customer/bookings", "/api/v1/agency/trips", "/api/v1/admin/overview"):
        r = await http.get(path, headers=bearer("x.y.z"))
        assert (r.status_code, err(r)) == (401, "token_expired"), path


async def test_phone_proof_token_is_refused_except_geocode(http: httpx.AsyncClient, sec_app: FastAPI) -> None:
    cust = await make_customer()
    proof = bearer(forge_token(cust.uid, provider="phone", phone=cust.phone))
    failures = []
    for method, path in session_ops(sec_app):
        r = await call(http, method, path, proof)
        if (method, path) in PHONE_OR_SESSION:
            if r.status_code in (401, 403):
                failures.append(f"geocode must accept a phone proof: {r.status_code} {err(r)}")
            continue
        if r.status_code != 403 or err(r) != "password_login_required":
            failures.append(f"{method} {path} -> {r.status_code} {err(r)}")
    assert not failures, "\n".join(failures)


async def test_phone_proof_endpoints_refuse_session_and_stale_proofs(http: httpx.AsyncClient) -> None:
    cust = await make_customer()
    stale = int(datetime.now(UTC).timestamp()) - 11 * 60
    cases = {
        "none": {},
        "session": auth(cust),
        "stale_proof": bearer(forge_token(cust.uid, provider="phone", phone=cust.phone, auth_time=stale)),
        "proof_without_phone": bearer(forge_token(cust.uid, provider="phone")),
    }
    failures = []
    for method, path in sorted(PHONE_PROOF_ONLY):
        for name, headers in cases.items():
            r = await call(http, method, path, headers)
            if r.status_code != 401 or err(r) != "phone_proof_required":
                failures.append(f"{name}: {method} {path} -> {r.status_code} {err(r)}")
    # /me/phone takes the proof in X-Phone-Proof; a session token there is not a proof.
    r = await http.post(
        "/api/v1/me/phone",
        json={"currentPassword": "Secret2026"},
        headers={**auth(cust), "X-Phone-Proof": forge_token(cust.uid)},
    )
    if r.status_code != 401 or err(r) != "phone_proof_required":
        failures.append(f"/me/phone with a session token as proof -> {r.status_code} {err(r)}")
    assert not failures, "\n".join(failures)


async def _admin() -> Account:
    now = datetime.now(UTC)
    uid = "t3adm" + now.strftime("%H%M%S%f")
    await doc_ref(C.users, uid).set(
        {
            "id": uid,
            "role": "admin",
            "phone": "+917003099999",
            "displayName": "T3 Admin",
            "status": "active",
            "agencyId": None,
            "sessionsValidAfter": now - timedelta(days=1),
            "createdAt": now,
            "updatedAt": now,
        }
    )
    return Account(uid=uid, role="admin", phone="+917003099999", name="T3 Admin")


GROUP_ROLES = {
    "/api/v1/admin/": {"admin"},
    "/api/v1/agency/": {"agency"},
    "/api/v1/driver/": {"driver"},
    "/api/v1/customer/": {"customer"},
    "/api/v1/payments/": {"customer"},
}


async def test_wrong_role_is_forbidden_on_every_role_group(http: httpx.AsyncClient, sec_app: FastAPI) -> None:
    agency = await make_agency()
    accounts = {
        "customer": await make_customer(),
        "agency": agency,
        "driver": await make_driver(agency),
        "admin": await _admin(),
    }
    failures = []
    for method, path in session_ops(sec_app):
        allowed = next((roles for prefix, roles in GROUP_ROLES.items() if path.startswith(prefix)), None)
        if allowed is None:
            continue
        for role, acct in accounts.items():
            if role in allowed:
                continue
            r = await call(http, method, path, auth(acct))
            if r.status_code != 403:
                failures.append(f"{role}: {method} {path} -> {r.status_code} {err(r)}")
    assert not failures, "\n".join(failures)


async def test_disabled_account_and_revoked_session_are_refused(http: httpx.AsyncClient) -> None:
    cust = await make_customer()
    r = await http.get("/api/v1/me", headers=auth(cust))
    assert r.status_code == 200, r.text
    old = int(datetime.now(UTC).timestamp()) - 600
    await doc_ref(C.users, cust.uid).update({"sessionsValidAfter": datetime.now(UTC) - timedelta(seconds=60)})
    r = await http.get("/api/v1/me", headers=auth(cust, auth_time=old, iat=old + 300))
    assert (r.status_code, err(r)) == (401, "session_revoked")
    await doc_ref(C.users, cust.uid).update({"status": "disabled"})
    r = await http.get("/api/v1/me", headers=auth(cust))
    assert (r.status_code, err(r)) == (403, "account_disabled")
