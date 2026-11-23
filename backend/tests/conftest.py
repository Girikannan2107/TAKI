"""Shared pytest fixtures. Integration tests run against the Firebase emulators
(auth 127.0.0.1:9099, firestore 127.0.0.1:8080, storage 127.0.0.1:9199, project demo-taki);
Firestore and Auth data are wiped before every test that uses ``client``.
"""

from __future__ import annotations

import os

# Must be set before ``app`` is imported (settings are cached).
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("FIREBASE_PROJECT_ID", "demo-taki")
os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
os.environ.setdefault("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
os.environ.setdefault("FIREBASE_STORAGE_EMULATOR_HOST", "127.0.0.1:9199")
os.environ.setdefault("LOG_JSON", "false")
os.environ.setdefault("LOG_LEVEL", "WARNING")

from collections.abc import AsyncGenerator  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402

from app.integrations.firebase.app import close_firestore  # noqa: E402
from tests.support.app import build_app, client_for  # noqa: E402
from tests.support.emulator import clear_all, emulators_running  # noqa: E402

_EMULATORS: bool | None = None


def _require_emulators() -> None:
    global _EMULATORS
    if _EMULATORS is None:
        _EMULATORS = emulators_running()
    if not _EMULATORS:
        pytest.skip("Firebase emulators are not running (firebase emulators:start --project demo-taki)")


@pytest.fixture
def app() -> FastAPI:
    return build_app()


@pytest.fixture
async def client(app: FastAPI) -> AsyncGenerator[httpx.AsyncClient]:
    _require_emulators()
    await clear_all()
    async with client_for(app) as c:
        yield c
    await close_firestore()
