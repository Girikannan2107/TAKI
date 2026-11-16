"""FastAPI application factory (P2 §2, §2.1).

Middleware order, outermost first: RequestId → AccessLog → SecurityHeaders → CORS → BodyLimit.
OpenAPI at ``/api/v1/openapi.json`` always; Swagger UI at ``/api/v1/docs`` outside production.
``check_boot_guards`` runs at construction, so an unsafe configuration fails before serving.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.v1.router import api_router
from app.core.config import Settings, check_boot_guards, get_settings, run_integration_startup_checks
from app.core.exception_handlers import install_exception_handlers
from app.core.logging import configure_logging
from app.integrations.firebase.app import close_firestore, init_firebase
from app.middleware.access_log import AccessLogMiddleware
from app.middleware.body_limit import BodyLimitMiddleware
from app.middleware.request_id import RequestIdMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware


def create_app(settings: Settings | None = None) -> FastAPI:
    s = settings or get_settings()
    configure_logging(s.LOG_LEVEL, s.LOG_JSON)
    check_boot_guards(s)
    run_integration_startup_checks()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        init_firebase(s)
        from app.repositories.caches import install_maps_cache  # D3: Firestore-backed Maps cache

        install_maps_cache()
        yield
        await close_firestore()

    app = FastAPI(
        title="TAKI API",
        version=__version__,
        lifespan=lifespan,
        openapi_url="/api/v1/openapi.json",
        docs_url=None if s.is_production else "/api/v1/docs",
        redoc_url=None,
    )
    install_exception_handlers(app)
    app.include_router(api_router)

    # add_middleware prepends: the last added is the outermost.
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.CORS_ALLOWED_ORIGINS,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Phone-Proof", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Retry-After"],
        max_age=600,
    )
    app.add_middleware(SecurityHeadersMiddleware, hsts=not s.is_dev)
    app.add_middleware(AccessLogMiddleware)
    app.add_middleware(RequestIdMiddleware)
    app.state.settings = s
    return app


app = create_app()
