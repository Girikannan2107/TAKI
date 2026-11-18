"""Firebase emulator endpoints and data reset helpers (P2 §15.3)."""

from __future__ import annotations

import os

import httpx

PROJECT = os.environ.get("FIREBASE_PROJECT_ID", "demo-taki")
AUTH_HOST = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
FIRESTORE_HOST = os.environ.get("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
STORAGE_HOST = os.environ.get("FIREBASE_STORAGE_EMULATOR_HOST", "127.0.0.1:9199")

AUTH_URL = f"http://{AUTH_HOST}"
FIRESTORE_URL = f"http://{FIRESTORE_HOST}"
IDENTITY_URL = f"{AUTH_URL}/identitytoolkit.googleapis.com/v1"
API_KEY = "fake-api-key"


def emulators_running() -> bool:
    try:
        httpx.get(f"{FIRESTORE_URL}/", timeout=2)
        httpx.get(f"{AUTH_URL}/", timeout=2)
    except httpx.HTTPError:
        return False
    return True


async def clear_firestore(client: httpx.AsyncClient) -> None:
    r = await client.delete(f"{FIRESTORE_URL}/emulator/v1/projects/{PROJECT}/databases/(default)/documents")
    r.raise_for_status()


async def clear_auth(client: httpx.AsyncClient) -> None:
    r = await client.delete(f"{AUTH_URL}/emulator/v1/projects/{PROJECT}/accounts")
    r.raise_for_status()


async def clear_all() -> None:
    async with httpx.AsyncClient(timeout=10) as c:
        await clear_firestore(c)
        await clear_auth(c)
