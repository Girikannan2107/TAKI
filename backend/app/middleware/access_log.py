"""Access log: method, route template, status, latency, uid — never bodies or tokens. Pure ASGI."""

from __future__ import annotations

import logging
import time

from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger("taki.access")


class AccessLogMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        start = time.perf_counter()
        status = {"code": 500}

        async def _send(message: Message) -> None:
            if message["type"] == "http.response.start":
                status["code"] = int(message["status"])
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            route = scope.get("route")
            state = scope.get("state") or {}
            log.info(
                "request",
                extra={
                    "fields": {
                        "method": scope.get("method"),
                        "route": getattr(route, "path", None) or "unmatched",
                        "status": status["code"],
                        "latencyMs": round((time.perf_counter() - start) * 1000, 1),
                        "uid": state.get("uid"),
                    }
                },
            )
