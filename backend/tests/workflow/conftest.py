"""T2 workflow suite fixtures (P3 §6.2). Owner: T2.

Isolation: every T2 test runs on the **named** Firestore database ``t2-workflow`` (other suites wipe
``(default)`` and Auth). The database is wiped **once per session** (at start) and the data is kept
afterwards for inspection and for ``scripts/check_invariants.py --database t2-workflow``.

Authentication is real: phone-proof tokens from the Auth emulator (OTP read from the emulator),
signup/login through the API, custom-token exchange. Nothing overrides ``get_current_user``.

Two transports:
* default — the app in-process (``httpx.ASGITransport``) with a controllable clock and a payment
  registry that holds both the dev test gateway and D5's ``FakeCashfreeClient``;
* ``T2_BASE_URL=http://127.0.0.1:8020`` — the live uvicorn server started with ``serve.py``
  (dev gateway, real time); clock- and Cashfree-dependent tests are skipped.
"""

from __future__ import annotations

import os

os.environ["APP_ENV"] = "test"
os.environ["PAYMENT_PROVIDER"] = "dev"
os.environ.setdefault("CRON_SECRET", "t2-cron-secret-0123456789")
os.environ.setdefault("FIREBASE_PROJECT_ID", "demo-taki")
os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
os.environ.setdefault("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
os.environ.setdefault("FIREBASE_STORAGE_EMULATOR_HOST", "127.0.0.1:9199")

from collections.abc import AsyncIterator  # noqa: E402
from datetime import UTC, datetime  # noqa: E402
from typing import Any  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

from app.core import clock as clock_mod  # noqa: E402
from app.core.clock import FrozenClock, get_clock  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.integrations.cashfree.settings import get_payment_settings  # noqa: E402
from app.repositories import base  # noqa: E402
from app.services.payment_service import get_payment_service, set_payment_service  # noqa: E402
from app.tests_support.fake_cashfree import FakeCashfreeClient  # noqa: E402
from tests.support.emulator import emulators_running  # noqa: E402
from tests.workflow import support as S  # noqa: E402

get_settings.cache_clear()
get_payment_settings.cache_clear()

LIVE_URL = os.environ.get("T2_BASE_URL")


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "inprocess: needs the in-process app (clock / FakeCashfree control)")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if not LIVE_URL:
        return
    skip = pytest.mark.skip(reason="needs the in-process app (T2_BASE_URL is set)")
    for item in items:
        if "inprocess" in item.keywords and "tests/workflow" in str(item.fspath).replace("\\", "/"):
            item.add_marker(skip)


@pytest.fixture(scope="session", autouse=True)
def t2_database() -> None:
    if not emulators_running():
        pytest.skip("Firebase emulators are not running")
    base.use_database(S.TEST_DATABASE)
    S.wipe_named_database_sync()


@pytest.fixture
def clock() -> FrozenClock:
    return FrozenClock(datetime.now(UTC).replace(microsecond=0))


@pytest.fixture
def fake_cf() -> FakeCashfreeClient:
    return FakeCashfreeClient()


@pytest.fixture
def registry(fake_cf: FakeCashfreeClient) -> S.SwitchableRegistry:
    return S.make_registry(fake_cf)


@pytest.fixture
async def api(
    clock: FrozenClock, registry: S.SwitchableRegistry, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[httpx.AsyncClient]:
    hooks: dict[str, Any] = {"response": [S.contract_hook]}
    if LIVE_URL:
        async with httpx.AsyncClient(base_url=LIVE_URL, timeout=60, event_hooks=hooks) as c:
            c.live = True  # type: ignore[attr-defined]
            yield c
        await base.close_named_clients()
        return
    from app.main import create_app
    from app.services.payment_service import PaymentService

    monkeypatch.setattr(clock_mod, "_system", clock)
    svc = PaymentService(registry)
    set_payment_service(svc)
    app = create_app(get_settings())
    app.dependency_overrides[get_clock] = lambda: clock
    app.dependency_overrides[get_payment_service] = lambda: svc
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://t2", timeout=60, event_hooks=hooks) as c:
        c.live = False  # type: ignore[attr-defined]
        yield c
    set_payment_service(None)
    await base.close_named_clients()


def pytest_terminal_summary(terminalreporter: Any) -> None:
    if not S.CONTRACT_NOTES:
        return
    terminalreporter.section("T2 contract notes (soft checks)")
    for note in sorted(S.CONTRACT_NOTES):
        terminalreporter.write_line(note)
