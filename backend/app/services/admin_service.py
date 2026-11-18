"""Admin console (contract §13; port of modules/admin/service.ts + core/verification.ts).

Review queues, document view (masked numbers + signed URLs), verify / reject / suspend /
reinstate, vehicle RC review, user disable/enable, payments list, overview counts.
Every mutation writes ``auditLog`` and the notification in the same transaction.

Settlements need D3's earnings read model and the refund retry needs D5's payment service:
they are wired through ``_earnings()`` / ``_payments()`` hooks below and return 501
``not_implemented`` until those modules exist.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from types import ModuleType
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.core.clock import utcnow
from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.pagination import decode_cursor, encode_cursor
from app.core.time import ist_today
from app.integrations.firebase import auth as fb_auth
from app.repositories import audit as audit_repo
from app.repositories.base import C, count, doc_ref, get_db, get_doc, query_docs, run_transaction, tx_get
from app.schemas.admin import (
    AdminAgencyDetailDTO,
    AdminAgencyListItemDTO,
    AdminBookingDetailDTO,
    AdminDriverDetailDTO,
    AdminDriverListItemDTO,
    AdminOverviewDTO,
    AdminPaymentRowDTO,
    AdminSettlementHistoryDTO,
    AdminSettlementListDTO,
    AdminSettlementResultDTO,
    AdminSettlementRowDTO,
    AdminVehicleRcItemDTO,
    DuplicateDocumentFlag,
    PaymentCounts,
    QueueCounts,
    SettlementSummary,
    VehicleCounts,
)
from app.schemas.common import Page
from app.services.auth_service import notify_tx
from app.views import admin as views

log = logging.getLogger("taki.admin")


# ── paging ────────────────────────────────────────────────────────────────────
async def _page(collection: str, query: Any, limit: int, cursor: str | None) -> tuple[list[dict[str, Any]], str | None]:
    cur = decode_cursor(cursor)
    if cur:
        snap = await doc_ref(collection, str(cur.get("id", ""))).get()
        if not snap.exists:
            raise AppError("invalid_request", "Invalid cursor.", fields={"cursor": "Invalid cursor"})
        query = query.start_after(snap)
    docs = await query_docs(query.limit(limit + 1))
    nxt = encode_cursor({"id": docs[limit - 1]["id"]}) if len(docs) > limit else None
    return docs[:limit], nxt


def _review_query(collection: str, status_field: str, status: str) -> Any:
    q = get_db().collection(collection).where(filter=FieldFilter(status_field, "==", status))
    if status == "pending":  # ready for review: oldest submission first
        return q.order_by("verification.submittedAt").order_by("__name__")
    return q.order_by("createdAt", direction="DESCENDING").order_by("__name__", direction="DESCENDING")


# ── duplicate documents (same numberHmac on another account) ──────────────────
async def _duplicate_flags(own_type: str, own_id: str, hmacs: list[tuple[str, str]]) -> list[DuplicateDocumentFlag]:
    flags: list[DuplicateDocumentFlag] = []
    for kind, h in hmacs:
        targets = [
            ("agency", C.agencies, "identityDocument.numberHmac"),
            ("driver", C.drivers, "license.numberHmac"),
            ("driver", C.drivers, "aadhaar.numberHmac"),
        ]
        for acct_type, col, field in targets:
            for d in await query_docs(get_db().collection(col).where(filter=FieldFilter(field, "==", h)).limit(5)):
                if acct_type == own_type and d["id"] == own_id:
                    continue
                flags.append(DuplicateDocumentFlag(kind=kind, other_account_type=acct_type, other_account_id=d["id"]))  # type: ignore[arg-type]
    return flags


def _agency_hmacs(a: dict[str, Any]) -> list[tuple[str, str]]:
    ident = a.get("identityDocument") or {}
    return [(ident["kind"], ident["numberHmac"])] if ident.get("numberHmac") else []


def _driver_hmacs(d: dict[str, Any]) -> list[tuple[str, str]]:
    out = []
    for field, kind in (("license", "driving_license"), ("aadhaar", "aadhaar")):
        doc = d.get(field) or {}
        if doc.get("numberHmac"):
            out.append((kind, doc["numberHmac"]))
    return out


def _reviewed(prev: dict[str, Any], status: str, admin_uid: str, reason: str | None, now: datetime) -> dict[str, Any]:
    return {**prev, "status": status, "reviewedAt": now, "reviewedBy": admin_uid, "reason": reason}


# ── Agencies (E109–E114) ──────────────────────────────────────────────────────
async def list_agencies(status: str, limit: int, cursor: str | None) -> Page[AdminAgencyListItemDTO]:
    docs, nxt = await _page(C.agencies, _review_query(C.agencies, "verification.status", status), limit, cursor)
    return Page[AdminAgencyListItemDTO](items=[views.agency_item(a) for a in docs], next_cursor=nxt)


async def get_agency(admin: CurrentUser, agency_id: str) -> AdminAgencyDetailDTO:
    a = await get_doc(C.agencies, agency_id)
    if not a:
        raise AppError("not_found")
    flags = await _duplicate_flags("agency", agency_id, _agency_hmacs(a))
    return views.agency_detail(a, admin.uid, flags)


async def _decide_agency(admin: CurrentUser, agency_id: str, action: str, reason: str | None) -> AdminAgencyDetailDTO:
    now = utcnow()

    async def _tx(tx: AsyncTransaction) -> None:
        a = await tx_get(tx, C.agencies, agency_id)
        if not a:
            raise AppError("not_found")
        v = a.get("verification") or {}
        status = v.get("status", "not_submitted")
        notify: tuple[str, str, str] | None = None
        if action == "verify":
            if status == "verified":
                return
            if status == "suspended":
                raise AppError("invalid_transition", "This agency is suspended. Reinstate it instead.")
            missing = [
                k for k, ok in (("identityDocument", a.get("identityDocument")), ("photo", a.get("photo"))) if not ok
            ]
            if missing:
                raise AppError(
                    "invalid_transition",
                    "This agency hasn't uploaded its identity document and photo yet.",
                    details={"missing": missing},
                )
            nv = _reviewed(v, "verified", admin.uid, None, now)
            notify = ("agency_verified", "Your agency is verified", "You can now publish trips and accept bookings.")
        elif action == "reject":
            if status == "suspended":
                raise AppError("invalid_transition", "This agency is suspended.")
            if status == "rejected" and v.get("reason") == reason:
                return
            nv = _reviewed(v, "rejected", admin.uid, reason, now)
            notify = (
                "agency_rejected",
                "Verification needs attention",
                f"Reason: {reason}. Update your documents and resubmit.",
            )
        elif action == "suspend":
            if status == "suspended":
                return
            if status != "verified":
                raise AppError("invalid_transition", "Only verified agencies can be suspended.")
            nv = _reviewed(v, "suspended", admin.uid, reason, now)
            notify = ("agency_suspended", "Your agency is suspended", f"Reason: {reason}. Contact TAKI support.")
        else:  # reinstate
            if status != "suspended":
                raise AppError("invalid_transition", "Only suspended agencies can be reinstated.")
            nv = _reviewed(v, "verified", admin.uid, None, now)
            notify = (
                "agency_verified",
                "Your agency is active again",
                "You can publish trips and accept bookings again.",
            )
        tx.update(
            doc_ref(C.agencies, agency_id),
            {"verification": nv, "updatedAt": now, "version": int(a.get("version", 1)) + 1},
        )
        if notify and a.get("ownerUid"):
            notify_tx(
                tx,
                user_id=a["ownerUid"],
                role="agency",
                kind=notify[0],
                title=notify[1],
                body=notify[2],
                link={"type": "profile", "id": agency_id},
                now=now,
            )
        audit_repo.tx_write(
            tx,
            actor_uid=admin.uid,
            action=f"agency.{action}",
            target_type="agency",
            target_id=agency_id,
            now=now,
            data={"reason": reason} if reason else None,
        )

    await run_transaction(_tx)
    if action in ("suspend", "reinstate"):
        # Suspended agencies' published trips stop matching (search keys cleared); reinstate restores them.
        from app.services import trip_service

        await trip_service.set_agency_searchable(agency_id, action == "reinstate", now)
    return await get_agency(admin, agency_id)


async def verify_agency(admin: CurrentUser, agency_id: str) -> AdminAgencyDetailDTO:
    return await _decide_agency(admin, agency_id, "verify", None)


async def reject_agency(admin: CurrentUser, agency_id: str, reason: str) -> AdminAgencyDetailDTO:
    return await _decide_agency(admin, agency_id, "reject", reason)


async def suspend_agency(admin: CurrentUser, agency_id: str, reason: str) -> AdminAgencyDetailDTO:
    return await _decide_agency(admin, agency_id, "suspend", reason)


async def reinstate_agency(admin: CurrentUser, agency_id: str) -> AdminAgencyDetailDTO:
    return await _decide_agency(admin, agency_id, "reinstate", None)


# ── Drivers (E115–E118) ───────────────────────────────────────────────────────
async def list_drivers(status: str, limit: int, cursor: str | None) -> Page[AdminDriverListItemDTO]:
    docs, nxt = await _page(C.drivers, _review_query(C.drivers, "verification.status", status), limit, cursor)
    return Page[AdminDriverListItemDTO](items=[views.driver_item(d) for d in docs], next_cursor=nxt)


async def get_driver(admin: CurrentUser, driver_id: str) -> AdminDriverDetailDTO:
    d = await get_doc(C.drivers, driver_id)
    if not d:
        raise AppError("not_found")
    flags = await _duplicate_flags("driver", driver_id, _driver_hmacs(d))
    return views.driver_detail(d, admin.uid, flags)


async def _decide_driver(admin: CurrentUser, driver_id: str, verify: bool, reason: str | None) -> AdminDriverDetailDTO:
    now = utcnow()
    today = ist_today(now)

    async def _tx(tx: AsyncTransaction) -> None:
        d = await tx_get(tx, C.drivers, driver_id)
        if not d:
            raise AppError("not_found")
        v = d.get("verification") or {}
        status = v.get("status", "not_submitted")
        if verify:
            if status == "verified":
                return
            missing = [k for k in ("license", "aadhaar", "photo") if not d.get(k)]
            valid_until = (d.get("license") or {}).get("validUntil")
            if d.get("license") and not valid_until:
                missing.append("licenseValidUntil")
            if missing:
                raise AppError(
                    "invalid_transition",
                    "This driver hasn't uploaded their licence (with validity), Aadhaar and photo yet.",
                    details={"missing": missing},
                )
            if date.fromisoformat(str(valid_until)) < today:
                raise AppError(
                    "invalid_transition", "This driving licence has expired.", details={"missing": ["license"]}
                )
            nv = _reviewed(v, "verified", admin.uid, None, now)
            kind, title, body = (
                "driver_verified",
                "Your documents are verified",
                "Your licence and Aadhaar were checked by TAKI.",
            )
        else:
            if status == "rejected" and v.get("reason") == reason:
                return
            nv = _reviewed(v, "rejected", admin.uid, reason, now)
            kind, title, body = (
                "driver_rejected",
                "Document check failed",
                f"Reason: {reason}. Please re-upload your documents.",
            )
        tx.update(
            doc_ref(C.drivers, driver_id),
            {"verification": nv, "updatedAt": now, "version": int(d.get("version", 1)) + 1},
        )
        notify_tx(
            tx,
            user_id=driver_id,
            role="driver",
            kind=kind,
            title=title,
            body=body,
            link={"type": "profile", "id": driver_id},
            now=now,
        )
        audit_repo.tx_write(
            tx,
            actor_uid=admin.uid,
            action="driver.verify" if verify else "driver.reject",
            target_type="driver",
            target_id=driver_id,
            now=now,
            data={"reason": reason} if reason else None,
        )

    await run_transaction(_tx)
    return await get_driver(admin, driver_id)


async def verify_driver(admin: CurrentUser, driver_id: str) -> AdminDriverDetailDTO:
    return await _decide_driver(admin, driver_id, True, None)


async def reject_driver(admin: CurrentUser, driver_id: str, reason: str) -> AdminDriverDetailDTO:
    return await _decide_driver(admin, driver_id, False, reason)


# ── Vehicle RC review (E119–E121) ─────────────────────────────────────────────
async def list_vehicles(admin: CurrentUser, status: str, limit: int, cursor: str | None) -> Page[AdminVehicleRcItemDTO]:
    q = (
        get_db()
        .collection(C.vehicles)
        .where(filter=FieldFilter("rcVerification.status", "==", status))
        .order_by("createdAt", direction="DESCENDING")
        .order_by("__name__", direction="DESCENDING")
    )
    docs, nxt = await _page(C.vehicles, q, limit, cursor)
    return Page[AdminVehicleRcItemDTO](items=[views.vehicle_rc_item(v, admin.uid) for v in docs], next_cursor=nxt)


async def _decide_rc(admin: CurrentUser, vehicle_id: str, verify: bool, reason: str | None) -> AdminVehicleRcItemDTO:
    now = utcnow()

    async def _tx(tx: AsyncTransaction) -> dict[str, Any]:
        v = await tx_get(tx, C.vehicles, vehicle_id)
        if not v or v.get("status") == "removed":
            raise AppError("not_found")
        if not v.get("rc"):
            raise AppError("invalid_transition", "This vehicle has no RC uploaded.", details={"missing": ["rc"]})
        agency = await tx_get(tx, C.agencies, str(v.get("agencyId")))
        rcv = v.get("rcVerification") or {}
        nv = _reviewed(rcv, "verified" if verify else "rejected", admin.uid, reason, now)
        tx.update(
            doc_ref(C.vehicles, vehicle_id),
            {"rcVerification": nv, "updatedAt": now, "version": int(v.get("version", 1)) + 1},
        )
        if agency and agency.get("ownerUid"):
            reg = v.get("registrationNumber", "")
            notify_tx(
                tx,
                user_id=agency["ownerUid"],
                role="agency",
                kind="vehicle_rc_verified" if verify else "vehicle_rc_rejected",
                title=f"RC verified for {reg}" if verify else f"RC needs attention for {reg}",
                body="The registration certificate was checked by TAKI."
                if verify
                else f"Reason: {reason}. Upload the RC again.",
                link={"type": "vehicle", "id": vehicle_id},
                now=now,
            )
        audit_repo.tx_write(
            tx,
            actor_uid=admin.uid,
            action="vehicle.rc_verify" if verify else "vehicle.rc_reject",
            target_type="vehicle",
            target_id=vehicle_id,
            now=now,
            data={"reason": reason} if reason else None,
        )
        return {**v, "rcVerification": nv, "agencyName": v.get("agencyName") or (agency or {}).get("agencyName", "")}

    return views.vehicle_rc_item(await run_transaction(_tx), admin.uid)


async def verify_rc(admin: CurrentUser, vehicle_id: str) -> AdminVehicleRcItemDTO:
    return await _decide_rc(admin, vehicle_id, True, None)


async def reject_rc(admin: CurrentUser, vehicle_id: str, reason: str) -> AdminVehicleRcItemDTO:
    return await _decide_rc(admin, vehicle_id, False, reason)


# ── Users (E125–E126) ─────────────────────────────────────────────────────────
async def disable_user(admin: CurrentUser, uid: str, reason: str) -> None:
    if uid == admin.uid:
        raise AppError("invalid_transition", "You can't disable your own account.")
    now = utcnow()

    async def _tx(tx: AsyncTransaction) -> bool:
        u = await tx_get(tx, C.users, uid)
        if not u:
            raise AppError("not_found")
        if u.get("status") == "disabled":
            return False
        if u.get("role") == "admin":
            q = (
                get_db()
                .collection(C.users)
                .where(filter=FieldFilter("role", "==", "admin"))
                .where(filter=FieldFilter("status", "==", "active"))
            )
            if await count(q) <= 1:
                raise AppError("invalid_transition", "You can't disable the last admin.")
        tx.update(doc_ref(C.users, uid), {"status": "disabled", "sessionsValidAfter": now, "updatedAt": now})
        audit_repo.tx_write(
            tx,
            actor_uid=admin.uid,
            action="user.disable",
            target_type="user",
            target_id=uid,
            now=now,
            data={"reason": reason},
        )
        return True

    if await run_transaction(_tx):
        await fb_auth.update_user(uid, disabled=True)
        await fb_auth.revoke_refresh_tokens(uid)


async def enable_user(admin: CurrentUser, uid: str) -> None:
    now = utcnow()

    async def _tx(tx: AsyncTransaction) -> bool:
        u = await tx_get(tx, C.users, uid)
        if not u:
            raise AppError("not_found")
        if u.get("status") == "active":
            return False
        tx.update(doc_ref(C.users, uid), {"status": "active", "updatedAt": now})
        audit_repo.tx_write(tx, actor_uid=admin.uid, action="user.enable", target_type="user", target_id=uid, now=now)
        return True

    if await run_transaction(_tx):
        await fb_auth.update_user(uid, disabled=False)


# ── Payments (E127–E128) ──────────────────────────────────────────────────────
async def list_payments(status: str, limit: int, cursor: str | None) -> Page[AdminPaymentRowDTO]:
    q = (
        get_db()
        .collection(C.payments)
        .where(filter=FieldFilter("status", "==", status))
        .order_by("createdAt", direction="DESCENDING")
        .order_by("__name__", direction="DESCENDING")
    )
    docs, nxt = await _page(C.payments, q, limit, cursor)
    return Page[AdminPaymentRowDTO](items=[views.payment_row(p) for p in docs], next_cursor=nxt)


async def get_booking(booking_id: str) -> AdminBookingDetailDTO:
    """Read-only support lookup: booking + customer + every payment attempt + tracking events."""
    from app.repositories import bookings as bookings_repo  # D4
    from app.repositories import events as events_repo  # D4

    b = await bookings_repo.get(booking_id)
    if not b:
        raise AppError("not_found")
    customer = await get_doc(C.customers, b["customerId"]) if b.get("customerId") else None
    payments = await query_docs(
        get_db().collection(C.payments).where(filter=FieldFilter("bookingId", "==", booking_id)).limit(50)
    )
    payments.sort(key=lambda p: p.get("createdAt"))
    events = await events_repo.list_booking_events(booking_id)
    return views.booking_detail(b, customer, payments, events)


def _payments() -> ModuleType | None:
    try:
        from app.services import payment_service  # type: ignore[attr-defined]
    except ImportError:
        return None
    return payment_service if hasattr(payment_service, "retry_refund") else None


async def retry_refund(admin: CurrentUser, payment_id: str) -> AdminPaymentRowDTO:
    p = await get_doc(C.payments, payment_id)
    if not p:
        raise AppError("not_found")
    svc = _payments()
    if svc is None:
        raise AppError("payments_not_configured")
    await svc.retry_refund(payment_id, actor_uid=admin.uid)
    await audit_repo.write(
        actor_uid=admin.uid, action="refund.retry", target_type="payment", target_id=payment_id, now=utcnow()
    )
    updated = await get_doc(C.payments, payment_id)
    return views.payment_row(updated or p)


# ── Settlements (E122–E124) — need D3's earnings_service ──────────────────────
def _earnings() -> ModuleType | None:
    """TODO(D3): ``app.services.earnings_service`` must provide
    ``pending_settlements_by_agency() -> list[dict]`` (rows: agencyId, agencyName, pendingAmount,
    pendingCount, oldestDeliveredAt), ``record_settlement(agency_id, through: date, reference,
    recorded_by, now) -> dict | None`` (the settlement doc, None when nothing is pending) and
    ``settlement_history(limit, cursor, agency_id) -> (list[dict], next_cursor)``."""
    try:
        from app.services import earnings_service  # type: ignore[attr-defined]
    except ImportError:
        return None
    return earnings_service if hasattr(earnings_service, "pending_settlements_by_agency") else None


async def _settlement_rows() -> list[AdminSettlementRowDTO] | None:
    svc = _earnings()
    if svc is None:
        return None
    rows = await svc.pending_settlements_by_agency()
    return [AdminSettlementRowDTO.model_validate(r) for r in rows]


async def list_settlements() -> AdminSettlementListDTO:
    rows = await _settlement_rows()
    return AdminSettlementListDTO(items=rows or [], available=rows is not None)


async def settle(admin: CurrentUser, agency_id: str, through: str, reference: str) -> AdminSettlementResultDTO:
    svc = _earnings()
    if svc is None:
        raise AppError("not_implemented", "Settlements are not available yet.")
    now = utcnow()
    s = await svc.record_settlement(agency_id, date.fromisoformat(through), reference, admin.uid, now)
    if not s:
        raise AppError("conflict", "Nothing is pending for this agency up to that date.")
    await audit_repo.write(
        actor_uid=admin.uid,
        action="settlement.create",
        target_type="settlement",
        target_id=s["id"],
        now=now,
        data={"agencyId": agency_id},
    )
    return AdminSettlementResultDTO(
        settlement_id=s["id"],
        agency_id=s["agencyId"],
        amount=int(s["amount"]),
        count=len(s.get("earningIds") or []),
        reference=s["reference"],
        settled_at=s["settledAt"],
    )


async def settlement_history(limit: int, cursor: str | None, agency_id: str | None) -> Page[AdminSettlementHistoryDTO]:
    svc = _earnings()
    if svc is None:
        raise AppError("not_implemented", "Settlement history is not available yet.")
    rows, nxt = await svc.settlement_history(limit, cursor, agency_id)
    return Page[AdminSettlementHistoryDTO](
        items=[AdminSettlementHistoryDTO.model_validate(r) for r in rows], next_cursor=nxt
    )


# ── Overview (E108) ───────────────────────────────────────────────────────────
async def overview() -> AdminOverviewDTO:
    db = get_db()

    async def _queue(col: str) -> QueueCounts:
        base = db.collection(col)
        return QueueCounts(
            awaiting_review=await count(base.where(filter=FieldFilter("verification.status", "==", "pending"))),
            awaiting_documents=await count(
                base.where(filter=FieldFilter("verification.status", "==", "not_submitted"))
            ),
        )

    rows = await _settlement_rows()
    hour_ago = utcnow() - timedelta(hours=1)
    return AdminOverviewDTO(
        agencies=await _queue(C.agencies),
        drivers=await _queue(C.drivers),
        settlements=SettlementSummary(agencies=len(rows), pending_amount=sum(r.pending_amount for r in rows))
        if rows is not None
        else None,
        vehicles=VehicleCounts(
            awaiting_rc_review=await count(
                db.collection(C.vehicles).where(filter=FieldFilter("rcVerification.status", "==", "pending"))
            )
        ),
        payments=PaymentCounts(
            refund_failed=await count(
                db.collection(C.payments).where(filter=FieldFilter("status", "==", "refund_failed"))
            ),
            pending_over_1h=await count(
                db.collection(C.payments)
                .where(filter=FieldFilter("status", "==", "pending"))
                .where(filter=FieldFilter("createdAt", "<", hour_ago))
            ),
        ),
    )
