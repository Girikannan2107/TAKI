"""App skeleton: error envelope, validation mapping, headers, health, OpenAPI, boot guards."""

from __future__ import annotations

import httpx
import pytest

from app.core.config import ConfigError, check_boot_guards
from app.core.errors import ERROR_CATALOG, AppError
from app.core.exception_handlers import validation_fields
from app.main import create_app
from tests.support.app import client_for, make_settings


# ── boot guards (owner decision: dev payment gateway only in development/test) ─
@pytest.mark.parametrize("env", ["development", "test"])
def test_dev_gateway_allowed_in_dev_and_test(env: str) -> None:
    s = make_settings(APP_ENV=env, PAYMENT_PROVIDER="dev")
    check_boot_guards(s)
    assert s.dev_payment_gateway_enabled


@pytest.mark.parametrize("env", ["staging", "production"])
def test_dev_gateway_refused_outside_dev(env: str) -> None:
    s = make_settings(
        APP_ENV=env,
        PAYMENT_PROVIDER="dev",
        FIRESTORE_EMULATOR_HOST=None,
        FIREBASE_AUTH_EMULATOR_HOST=None,
        FIREBASE_STORAGE_EMULATOR_HOST=None,
        FIREBASE_PROJECT_ID="taki-prod",
        FILE_URL_SECRET="x" * 40,
        PII_HASH_KEY="y" * 40,
        OTP_ENC_KEY="z" * 40,
    )
    with pytest.raises(ConfigError, match="PAYMENT_PROVIDER=dev"):
        check_boot_guards(s)
    with pytest.raises(ConfigError):
        create_app(s)


def test_production_guards() -> None:
    prod = {
        "APP_ENV": "production",
        "FIRESTORE_EMULATOR_HOST": None,
        "FIREBASE_AUTH_EMULATOR_HOST": None,
        "FIREBASE_STORAGE_EMULATOR_HOST": None,
        "FIREBASE_PROJECT_ID": "taki-prod",
    }
    with pytest.raises(ConfigError, match="secrets"):
        check_boot_guards(make_settings(**prod))
    secrets = {"FILE_URL_SECRET": "x" * 40, "PII_HASH_KEY": "y" * 40, "OTP_ENC_KEY": "z" * 40}
    check_boot_guards(make_settings(**prod, **secrets))  # cashfree provider: fine
    with pytest.raises(ConfigError, match="EMULATOR"):
        check_boot_guards(make_settings(**{**prod, **secrets, "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080"}))
    with pytest.raises(ConfigError, match="DEV_AUTO_VERIFY"):
        check_boot_guards(make_settings(**prod, **secrets, DEV_AUTO_VERIFY=True))
    with pytest.raises(ConfigError, match="demo-"):
        check_boot_guards(make_settings(FIREBASE_PROJECT_ID="real-project"))


def test_settings_lists_and_aliases() -> None:
    s = make_settings(APP_ENV="local", CORS_ALLOWED_ORIGINS="http://a.test, http://b.test")
    assert s.APP_ENV == "development"
    assert s.CORS_ALLOWED_ORIGINS == ["http://a.test", "http://b.test"]
    assert make_settings(CORS_ALLOWED_ORIGINS='["http://c.test"]').CORS_ALLOWED_ORIGINS == ["http://c.test"]
    assert make_settings().FIREBASE_STORAGE_BUCKET == "demo-taki.appspot.com"
    assert "secret-value-123" not in repr(make_settings(FILE_URL_SECRET="secret-value-123"))


# ── error catalog ─────────────────────────────────────────────────────────────
def test_error_catalog_ports_v2_codes() -> None:
    for code, status in {
        "invalid_request": 400,
        "unauthenticated": 401,
        "invalid_credentials": 401,
        "forbidden": 403,
        "account_disabled": 403,
        "not_found": 404,
        "phone_taken": 409,
        "file_too_large": 413,
        "underage": 422,
        "account_locked": 423,
        "rate_limited": 429,
        "payments_not_configured": 501,
        "database_unavailable": 503,
        # v3 additions
        "token_expired": 401,
        "session_revoked": 401,
        "phone_proof_required": 401,
        "password_login_required": 403,
        "wrong_role": 403,
        "account_not_found": 404,
        "account_exists": 409,
    }.items():
        assert ERROR_CATALOG[code][0] == status, code
    assert "bad_origin" not in ERROR_CATALOG
    with pytest.raises(KeyError):
        AppError("no_such_code")


def test_validation_field_mapping() -> None:
    fields = validation_fields(
        [
            {"loc": ("body", "fullName"), "msg": "Enter your full name", "type": "name"},
            {"loc": ("body",), "msg": "Choose your agency", "type": "field:agencyId"},
            {"loc": ("body", "statesCovered", 2), "msg": "Input should be 'TN'", "type": "literal_error"},
            {"loc": ("query", "limit"), "msg": "first", "type": "x"},
            {"loc": ("query", "limit"), "msg": "second", "type": "x"},
        ]
    )
    assert fields == {
        "fullName": "Enter your full name",
        "agencyId": "Choose your agency",
        "statesCovered.2": "Input should be 'TN'",
        "limit": "first",
    }


# ── HTTP behaviour (no emulator needed) ───────────────────────────────────────
@pytest.fixture
async def bare_client() -> httpx.AsyncClient:
    async with client_for(create_app(make_settings())) as c:
        yield c  # type: ignore[misc]


async def test_unknown_route_uses_envelope(bare_client: httpx.AsyncClient) -> None:
    r = await bare_client.get("/api/v1/nope", headers={"X-Request-ID": "req-12345678"})
    assert r.status_code == 404
    assert r.json() == {"error": {"code": "not_found", "message": "We couldn't find that."}}
    assert r.headers["x-request-id"] == "req-12345678"
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "no-referrer"


async def test_method_not_allowed(bare_client: httpx.AsyncClient) -> None:
    r = await bare_client.delete("/api/v1/health")
    assert r.status_code == 405
    assert r.json()["error"]["code"] == "method_not_allowed"


async def test_validation_errors_are_400_with_fields(bare_client: httpx.AsyncClient) -> None:
    r = await bare_client.post("/api/v1/auth/login", json={"role": "pilot", "phone": "12345", "password": ""})
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "invalid_request"
    assert err["fields"]["phone"] == "Enter a valid 10-digit mobile number"
    assert set(err["fields"]) == {"role", "phone", "password"}


async def test_invalid_json_and_media_type(bare_client: httpx.AsyncClient) -> None:
    r = await bare_client.post("/api/v1/auth/login", content=b"{not json", headers={"Content-Type": "application/json"})
    assert r.status_code == 400
    assert r.json()["error"]["message"] == "The request body is not valid JSON."
    r = await bare_client.post("/api/v1/auth/login", content=b"phone=1", headers={"Content-Type": "text/plain"})
    assert r.status_code == 415
    assert r.json()["error"]["code"] == "unsupported_media_type"


async def test_body_too_large(bare_client: httpx.AsyncClient) -> None:
    r = await bare_client.post(
        "/api/v1/auth/login",
        content=b"{" + b" " * (1024 * 1024 + 10) + b"}",
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["message"] == "Request body is too large."


async def test_missing_token_is_unauthenticated(bare_client: httpx.AsyncClient) -> None:
    r = await bare_client.get("/api/v1/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"
    r = await bare_client.get("/api/v1/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


async def test_health_and_openapi(bare_client: httpx.AsyncClient) -> None:
    r = await bare_client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "version": "3.0.0", "env": "test"}
    spec = (await bare_client.get("/api/v1/openapi.json")).json()
    for path in (
        "/api/v1/auth/login",
        "/api/v1/me/profile",
        "/api/v1/files/{file_id}/content",
        "/api/v1/admin/overview",
    ):
        assert path in spec["paths"], path
    assert (await bare_client.get("/api/v1/docs")).status_code == 200


async def test_docs_hidden_in_production() -> None:
    s = make_settings(
        APP_ENV="production",
        FIRESTORE_EMULATOR_HOST=None,
        FIREBASE_AUTH_EMULATOR_HOST=None,
        FIREBASE_STORAGE_EMULATOR_HOST=None,
        FIREBASE_PROJECT_ID="taki-prod",
        FILE_URL_SECRET="x" * 40,
        PII_HASH_KEY="y" * 40,
        OTP_ENC_KEY="z" * 40,
    )
    async with client_for(create_app(s)) as c:
        assert (await c.get("/api/v1/docs")).status_code == 404
        assert (await c.get("/api/v1/openapi.json")).status_code == 200


async def test_cors_preflight(bare_client: httpx.AsyncClient) -> None:
    r = await bare_client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"
    r = await bare_client.options(
        "/api/v1/auth/login", headers={"Origin": "https://evil.test", "Access-Control-Request-Method": "POST"}
    )
    assert "access-control-allow-origin" not in r.headers


async def test_readiness_checks_firestore(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/health/ready")
    assert r.status_code == 200
    assert r.json()["firestore"] == "ok"
    assert r.json()["auth"] == "emulator"


async def test_meta(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/meta")
    assert r.status_code == 200
    body = r.json()
    assert [s["code"] for s in body["states"]] == ["TN", "KL", "KA", "TG", "AP"]
    assert body["limits"]["maxCheckpoints"] == 10
    assert r.headers["cache-control"] == "public, max-age=300"
