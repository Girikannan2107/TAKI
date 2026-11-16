"""T3 security suites (owner: T3). Isolation rules:

* Every test runs on the **named** Firestore database ``t3-security`` (``base.use_database``) and
  never calls an emulator wipe endpoint: ids and phone numbers are unique per test instead
  (phones ``+9170030xxxxx``), so the suites can share the emulators with other testers.
* Authentication is **real**: no ``get_current_user`` override. Session tokens are emulator ID
  tokens (``sign_in_provider == "custom"``). In emulator mode the Admin SDK skips the signature
  check, so ``forge_token`` mints unsigned tokens with chosen claims (expired, phone-proof, old
  ``auth_time``). Production verifies Google signatures; the boot guard forbids emulator hosts
  outside development/test (covered in ``test_deployment.py``).
* Payments use D5's ``FakeCashfreeClient`` behind the real ``PaymentService``.
"""

from __future__ import annotations

import base64
import json
import secrets
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from app.core.clock import FrozenClock, get_clock
from app.integrations.cashfree.gateway import CashfreeGateway, GatewayRegistry
from app.integrations.cashfree.settings import PaymentSettings
from app.repositories import base
from app.services.payment_service import PaymentService, get_payment_service, set_payment_service
from app.tests_support.fake_cashfree import TEST_SECRET, FakeCashfreeClient
from tests.support.app import build_app, client_for
from tests.support.builders import Account
from tests.support.emulator import PROJECT, emulators_running

TEST_DATABASE = "t3-security"
_EMU: bool | None = None


def require_emulators() -> None:
    global _EMU
    if _EMU is None:
        _EMU = emulators_running()
    if not _EMU:
        pytest.skip("Firebase emulators are not running (firebase emulators:start --project demo-taki)")


# ── tokens ────────────────────────────────────────────────────────────────────
def _b64(d: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()


def forge_token(
    uid: str,
    *,
    provider: str = "custom",
    phone: str | None = None,
    auth_time: int | None = None,
    exp_in: int = 3600,
    iat: int | None = None,
    **extra: Any,
) -> str:
    """An emulator-style (unsigned) Firebase ID token."""
    now = int(time.time())
    iat = iat if iat is not None else min(now, now + exp_in - 60)
    claims: dict[str, Any] = {
        "iss": f"https://securetoken.google.com/{PROJECT}",
        "aud": PROJECT,
        "auth_time": auth_time if auth_time is not None else iat,
        "iat": iat,
        "exp": now + exp_in,
        "sub": uid,
        "user_id": uid,
        "firebase": {"sign_in_provider": provider, "identities": {}},
        **extra,
    }
    if phone:
        claims["phone_number"] = phone
    return _b64({"alg": "none", "typ": "JWT"}) + "." + _b64(claims) + "."


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def auth(acct: Account, **kw: Any) -> dict[str, str]:
    """Session (custom-provider) bearer header for a builder account."""
    return bearer(forge_token(acct.uid, **kw))


def phone_auth(acct: Account) -> dict[str, str]:
    """A fresh phone-proof token for the account's own uid and phone."""
    return bearer(forge_token(acct.uid, provider="phone", phone=acct.phone))


_ph = {"n": secrets.randbelow(900) * 100}


def t3_phone() -> str:
    _ph["n"] += 1
    return f"+9170030{_ph['n'] % 100000:05d}"


def idem() -> dict[str, str]:
    return {"Idempotency-Key": "t3-" + secrets.token_hex(8)}


def err(r: httpx.Response) -> str:
    try:
        return str(r.json()["error"]["code"])
    except Exception:  # noqa: BLE001
        return f"<{r.status_code}:{r.text[:120]}>"


def cashfree_settings(**kw: Any) -> PaymentSettings:
    base_kw: dict[str, Any] = {
        "APP_ENV": "test",
        "PAYMENT_PROVIDER": "cashfree",
        "CASHFREE_APP_ID": "TEST_APP",
        "CASHFREE_SECRET_KEY": TEST_SECRET,
        "CASHFREE_ENV": "sandbox",
        "APP_ORIGIN": "http://localhost:3000",
        "PUBLIC_API_BASE_URL": "http://localhost:8000",
    }
    base_kw.update(kw)
    return PaymentSettings(_env_file=None, **base_kw)  # type: ignore[call-arg]


# ── fixtures ──────────────────────────────────────────────────────────────────
@pytest.fixture
async def t3_db() -> AsyncIterator[None]:
    require_emulators()
    base.use_database(TEST_DATABASE)
    try:
        yield
    finally:
        await base.close_named_clients()
        base.use_database(None)


@pytest.fixture(autouse=True)
def _real_bearer_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    """D3/D4 builders expose ``Account.headers`` as the ``X-Test-Uid`` override header; here the
    same property yields a real Bearer token so every request runs the real ``get_current_user``."""
    monkeypatch.setattr(Account, "headers", property(lambda self: bearer(forge_token(self.uid))))
    # The t3-security database is never wiped, so registration numbers must not repeat across runs.
    import tests.support.builders as builders

    def _reg() -> str:
        letters = "".join(secrets.choice("ABCDEFGHJKLMNPRSTUVWXYZ") for _ in range(2))
        return f"TN{10 + secrets.randbelow(89):02d}{letters}{secrets.randbelow(10_000):04d}"

    monkeypatch.setattr(builders, "next_reg", _reg)


@pytest.fixture
def fake_cf() -> FakeCashfreeClient:
    return FakeCashfreeClient()


@pytest.fixture
def payments(t3_db: None, fake_cf: FakeCashfreeClient) -> AsyncIterator[PaymentService]:
    svc = PaymentService(GatewayRegistry(cashfree_settings(), cashfree=CashfreeGateway(fake_cf, "sandbox")))
    set_payment_service(svc)
    yield svc  # type: ignore[misc]
    set_payment_service(None)


@pytest.fixture
def clock() -> FrozenClock:
    from datetime import UTC, datetime

    return FrozenClock(datetime.now(UTC).replace(microsecond=0))


@pytest.fixture
def sec_app(t3_db: None, payments: PaymentService, clock: FrozenClock) -> FastAPI:
    app = build_app()
    app.dependency_overrides[get_payment_service] = lambda: payments
    app.dependency_overrides[get_clock] = lambda: clock
    return app


@pytest.fixture
async def http(sec_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with client_for(sec_app) as c:
        yield c
