"""firebase-admin initialisation (once per process), emulator-aware (P2 §2, §4).

* Emulators: ``FIRESTORE_EMULATOR_HOST``, ``FIREBASE_AUTH_EMULATOR_HOST`` and
  ``FIREBASE_STORAGE_EMULATOR_HOST`` are exported to ``os.environ`` (the Google client libraries
  read them from there) and anonymous credentials are used.
* Production / staging: Application Default Credentials (the Cloud Run service account).
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from typing import Any

import firebase_admin
from firebase_admin import credentials
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore

from app.core.config import Settings, get_settings

log = logging.getLogger("taki.firebase")

_lock = threading.Lock()
_APP_NAME = "[DEFAULT]"


class _EmulatorCredential(credentials.Base):
    """Anonymous credentials for the local emulators (no ADC needed)."""

    def get_credential(self) -> Any:
        return AnonymousCredentials()


def _export_emulator_env(s: Settings) -> None:
    if s.FIRESTORE_EMULATOR_HOST:
        os.environ["FIRESTORE_EMULATOR_HOST"] = s.FIRESTORE_EMULATOR_HOST
    if s.FIREBASE_AUTH_EMULATOR_HOST:
        os.environ["FIREBASE_AUTH_EMULATOR_HOST"] = s.FIREBASE_AUTH_EMULATOR_HOST
    if s.FIREBASE_STORAGE_EMULATOR_HOST:
        os.environ["FIREBASE_STORAGE_EMULATOR_HOST"] = s.FIREBASE_STORAGE_EMULATOR_HOST
        host = s.FIREBASE_STORAGE_EMULATOR_HOST
        # google-cloud-storage reads STORAGE_EMULATOR_HOST (with scheme).
        os.environ["STORAGE_EMULATOR_HOST"] = host if host.startswith("http") else f"http://{host}"
    os.environ.setdefault("GOOGLE_CLOUD_PROJECT", s.FIREBASE_PROJECT_ID)


def init_firebase(settings: Settings | None = None) -> firebase_admin.App:
    """Initialise the default firebase-admin app once (idempotent, thread-safe)."""
    s = settings or get_settings()
    with _lock:
        try:
            return firebase_admin.get_app(_APP_NAME)
        except ValueError:
            pass
        _export_emulator_env(s)
        cred: credentials.Base
        if s.uses_emulators:
            cred = _EmulatorCredential()
        elif s.GOOGLE_APPLICATION_CREDENTIALS:
            cred = credentials.Certificate(s.GOOGLE_APPLICATION_CREDENTIALS)
        else:
            cred = credentials.ApplicationDefault()
        app = firebase_admin.initialize_app(
            cred,
            {"projectId": s.FIREBASE_PROJECT_ID, "storageBucket": s.FIREBASE_STORAGE_BUCKET},
        )
        log.info(
            "firebase initialised",
            extra={
                "fields": {
                    "project": s.FIREBASE_PROJECT_ID,
                    "emulators": s.uses_emulators,
                }
            },
        )
        return app


# ── Firestore AsyncClient (one per event loop: grpc.aio channels are loop-bound) ──
_db_cache: dict[int, firestore.AsyncClient] = {}


def get_firestore() -> firestore.AsyncClient:
    s = get_settings()
    init_firebase(s)
    try:
        loop_id = id(asyncio.get_running_loop())
    except RuntimeError:
        loop_id = 0
    client = _db_cache.get(loop_id)
    if client is None:
        if s.uses_emulators:
            client = firestore.AsyncClient(project=s.FIREBASE_PROJECT_ID, credentials=AnonymousCredentials())
        else:
            app = firebase_admin.get_app()
            client = firestore.AsyncClient(project=s.FIREBASE_PROJECT_ID, credentials=app.credential.get_credential())
        _db_cache[loop_id] = client
    return client


async def close_firestore() -> None:
    """Close the current event loop's client (app shutdown, test teardown)."""
    try:
        loop_id = id(asyncio.get_running_loop())
    except RuntimeError:
        return
    client = _db_cache.pop(loop_id, None)
    if client is None:
        return
    # AsyncClient has no public close(); the grpc.aio channel must be closed on its own loop,
    # otherwise a later GC joins its poller thread after the loop is gone (deadlock).
    try:
        transport = client._firestore_api.transport
        res = transport.close()
        if asyncio.iscoroutine(res) or isinstance(res, asyncio.Future):
            await res
    except Exception:  # best effort at shutdown
        log.debug("firestore client close failed", exc_info=True)


def auth_mode() -> str:
    return "emulator" if get_settings().FIREBASE_AUTH_EMULATOR_HOST else "live"
