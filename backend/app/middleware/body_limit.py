"""Body size / content-type gate before parsing (contract §0): JSON 1 MB, multipart 20 MB
(413 ``file_too_large``), other declared body types 415 ``unsupported_media_type``. Pure ASGI.

Also enforces the limit while streaming when ``Content-Length`` is absent (chunked bodies).
"""

from __future__ import annotations

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.constants import MAX_JSON_BYTES, MAX_MULTIPART_BYTES
from app.core.errors import AppError

_BODY_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


async def _reject(send: Send, err: AppError) -> None:
    body = json.dumps(err.body()).encode()
    await send(
        {
            "type": "http.response.start",
            "status": err.status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"cache-control", b"no-store"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class _TooLarge(Exception):
    pass


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") not in _BODY_METHODS:
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        ctype = headers.get("content-type", "").lower()
        length_raw = headers.get("content-length")
        length = int(length_raw) if length_raw and length_raw.isdigit() else None
        multipart = ctype.startswith("multipart/form-data")
        limit = MAX_MULTIPART_BYTES if multipart else MAX_JSON_BYTES
        has_body = (length or 0) > 0 or headers.get("transfer-encoding") == "chunked"
        # No Content-Type is tolerated (webhooks, raw clients); a wrong one is 415.
        if has_body and ctype and not (multipart or "json" in ctype):
            await _reject(send, AppError("unsupported_media_type", "Send this request as application/json."))
            return
        if length is not None and length > limit:
            await _reject(
                send, AppError("file_too_large" if multipart else "invalid_request", "Request body is too large.")
            )
            return

        received = 0
        started = {"v": False}

        async def _receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _TooLarge
            return message

        async def _send(message: Message) -> None:
            if message["type"] == "http.response.start":
                started["v"] = True
            await send(message)

        try:
            await self.app(scope, _receive, _send)
        except _TooLarge:
            if not started["v"]:
                await _reject(
                    send, AppError("file_too_large" if multipart else "invalid_request", "Request body is too large.")
                )
