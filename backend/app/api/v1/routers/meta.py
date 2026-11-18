"""E3: public metadata (enums, limits, feature flags)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response

from app.core.config import get_settings
from app.core.constants import LIMITS, STATE_NAMES
from app.models.enums import (
    BODY_TYPES,
    GOODS_CATEGORIES,
    PACKAGE_TYPES,
    SPECIAL_HANDLING,
    VEHICLE_CLASSES,
    VEHICLE_COUNT_RANGES,
)

router = APIRouter(tags=["meta"])


@router.get("/meta")
async def meta(response: Response) -> dict[str, Any]:
    s = get_settings()
    response.headers["Cache-Control"] = "public, max-age=300"
    return {
        "states": [{"code": c, "name": STATE_NAMES.get(c, c)} for c in s.SERVICE_STATES],
        "goodsCategories": list(GOODS_CATEGORIES),
        "packageTypes": list(PACKAGE_TYPES),
        "specialHandling": list(SPECIAL_HANDLING),
        "vehicleClasses": list(VEHICLE_CLASSES),
        "bodyTypes": list(BODY_TYPES),
        "vehicleCountRanges": list(VEHICLE_COUNT_RANGES),
        "limits": LIMITS,
        "features": {
            "paymentsConfigured": s.payments_configured,
            "devPaymentGateway": s.dev_payment_gateway_enabled,
            "mapsConfigured": s.maps_configured,
            "requireDeliveryProof": s.REQUIRE_DELIVERY_PROOF,
        },
    }
