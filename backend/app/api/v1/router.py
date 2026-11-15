"""Mounts every router under ``/api/v1``.

D3/D4/D5: add your routers to ``_OPTIONAL`` (module path under ``app.api.v1.routers``). Missing
modules are skipped so each agent can land its routers independently; ask D2 to move them to the
explicit list once they exist.
"""

from __future__ import annotations

import importlib
import logging

from fastapi import APIRouter

from app.api.v1.routers import admin, auth, files, health, me, meta, public

log = logging.getLogger("taki.router")

api_router = APIRouter(prefix="/api/v1")
for module in (health, meta, auth, me, public, files, admin):
    api_router.include_router(module.router)

_OPTIONAL = (
    # D3
    "agency_profile",
    "agency_vehicles",
    "agency_drivers",
    "agency_trips",
    "agency_history",
    "agency_earnings",
    "agency_dashboard",
    "driver_profile",
    # D4
    "customer_shipments",
    "customer_search",
    "customer_bookings",
    "customer_dashboard",
    "agency_bookings",
    "driver_app",
    "driver_trips",
    "driver_shipments",
    "notifications",
    "reviews",
    "internal",
    # D5
    "payments",
    "maps",
)

for name in _OPTIONAL:
    try:
        mod = importlib.import_module(f"app.api.v1.routers.{name}")
    except ModuleNotFoundError as e:
        if e.name != f"app.api.v1.routers.{name}":
            raise  # a real import error inside an existing router
        continue
    api_router.include_router(mod.router)
