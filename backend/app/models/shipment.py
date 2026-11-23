"""Shipment documents (P2 §6.4 ``shipments/{shp_*}``, §7.6). Owner: D4.

``status``::

    open ──request──► requested ──payment confirmed──► booked ──pickup──► in_transit ──delivered──► delivered
    requested|booked ──booking closed (rejected/expired/withdrawn/cancelled/refused)──► open
    open ──withdraw (customer)──► withdrawn

Editable (PATCH) only while ``open`` with ``currentBookingId is None``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, TypedDict

ShipmentStatus = Literal["open", "requested", "booked", "in_transit", "delivered", "withdrawn"]
AddressSource = Literal["autocomplete", "current_location", "manual"]


class AddressDoc(TypedDict, total=False):
    line1: str
    line2: str | None
    landmark: str | None
    pincode: str  # format only; never used for matching
    state: str
    place: dict[str, Any]  # PlaceRef (authoritative location)
    source: AddressSource


class ShipmentDoc(TypedDict, total=False):
    id: str
    customerId: str
    source: AddressDoc
    destination: AddressDoc
    receiver: dict[str, str]  # {name, phone (E.164)}
    package: dict[
        str, Any
    ]  # weightKg, goodsCategory, packageType, description, pieces, specialHandling, declaredValueRupees
    shippingDate: str  # IST YYYY-MM-DD
    status: ShipmentStatus
    currentBookingId: str | None
    bookingIds: list[str]
    directDistanceKm: float
    createdAt: datetime
    updatedAt: datetime
    version: int
