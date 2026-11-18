"""Earnings and settlements (contract E85, E122–E124; port of ``core/earnings.ts``). Owner: D3.

Read-only for agencies (owner decision: no withdrawals). Earnings are created by D4's ``deliver``
transaction (one ``earnings/{bookingId}`` per delivered booking, ``pending``); admins record bank
settlements (E123), which mark the agency's pending earnings delivered up to an IST date as ``settled``.
Nothing is estimated or seeded: every number is a sum over real documents.

D2's admin console calls :func:`pending_settlements_by_agency`, :func:`record_settlement` and
:func:`settlement_history` (``admin_service._earnings()``).
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, datetime
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.ids import new_id
from app.core.time import ist_date_of, ist_end_of_day_utc
from app.repositories import agencies as agencies_repo
from app.repositories import earnings as earnings_repo
from app.repositories import settlements as settlements_repo
from app.repositories.base import C, get_many, run_transaction
from app.schemas.agency import (
    AgencyEarningRowDTO,
    AgencyEarningsDTO,
    AgencyPaymentRowDTO,
    AgencySettlementDTO,
    EarningsByTripDTO,
    EarningsSummaryDTO,
    MonthAmount,
)
from app.services.agency_service import agency_id_of, month_key, shift_month

MAX_PER_SETTLEMENT = 400
MOVED_PAYMENT_STATUSES = ["succeeded", "refund_pending", "refunded", "refund_failed"]


# ── Pure aggregation ──────────────────────────────────────────────────────────
def aggregate(earnings: Sequence[dict[str, Any]], now: datetime) -> dict[str, Any]:
    this = month_key(now)
    last = shift_month(this, -1)
    summary = {"total": 0, "pending": 0, "settled": 0, "on_hold": 0, "this_month": 0, "last_month": 0}
    months = {shift_month(this, -k): 0 for k in range(5, -1, -1)}
    trips: dict[str, dict[str, Any]] = {}
    for e in earnings:
        net = int(e.get("agencyNet", 0))
        summary["total"] += net
        status = e.get("status", "pending")
        summary["pending" if status == "pending" else "settled" if status == "settled" else "on_hold"] += net
        m = month_key(e["deliveredAt"])
        if m == this:
            summary["this_month"] += net
        if m == last:
            summary["last_month"] += net
        if m in months:
            months[m] += net
        t = trips.setdefault(
            e.get("tripId", ""),
            {
                "trip_id": e.get("tripId", ""),
                "route_label": e.get("routeLabel", ""),
                "delivered_bookings": 0,
                "agency_net": 0,
                "last_delivered_at": e["deliveredAt"],
            },
        )
        t["delivered_bookings"] += 1
        t["agency_net"] += net
        if e["deliveredAt"] > t["last_delivered_at"]:
            t["last_delivered_at"] = e["deliveredAt"]
    return {
        "summary": summary,
        "monthly_series": [{"month": m, "amount": a} for m, a in months.items()],
        "by_trip": sorted(trips.values(), key=lambda t: t["last_delivered_at"], reverse=True),
    }


def _row(e: dict[str, Any]) -> AgencyEarningRowDTO:
    extra = int(e.get("additionalCharges", e.get("handlingFee", 0)) or 0)
    return AgencyEarningRowDTO(
        booking_id=e.get("bookingId", e["id"]),
        trip_id=e.get("tripId", ""),
        route_label=e.get("routeLabel", ""),
        customer_paid=int(e.get("customerPaid", 0)),
        transportation_charge=int(e.get("transportationCharge", 0)),
        additional_charges=extra,
        handling_fee=extra,
        platform_fee=int(e.get("platformFee", 0)),
        agency_net=int(e.get("agencyNet", 0)),
        delivered_at=e["deliveredAt"],
        status=e.get("status", "pending"),
        settled_at=e.get("settledAt"),
    )


def _payment_row(p: Any) -> AgencyPaymentRowDTO:
    conf = getattr(p, "confirmation", None)
    paid_at = conf.at if conf is not None and p.status in MOVED_PAYMENT_STATUSES else None
    return AgencyPaymentRowDTO(
        id=p.id,
        booking_id=p.booking_id,
        status=p.status,
        amount_rupees=round(p.amount_paise / 100),
        method_label=p.method_label,
        created_at=p.created_at,
        paid_at=paid_at,
    )


def _in_range(e: dict[str, Any], frm: str | None, to: str | None) -> bool:
    d = ist_date_of(e["deliveredAt"]).isoformat()
    return (not frm or d >= frm) and (not to or d <= to)


# ── Agency read model (E85) ───────────────────────────────────────────────────
async def agency_earnings(user: CurrentUser, frm: str | None, to: str | None, now: datetime) -> AgencyEarningsDTO:
    agency_id = agency_id_of(user)
    all_rows = await earnings_repo.for_agency(agency_id)
    rows = [e for e in all_rows if _in_range(e, frm, to)]
    agg = aggregate(rows, now)
    try:
        from app.repositories import payments as payments_repo

        payments = await payments_repo.list_for_agency(agency_id, MOVED_PAYMENT_STATUSES, limit=100)
    except ImportError:  # pragma: no cover - D5 module always present
        payments = []
    settlements = await settlements_repo.for_agency(agency_id)
    return AgencyEarningsDTO(
        summary=EarningsSummaryDTO(**agg["summary"]),
        monthly_series=[MonthAmount(**m) for m in agg["monthly_series"]],
        by_trip=[EarningsByTripDTO(**t) for t in agg["by_trip"]],
        by_booking=[_row(e) for e in rows],
        payments=[_payment_row(p) for p in payments],
        settlements=[
            AgencySettlementDTO(
                id=s["id"],
                amount=int(s.get("amount", 0)),
                bookings=len(s.get("earningIds") or []),
                reference=s.get("reference", ""),
                period_through=s.get("periodThrough", ""),
                settled_at=s["settledAt"],
            )
            for s in settlements
        ],
    )


# ── Admin settlements (E122–E124; called by D2's admin_service) ───────────────
async def pending_settlements_by_agency() -> list[dict[str, Any]]:
    """Rows ``{agencyId, agencyName, pendingAmount, pendingCount, oldestDeliveredAt}``, oldest first."""
    by: dict[str, dict[str, Any]] = {}
    for e in await earnings_repo.all_pending():
        a = by.setdefault(e["agencyId"], {"pendingAmount": 0, "pendingCount": 0, "oldestDeliveredAt": e["deliveredAt"]})
        a["pendingAmount"] += int(e.get("agencyNet", 0))
        a["pendingCount"] += 1
        if e["deliveredAt"] < a["oldestDeliveredAt"]:
            a["oldestDeliveredAt"] = e["deliveredAt"]
    ids = list(by)
    agencies = await get_many(C.agencies, ids)
    rows = [
        {"agencyId": aid, "agencyName": (agencies[k] or {}).get("agencyName", aid), **by[aid]}
        for k, aid in enumerate(ids)
    ]
    return sorted(rows, key=lambda r: r["oldestDeliveredAt"])


def _reference_reused() -> AppError:
    return AppError(
        "already_exists",
        "This reference was already used for a settlement to this agency.",
        fields={"reference": "Already used"},
    )


async def record_settlement(
    agency_id: str, through: date, reference: str, recorded_by: str, now: datetime
) -> dict[str, Any] | None:
    """Mark the agency's pending earnings delivered on or before ``through`` (IST end of day) as settled,
    oldest first, at most 400 per settlement. ``None`` when nothing is pending; 409 ``already_exists`` when
    ``reference`` was already used for this agency."""
    reference = reference.strip()
    cutoff = ist_end_of_day_utc(through)
    candidates = [e for e in await earnings_repo.pending_for_agency(agency_id) if e["deliveredAt"] <= cutoff]
    due = sorted(candidates, key=lambda e: e["deliveredAt"])[:MAX_PER_SETTLEMENT]
    if not due:
        if not await agencies_repo.get(agency_id):
            raise AppError("not_found")
        # A reused reference is the more specific error than "nothing pending" (contract E123).
        if await settlements_repo.by_reference(agency_id, reference):
            raise _reference_reused()
        return None
    ids = [e["id"] for e in due]

    async def _tx(tx: AsyncTransaction) -> dict[str, Any] | None:
        agency = await agencies_repo.tx_get_agency(tx, agency_id)
        dup = await settlements_repo.tx_by_reference(tx, agency_id, reference)
        fresh = [
            e
            for e in await earnings_repo.tx_get_earnings(tx, ids)
            if e and e.get("status") == "pending" and e.get("agencyId") == agency_id
        ]
        if not agency:
            raise AppError("not_found")
        if dup:
            raise _reference_reused()
        if not fresh:
            return None
        settlement = {
            "id": new_id("stl"),
            "agencyId": agency_id,
            "amount": sum(int(e.get("agencyNet", 0)) for e in fresh),
            "earningIds": [e["id"] for e in fresh],
            "reference": reference,
            "periodThrough": through.isoformat(),
            "settledAt": now,
            "recordedBy": recorded_by,
            "createdAt": now,
        }
        settlements_repo.tx_create(tx, settlement)
        for e in fresh:
            earnings_repo.tx_update(
                tx, e["id"], {"status": "settled", "settlementId": settlement["id"], "settledAt": now, "updatedAt": now}
            )
        if agency.get("ownerUid"):
            from app.services import notification_service

            notification_service.notify(
                tx,
                user_id=agency["ownerUid"],
                role="agency",
                kind="settlement_recorded",
                title="Settlement recorded",
                body=f"₹{settlement['amount']} for {len(fresh)} deliveries (through {through.isoformat()}) "
                f"was settled. Reference {reference}.",
                link={"type": "earnings", "id": settlement["id"]},
                now=now,
            )
        return settlement

    return await run_transaction(_tx)


async def settlement_history(
    limit: int, cursor: str | None, agency_id: str | None
) -> tuple[list[dict[str, Any]], str | None]:
    """Rows shaped like ``AdminSettlementHistoryDTO`` (camelCase), newest first."""
    rows, nxt = await settlements_repo.page(agency_id, limit, cursor)
    agencies = await get_many(C.agencies, list(dict.fromkeys(r["agencyId"] for r in rows)))
    names = {a["id"]: a.get("agencyName", "") for a in agencies if a}
    return (
        [
            {
                "id": s["id"],
                "agencyId": s["agencyId"],
                "agencyName": names.get(s["agencyId"], s["agencyId"]),
                "amount": int(s.get("amount", 0)),
                "bookings": len(s.get("earningIds") or []),
                "reference": s.get("reference", ""),
                "periodThrough": s.get("periodThrough", ""),
                "settledAt": s["settledAt"],
                "recordedBy": s.get("recordedBy", ""),
            }
            for s in rows
        ],
        nxt,
    )
