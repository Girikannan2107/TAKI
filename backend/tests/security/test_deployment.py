"""T3 · Deployment validation without building an image (P2 §4, §12.4, §16).

* Startup guards run in a **fresh interpreter** with a production-like environment (no emulator
  variables inherited), importing ``app.main`` exactly as gunicorn does.
* CORS, security headers and docs visibility are checked on an in-process production app
  (``create_app`` does not touch Firebase until the lifespan runs).
* Static checks: Dockerfile, .dockerignore, workflows, env template and apphosting.yaml.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import httpx
import pytest
import yaml

from app.core.config import Settings
from app.main import create_app

BACKEND = Path(__file__).resolve().parents[2]
REPO = BACKEND.parent
S32 = "s" * 40
PROD: dict[str, str] = {
    "APP_ENV": "production",
    "FIREBASE_PROJECT_ID": "taki-prod-test",
    "FILE_URL_SECRET": S32,
    "PII_HASH_KEY": S32,
    "OTP_ENC_KEY": S32,
    "APP_ORIGIN": "https://taki.example",
    "PUBLIC_API_BASE_URL": "https://api.taki.example",
    "CORS_ALLOWED_ORIGINS": "https://taki.example",
    "PAYMENT_PROVIDER": "cashfree",
    "CASHFREE_ENV": "production",
    "MAPS_PROVIDER": "auto",
    "LOG_JSON": "false",
    "LOG_LEVEL": "ERROR",
}
STRIP = ("FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST")


def boot(tmp_path: Path, **over: str | None) -> subprocess.CompletedProcess[str]:
    env = {k: v for k, v in os.environ.items() if k not in STRIP and k not in PROD}
    env.update(PROD)
    for k, v in over.items():
        if v is None:
            env.pop(k, None)
        else:
            env[k] = v
    env["PYTHONPATH"] = str(BACKEND)
    # cwd = an empty dir so no stray .env file is read.
    return subprocess.run(
        [sys.executable, "-c", "import app.main"], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=120
    )


def test_valid_production_config_boots(tmp_path: Path) -> None:
    p = boot(tmp_path)
    assert p.returncode == 0, p.stderr[-2000:]


@pytest.mark.parametrize(
    ("name", "over", "needle"),
    [
        ("dev_gateway_in_production", {"PAYMENT_PROVIDER": "dev"}, "PAYMENT_PROVIDER=dev"),
        ("dev_gateway_in_staging", {"APP_ENV": "staging", "PAYMENT_PROVIDER": "dev"}, "PAYMENT_PROVIDER=dev"),
        ("firestore_emulator", {"FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080"}, "EMULATOR_HOST"),
        ("auth_emulator", {"FIREBASE_AUTH_EMULATOR_HOST": "127.0.0.1:9099"}, "EMULATOR_HOST"),
        ("storage_emulator", {"FIREBASE_STORAGE_EMULATOR_HOST": "127.0.0.1:9199"}, "EMULATOR_HOST"),
        ("staging_emulator", {"APP_ENV": "staging", "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080"}, "demo-"),
        ("missing_file_secret", {"FILE_URL_SECRET": None}, "FILE_URL_SECRET"),
        ("short_pii_key", {"PII_HASH_KEY": "short"}, "PII_HASH_KEY"),
        ("missing_otp_key", {"OTP_ENC_KEY": None}, "OTP_ENC_KEY"),
        ("demo_project", {"FIREBASE_PROJECT_ID": "demo-taki"}, "FIREBASE_PROJECT_ID"),
        ("dev_auto_verify", {"DEV_AUTO_VERIFY": "true"}, "DEV_AUTO_VERIFY"),
        ("fake_maps", {"MAPS_PROVIDER": "fake"}, "MAPS_PROVIDER=fake"),
        ("http_public_url", {"PUBLIC_API_BASE_URL": "http://api.taki.example"}, "https"),
    ],
)
def test_unsafe_production_config_refuses_to_start(
    tmp_path: Path, name: str, over: dict[str, str | None], needle: str
) -> None:
    p = boot(tmp_path, **over)
    assert p.returncode != 0, f"{name}: app started"
    assert "ConfigError" in p.stderr and needle in p.stderr, (name, p.stderr[-800:])


@pytest.mark.xfail(
    strict=True,
    reason="T3-4: APP_ENV=production with CASHFREE_ENV=sandbox only logs a warning (and deploy-backend.yml "
    "defaults CASHFREE_ENV to sandbox), so sandbox 'PAID' orders would confirm real bookings",
)
def test_production_refuses_cashfree_sandbox(tmp_path: Path) -> None:
    p = boot(tmp_path, CASHFREE_ENV="sandbox", CASHFREE_APP_ID="TEST_APP", CASHFREE_SECRET_KEY=S32)
    assert p.returncode != 0


def _prod_app() -> Any:
    kw: dict[str, Any] = {**PROD, **{k: None for k in STRIP}}
    kw.pop("LOG_JSON")
    return create_app(Settings(_env_file=None, LOG_JSON=False, **kw))  # type: ignore[call-arg]


async def test_production_app_cors_headers_and_docs() -> None:
    app = _prod_app()
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="https://api.taki.example") as c:
        assert (await c.get("/api/v1/docs")).status_code == 404
        assert (await c.get("/docs")).status_code == 404
        assert (await c.get("/redoc")).status_code == 404
        # openapi.json stays public by design (P2 §14: "always"); it carries no secrets.
        spec = (await c.get("/api/v1/openapi.json")).text
        assert "dev/confirm" not in spec and "cashfree-secret" not in spec

        pre = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization"}
        r = await c.options("/api/v1/auth/login", headers={**pre, "Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in r.headers
        r = await c.options("/api/v1/auth/login", headers={**pre, "Origin": "https://taki.example"})
        assert r.headers.get("access-control-allow-origin") == "https://taki.example"
        assert "access-control-allow-credentials" not in r.headers
        r = await c.get("/api/v1/health", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in r.headers

        for path in ("/api/v1/health", "/api/v1/does-not-exist", "/api/v1/me"):
            r = await c.get(path)
            h = r.headers
            assert h.get("x-content-type-options") == "nosniff", path
            assert h.get("referrer-policy") == "no-referrer", path
            assert h.get("x-frame-options") == "DENY", path
            assert h.get("cache-control") == "no-store", path
            assert h.get("strict-transport-security", "").startswith("max-age="), path
        assert "server" not in {k.lower() for k in r.headers} or "uvicorn" not in r.headers.get("server", "")


def test_dockerfile_and_dockerignore() -> None:
    df = (BACKEND / "Dockerfile").read_text()
    assert re.search(r"^FROM python:3\.12-slim", df, re.M)
    assert re.search(r"^USER (?!root)\S+", df, re.M), "must run as non-root"
    assert "${PORT" in df and "-b 0.0.0.0:${PORT" in df
    assert "uvicorn_worker.UvicornWorker" in df
    assert not re.search(r"(SECRET|KEY|PASSWORD|TOKEN)\w*=\S", df), "no secrets baked into ENV"
    assert not re.search(r"^COPY \. ", df, re.M), "copy only requirements + app/"
    ignore = (BACKEND / ".dockerignore").read_text().splitlines()
    for entry in (".env", "tests/", "app/tests_support/", "scripts/", "*.json.key", "service-account*.json"):
        assert entry in ignore, entry
    # Nothing in the shipped app imports the test fakes excluded from the image.
    for py in (BACKEND / "app").rglob("*.py"):
        if "tests_support" in py.parts:
            continue
        assert "tests_support" not in py.read_text(encoding="utf-8").replace("# ", ""), py


def test_workflows_are_valid_keyless_and_least_privilege() -> None:
    for wf in (REPO / ".github" / "workflows").glob("*.yml"):
        text = wf.read_text()
        doc = yaml.safe_load(text)
        perms = doc.get("permissions")
        assert perms is not None, f"{wf.name}: top-level permissions missing"
        assert perms.get("contents") == "read", wf.name
        assert set(perms) <= {"contents", "id-token"}, (wf.name, perms)
        assert not re.search(r"(AIza[0-9A-Za-z_-]{20,}|-----BEGIN|cfsk_|ghp_)", text), wf.name
        assert "credentials_json" not in text, f"{wf.name}: use WIF, not a key file"
        if wf.name.startswith("deploy-"):
            assert "workload_identity_provider" in text, wf.name
            assert "${{ secrets." not in text, f"{wf.name}: no long-lived GitHub secrets"


def test_env_template_and_apphosting_have_no_secret_values() -> None:
    env = (BACKEND / ".env.example").read_text()
    for name in (
        "FILE_URL_SECRET",
        "PII_HASH_KEY",
        "OTP_ENC_KEY",
        "PASSWORD_PEPPER",
        "CASHFREE_APP_ID",
        "CASHFREE_SECRET_KEY",
        "GOOGLE_MAPS_SERVER_KEY",
        "CRON_SECRET",
        "DEV_PAYMENT_SECRET",
    ):
        m = re.search(rf"^{name}=(.*)$", env, re.M)
        assert m is not None and m.group(1).strip() == "", name
    names = set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]+)=", env, re.M))
    missing = {n for n in Settings.model_fields if n not in names} - {"GOOGLE_MAPS_BROWSER_KEY"}
    assert not missing, missing
    ah = yaml.safe_load((REPO / "apps" / "web" / "apphosting.yaml").read_text())
    for item in ah["env"]:
        if item["variable"] != "NEXT_PUBLIC_APP_ENV":
            assert "secret" in item and "value" not in item, item
        assert "EMULATOR" not in item["variable"] and "DEV_GATEWAY" not in item["variable"], item
