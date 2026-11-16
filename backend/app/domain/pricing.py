"""Pricing v3 (P2 §9.4, ported from ``quoteV2``). PURE. Owner: D4.

All arithmetic is exact: rates are integer paise, outputs integer rupees, and every line is rounded
half-up (``Math.floor((Math.round(paise) + 50) / 100)`` in the TS original). Python's ``round()`` is
banker's rounding and is never used here; :func:`round_half_up` works on ``Decimal``.

``totalPayable == Σ lines.amount`` always.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal
from typing import Any

SERVICE_FEE_SLABS: tuple[tuple[float, int], ...] = (
    (500, 350),
    (1000, 500),
    (2000, 750),
    (float("inf"), 1000),
)
PRICING_VERSION = 3


def _dec(x: int | float | Decimal | str) -> Decimal:
    return x if isinstance(x, Decimal) else Decimal(str(x))


def round_half_up_int(x: int | float | Decimal) -> int:
    """Nearest integer, halves away from zero for positives (JS ``Math.round`` for x ≥ 0)."""
    return int(_dec(x).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def round_half_up(paise: int | float | Decimal) -> int:
    """Integer paise (possibly fractional input) → integer rupees, halves up."""
    p = round_half_up_int(paise)
    return int((Decimal(p + 50) / 100).to_integral_value(rounding=ROUND_FLOOR))


def km1(x: int | float | Decimal) -> float:
    """Kilometres to one decimal, half-up (never binary-float artefacts like 123.39999)."""
    return float(_dec(x).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def service_fee_for(weight_kg: int) -> int:
    for up_to, fee in SERVICE_FEE_SLABS:
        if weight_kg <= up_to:
            return fee
    return SERVICE_FEE_SLABS[-1][1]


def paise_to_rupees_str(paise: int) -> str:
    whole, frac = divmod(int(paise), 100)
    return str(whole) if frac == 0 else f"{whole}.{frac:02d}"


def _fmt_km(km: float) -> str:
    return str(int(km)) if float(km).is_integer() else str(km)


def segment_km(checkpoints: Sequence[Mapping[str, Any]], i: int, j: int) -> float:
    """``cp_j.kmFromOrigin − cp_i.kmFromOrigin`` (Google road km, 1 decimal)."""
    if not (0 <= i < j < len(checkpoints)):
        raise ValueError(f"invalid segment {i}->{j}")
    a = _dec(checkpoints[i].get("kmFromOrigin", 0))
    b = _dec(checkpoints[j].get("kmFromOrigin", 0))
    return km1(b - a)


def applied_charges(
    additional_charges: Iterable[Mapping[str, Any]], special_handling: Sequence[str]
) -> list[Mapping[str, Any]]:
    out = []
    for c in additional_charges or []:
        basis = c.get("basis", "per_booking")
        if basis == "per_booking" or (basis == "special_handling_only" and len(special_handling) > 0):
            out.append(c)
    return out


def quote(
    *,
    segment_km: float,
    weight_kg: int,
    per_km_paise: int,
    per_kg_paise: int,
    additional_charges: Iterable[Mapping[str, Any]] = (),
    special_handling: Sequence[str] = (),
) -> dict[str, Any]:
    """``PricingBreakdown`` v3 as a camelCase dict (stored on the booking and returned as-is)."""
    km = km1(segment_km)
    distance_charge = round_half_up(_dec(km) * int(per_km_paise))
    weight_charge = round_half_up(int(weight_kg) * int(per_kg_paise))
    transportation = distance_charge + weight_charge
    lines: list[dict[str, Any]] = [
        {
            "code": "distance",
            "label": f"Distance ({_fmt_km(km)} km × ₹{paise_to_rupees_str(per_km_paise)}/km)",
            "amount": distance_charge,
        },
        {
            "code": "weight",
            "label": f"Weight ({int(weight_kg)} kg × ₹{paise_to_rupees_str(per_kg_paise)}/kg)",
            "amount": weight_charge,
        },
    ]
    additional = 0
    for c in applied_charges(additional_charges, special_handling):
        amount = int(c.get("amountRupees", 0))
        additional += amount
        lines.append({"code": "additional", "label": str(c.get("label", "Additional charge")), "amount": amount})
    service_fee = service_fee_for(int(weight_kg))
    lines.append({"code": "service_fee", "label": "TAKI service fee", "amount": service_fee})
    total = sum(int(line["amount"]) for line in lines)
    return {
        "pricingVersion": PRICING_VERSION,
        "distanceKm": km,
        "weightKg": int(weight_kg),
        "ratePerKmPaise": int(per_km_paise),
        "ratePerKgPaise": int(per_kg_paise),
        "distanceCharge": distance_charge,
        "weightCharge": weight_charge,
        "transportationCharge": transportation,
        "additionalCharges": additional,
        "handlingFee": additional,  # deprecated alias (contract §1)
        "serviceFee": service_fee,
        "totalPayable": total,
        "agencyNet": transportation + additional,
        "lines": lines,
    }


def quote_for_trip(
    trip: Mapping[str, Any], i: int, j: int, *, weight_kg: int, special_handling: Sequence[str]
) -> dict[str, Any]:
    rates = trip.get("rates") or {}
    return quote(
        segment_km=segment_km(trip.get("checkpoints") or [], i, j),
        weight_kg=weight_kg,
        per_km_paise=int(rates.get("perKmPaise", 0)),
        per_kg_paise=int(rates.get("perKgPaise", 0)),
        additional_charges=trip.get("additionalCharges") or [],
        special_handling=special_handling,
    )


__all__ = [
    "PRICING_VERSION",
    "applied_charges",
    "km1",
    "paise_to_rupees_str",
    "quote",
    "quote_for_trip",
    "round_half_up",
    "round_half_up_int",
    "segment_km",
    "service_fee_for",
]
