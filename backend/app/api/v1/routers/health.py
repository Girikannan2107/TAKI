"""E1–E2: liveness and readiness."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app import __version__
from app.core.config import get_settings
from app.integrations.firebase.app import auth_mode
from app.repositories.base import get_db
from app.schemas.common import CamelModel

router = APIRouter(tags=["health"])


class HealthDTO(CamelModel):
    ok: bool
    version: str
    env: str


class ReadyDTO(CamelModel):
    ok: bool
    firestore: str
    auth: str
    payments: str
    maps: str


@router.get("/health", response_model=HealthDTO)
async def health() -> HealthDTO:
    return HealthDTO(ok=True, version=__version__, env=get_settings().APP_ENV)


@router.get("/health/ready", response_model=ReadyDTO, responses={503: {"model": ReadyDTO}})
async def ready() -> JSONResponse:
    s = get_settings()
    firestore = "ok"
    try:
        await asyncio.wait_for(get_db().collection("_health").document("probe").get(), timeout=3)
    except Exception:
        firestore = "error"
    body = ReadyDTO(
        ok=firestore == "ok",
        firestore=firestore,
        auth=auth_mode(),
        payments="configured" if s.payments_configured else "not_configured",
        maps="configured" if s.maps_configured else "not_configured",
    )
    return JSONResponse(body.model_dump(by_alias=True), status_code=200 if body.ok else 503)
