"""T3 · Forwarded-IP handling end to end (T3-1 retest): a real uvicorn server on port 8030 configured
like the container's ``UvicornWorker`` (``proxy_headers`` on, ``forwarded_allow_ips`` = gunicorn's
default ``127.0.0.1,::1`` because the Dockerfile no longer passes ``--forwarded-allow-ips``), with
``TRUST_PROXY_HEADERS=true``. Spoofed left-most ``X-Forwarded-For`` entries must not create new
rate-limit buckets; the proxy-appended right-most entry is the key.

The server runs on the named database ``t3-security`` and is always stopped in ``finally``."""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

from tests.security.conftest import require_emulators

pytestmark = [pytest.mark.emulator, pytest.mark.slow]
BACKEND = Path(__file__).resolve().parents[2]
PORT = 8030
LAUNCH = f"""
import uvicorn
from app.core import constants
from app.repositories import base
base.use_database("t3-security")
constants.RATE_LIMITS["login_ip"] = (3, 900)
constants.RATE_LIMITS["login_phone"] = (1000, 900)
uvicorn.run("app.main:app", host="127.0.0.1", port={PORT}, proxy_headers=True,
            forwarded_allow_ips="127.0.0.1,::1", log_level="warning")
"""


def test_dockerfile_does_not_trust_every_forwarder() -> None:
    df = (BACKEND / "Dockerfile").read_text()
    cmd = df[df.index("CMD") :]
    assert "--forwarded-allow-ips" not in cmd and "FORWARDED_ALLOW_IPS" not in df
    assert "--proxy-headers" not in cmd or "forwarded" not in cmd


@pytest.fixture
def server(tmp_path: Path):  # type: ignore[no-untyped-def]
    require_emulators()
    env = {k: v for k, v in os.environ.items() if not k.startswith(("TRUST", "FORWARDED"))}
    env.update(
        {
            "PYTHONPATH": str(BACKEND),
            "APP_ENV": "test",
            "FIREBASE_PROJECT_ID": "demo-taki",
            "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080",
            "FIREBASE_AUTH_EMULATOR_HOST": "127.0.0.1:9099",
            "FIREBASE_STORAGE_EMULATOR_HOST": "127.0.0.1:9199",
            "TRUST_PROXY_HEADERS": "true",
            "TRUSTED_PROXY_HOPS": "1",
            "PAYMENT_PROVIDER": "cashfree",
            "LOG_JSON": "false",
            "LOG_LEVEL": "WARNING",
        }
    )
    proc = subprocess.Popen(  # noqa: S603 - fixed argv: this interpreter + a constant script
        [sys.executable, "-c", LAUNCH], cwd=tmp_path, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )
    try:
        base_url = f"http://127.0.0.1:{PORT}"
        for _ in range(60):
            if proc.poll() is not None:
                raise RuntimeError(proc.stdout.read().decode() if proc.stdout else "server exited")
            try:
                if httpx.get(f"{base_url}/api/v1/health", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.5)
        else:
            raise RuntimeError("server did not start on port 8030")
        yield base_url
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def _phone() -> str:
    return "+9170030" + f"{secrets.randbelow(100000):05d}"


def _login(c: httpx.Client, xff: str | None) -> int:
    headers = {"X-Forwarded-For": xff} if xff else {}
    r = c.post(
        "/api/v1/auth/login",
        json={"role": "customer", "phone": _phone(), "password": "Wrong-pass1"},
        headers=headers,
    )
    return r.status_code


def test_spoofed_forwarded_for_cannot_dodge_the_login_ip_limit(server: str) -> None:
    real = f"203.0.113.{1 + secrets.randbelow(250)}"
    other = f"198.18.{secrets.randbelow(250)}.{1 + secrets.randbelow(250)}"
    with httpx.Client(base_url=server, timeout=20) as c:
        # Rotating client-supplied left-most entries, proxy-appended real address on the right.
        spoofed = [_login(c, f"198.51.100.{i + 1}, {real}") for i in range(5)]
        assert spoofed[:3] == [401, 401, 401] and spoofed[3:] == [429, 429], spoofed
        # Several X-Forwarded-For header lines are joined in order; the last entry still wins.
        r = c.post(
            "/api/v1/auth/login",
            json={"role": "customer", "phone": _phone(), "password": "Wrong-pass1"},
            headers=[("X-Forwarded-For", "192.0.2.50"), ("X-Forwarded-For", real)],
        )
        assert r.status_code == 429
        assert r.headers.get("Retry-After"), r.headers
        # A different real client address has its own window.
        assert _login(c, f"198.51.100.200, {other}") == 401
        # Garbage in the client-controlled part does not crash or change the key.
        assert _login(c, f"not-an-ip, , {real}") == 429
