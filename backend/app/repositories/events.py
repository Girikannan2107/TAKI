"""Append-only tracking events: ``bookings/{id}/events/{bev_*}`` and ``trips/{id}/events/{tev_*}``. Owner: D4.

``at`` is server time (authoritative ordering); ``seq`` breaks ties between events written in the
same transaction.
"""

from __future__ import annotations

from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.repositories.base import C, get_db, query_docs


def _booking_events(booking_id: str) -> Any:
    return get_db().collection(C.bookings).document(booking_id).collection("events")


def _trip_events(trip_id: str) -> Any:
    return get_db().collection(C.trips).document(trip_id).collection("events")


def tx_add_booking_event(tx: AsyncTransaction, ev: dict[str, Any]) -> None:
    tx.create(_booking_events(ev["bookingId"]).document(ev["id"]), ev)


def tx_add_trip_event(tx: AsyncTransaction, ev: dict[str, Any]) -> None:
    tx.create(_trip_events(ev["tripId"]).document(ev["id"]), ev)


def _ordered(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda e: (e.get("at"), int(e.get("seq") or 0), e["id"]))


async def list_booking_events(booking_id: str, limit: int = 200) -> list[dict[str, Any]]:
    return _ordered(await query_docs(_booking_events(booking_id).order_by("at").limit(limit)))


async def list_trip_events(trip_id: str, limit: int = 200) -> list[dict[str, Any]]:
    return _ordered(await query_docs(_trip_events(trip_id).order_by("at").limit(limit)))
