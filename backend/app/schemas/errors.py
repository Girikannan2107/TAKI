"""Error envelope models (OpenAPI documentation of ``{"error": {...}}``)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ErrorDetail(BaseModel):
    code: str
    message: str
    fields: dict[str, str] | None = None
    details: dict[str, Any] | None = None


class ErrorBody(BaseModel):
    error: ErrorDetail


def error_responses(*statuses: int) -> dict[int | str, dict[str, Any]]:
    """``responses=`` mapping for routers (contract §15.7)."""
    return {s: {"model": ErrorBody} for s in statuses}


COMMON_ERRORS = error_responses(400, 401, 403, 429, 503)
