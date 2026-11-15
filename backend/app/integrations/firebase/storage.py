"""Cloud Storage (Firebase bucket) put/get/delete through the Admin SDK, run in a worker thread."""

from __future__ import annotations

import anyio
from firebase_admin import storage
from google.api_core import exceptions as gexc

from app.integrations.firebase.app import init_firebase


def _bucket():  # type: ignore[no-untyped-def]
    init_firebase()
    return storage.bucket()


async def put_object(path: str, data: bytes, content_type: str) -> None:
    def _put() -> None:
        blob = _bucket().blob(path)
        blob.cache_control = "private, max-age=0, no-store"
        blob.upload_from_string(data, content_type=content_type)

    await anyio.to_thread.run_sync(_put)


async def get_object(path: str) -> bytes | None:
    def _get() -> bytes | None:
        try:
            return bytes(_bucket().blob(path).download_as_bytes())
        except gexc.NotFound:
            return None

    return await anyio.to_thread.run_sync(_get)


async def delete_object(path: str) -> None:
    def _delete() -> None:
        try:
            _bucket().blob(path).delete()
        except gexc.NotFound:
            pass

    await anyio.to_thread.run_sync(_delete)
