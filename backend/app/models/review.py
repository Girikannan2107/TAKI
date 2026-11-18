"""Reviews (P2 §6.4 ``reviews/{bookingId}``): one per delivered booking, written by its customer. Owner: D4."""

from __future__ import annotations

from datetime import datetime
from typing import TypedDict


class ReviewDoc(TypedDict):
    id: str  # = bookingId
    bookingId: str
    customerId: str
    customerFirstName: str
    driverId: str
    agencyId: str
    tripId: str
    rating: int  # 1..5
    comment: str | None
    createdAt: datetime
