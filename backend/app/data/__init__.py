"""Shared reference data (00-target-architecture §2 "Shared data"): one source of truth for the
backend and (via generated TypeScript types) ``apps/web``. Generated from ``apps/web/src/lib/domain``.

* ``vehicle_models.json`` — vehicle catalogue (id, label, class, payload, illustration key)
* ``goods.json``          — goods categories, package types, special handling, vehicle classes, body types
* ``pricing.json``        — service-fee slabs, rate limits, default draft rates, trip timing constants
* ``districts.json`` / ``checkpoint_places.json`` — legacy district/hub reference (display only;
  v3 matching uses Google place ids and coordinates, never districts or pincodes)
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent


@cache
def load(name: str) -> Any:
    with (DATA_DIR / name).open(encoding="utf-8") as f:
        return json.load(f)


def vehicle_models() -> list[dict[str, Any]]:
    return list(load("vehicle_models.json")["models"])


def pricing() -> dict[str, Any]:
    return dict(load("pricing.json"))


def trip_constants() -> dict[str, Any]:
    return dict(load("pricing.json")["trip"])


def goods() -> dict[str, list[str]]:
    return dict(load("goods.json"))
