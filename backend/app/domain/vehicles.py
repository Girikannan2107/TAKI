"""Vehicle registration normalisation and catalogue (port of ``normalizeReg`` / ``isValidReg`` and
``lib/domain/vehicles.ts``). PURE. Owner: D3."""

from __future__ import annotations

import re
from typing import Any

from app.data import vehicle_models

REG_RE = re.compile(r"^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$")
BH_RE = re.compile(r"^(\d{2})BH(\d{4})([A-Z]{1,2})$")
REG_MESSAGE = "Enter a valid registration number, e.g. TN 37 XX 4587"

CLASS_IMAGE: dict[str, str] = {
    "Mini Truck": "mini_delivery_truck_taki",
    "Pickup": "medium_box_truck_generic",
    "Light Truck": "light_cargo_lorry_taki",
    "Medium Truck": "medium_cargo_truck_taki",
    "Heavy Truck": "large_curtainside_lorry_taki",
}
MAX_VEHICLE_PHOTOS = 5


def compact(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def normalize_reg(value: str) -> str:
    """``"tn37xx4587"`` → ``"TN 37 XX 4587"``; BH ``"22BH1234AA"`` → ``"22 BH 1234 AA"``.
    Unknown shapes are upper-cased with collapsed spaces (and then fail ``is_valid_reg``)."""
    c = compact(value)
    bh = BH_RE.match(c)
    if bh:
        return f"{bh[1]} BH {bh[2]} {bh[3]}"
    m = REG_RE.match(c)
    if not m:
        return re.sub(r"\s+", " ", (value or "").strip().upper())
    parts = [m[1], m[2].zfill(2), m[3], m[4].zfill(4)]
    return " ".join(p for p in parts if p)


def is_valid_reg(normalized: str) -> bool:
    c = normalized.replace(" ", "")
    return bool(BH_RE.match(c)) or (bool(REG_RE.match(c)) and len(c) >= 6)


def registration_key(normalized: str) -> str:
    return normalized.replace(" ", "")


def vehicle_model(model_id: str | None) -> dict[str, Any] | None:
    if not model_id:
        return None
    return next((m for m in vehicle_models() if m["id"] == model_id), None)


def image_key_for(vehicle_class: str, model_id: str | None) -> str:
    m = vehicle_model(model_id)
    return str(m["imageKey"]) if m else CLASS_IMAGE.get(vehicle_class, "medium_cargo_truck_taki")


def mask_registration(normalized: str) -> str:
    """RC number masking (P2 §12.2): everything except the last 4 characters replaced with X."""
    c = normalized.replace(" ", "")
    return "X" * max(0, len(c) - 4) + c[-4:]
