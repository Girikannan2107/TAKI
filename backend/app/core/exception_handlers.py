"""Exception → error envelope mapping (P2 §2.1, §3)."""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from google.api_core import exceptions as gexc
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.errors import AppError

log = logging.getLogger("taki.errors")

_LOC_ROOTS = {"body", "query", "path", "header", "cookie"}


def _path(loc: Sequence[Any], err_type: str) -> str:
    parts = list(loc)
    if parts and parts[0] in _LOC_ROOTS:
        parts = parts[1:]
    if err_type.startswith("field:"):
        parts = [*parts, err_type[len("field:") :]]
    # drop pydantic's internal tags (e.g. function-after[...]) that can appear in loc
    clean = [str(p) for p in parts if not (isinstance(p, str) and ("[" in p and "]" in p))]
    return ".".join(clean) or "_"


def validation_fields(errors: Sequence[Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for e in errors:
        key = _path(e.get("loc", ()), str(e.get("type", "")))
        out.setdefault(key, str(e.get("msg", "Invalid value")).removeprefix("Value error, "))
    return out


def validation_error(errors: Sequence[Any]) -> AppError:
    # Contract §0: a malformed path id is a 404, like a missing resource.
    if any(tuple(e.get("loc", ()))[:1] == ("path",) for e in errors):
        return AppError("not_found")
    if any(e.get("type") == "json_invalid" for e in errors):
        return AppError("invalid_request", "The request body is not valid JSON.")
    return AppError("invalid_request", fields=validation_fields(errors))


def error_response(err: AppError) -> JSONResponse:
    headers = {"Cache-Control": "no-store", **(err.headers or {})}
    retry = (err.details or {}).get("retryAfterSeconds")
    if isinstance(retry, int | float) and "Retry-After" not in headers:
        headers["Retry-After"] = str(max(1, int(retry)))
    return JSONResponse(err.body(), status_code=err.status, headers=headers)


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return error_response(exc)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(validation_error(exc.errors()))

    @app.exception_handler(ValidationError)
    async def _pyd_validation(_: Request, exc: ValidationError) -> JSONResponse:
        # A response/DTO model failing validation is a server bug, not a client error.
        log.error("response validation failed", exc_info=exc)
        return error_response(AppError("internal"))

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            return error_response(AppError("not_found"))
        if exc.status_code == 405:
            return error_response(AppError("method_not_allowed"))
        if exc.status_code == 401:
            return error_response(AppError("unauthenticated"))
        if exc.status_code == 403:
            return error_response(AppError("forbidden"))
        return error_response(
            AppError("invalid_request", str(exc.detail) if exc.detail else None, status=exc.status_code)
        )

    @app.exception_handler(gexc.Aborted)
    async def _aborted(_: Request, exc: gexc.Aborted) -> JSONResponse:
        return error_response(AppError("contention"))

    @app.exception_handler(gexc.ServiceUnavailable)
    async def _unavailable(_: Request, exc: gexc.ServiceUnavailable) -> JSONResponse:
        log.warning("database unavailable: %s", exc.__class__.__name__)
        return error_response(AppError("database_unavailable"))

    @app.exception_handler(gexc.DeadlineExceeded)
    async def _deadline(_: Request, exc: gexc.DeadlineExceeded) -> JSONResponse:
        return error_response(AppError("database_unavailable"))

    @app.exception_handler(Exception)
    async def _internal(_: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled error", exc_info=exc)
        return error_response(AppError("internal"))
