"""Booking commands (P2 §7, §8.2). EVERY booking state change happens here (or in
``tracking_service``, which calls the fan-out helpers below). Owner: D4.

Pattern per command, all in one Firestore transaction: **read** the bundle → lazy expiry →
guards → ``domain.booking_machine.apply`` → queue writes (booking, trip holds via D3's
``domain.capacity``, shipment, payments via D5, events, notifications, idempotency record).

A command that must persist something **and** report an error (a wrong OTP attempt counter, a lazy
expiry) returns a :class:`Failure` from the transaction; :func:`_run` raises it after the commit.

Ports provided to other agents:

* D5 (``payment_service.BookingPaymentPort``): :func:`load_for_payment`, :func:`start_payment`,
  :func:`apply_payment_result`, :func:`expire_payment_window`, :func:`apply_refund_result`.
* D3 (trip cancel / reassign / unpublish): :func:`load_trip_bookings`, :func:`close_for_trip_cancel`,
  :func:`fan_out_driver`, :func:`list_for_trip`.
* D2 (profile): :func:`refresh_customer_contact`.
"""

from __future__ import annotations

import base64
import hashlib
import itertools
import logging
import re
import secrets as pysecrets
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

from cryptography.fernet import Fernet, InvalidToken
from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.core.config import get_settings
from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.ids import new_booking_id, new_id
from app.domain import booking_machine as bm
from app.domain import capacity
from app.domain.matching import MatchShipment, match_fixed_segment, match_trip, respond_by, shipment_for_match
from app.domain.pricing import quote_for_trip
from app.models.payment import OPEN_STATUSES as OPEN_PAYMENT_STATUSES
from app.models.payment import PaymentDoc
from app.repositories import booking_secrets as secrets_repo
from app.repositories import bookings as bookings_repo
from app.repositories import events as events_repo
from app.repositories import idempotency as idem_repo
from app.repositories import payments as payments_repo
from app.repositories import reviews as reviews_repo
from app.repositories import shipments as shipments_repo
from app.repositories.base import C, doc_ref, get_db, get_doc, run_transaction, tx_get
from app.schemas.common import district_name_of
from app.services import jobs_service
from app.services.notification_service import Note, notify_many

log = logging.getLogger("taki.bookings")

IDEMPOTENCY_SCOPE = "booking_request"
SYSTEM: dict[str, Any] = {"role": "system", "userId": None}
_SEQ = itertools.count(1)


# ── small helpers ──────────────────────────────────────────────────────────────
@dataclass
class Failure:
    error: AppError


def actor_of(user: CurrentUser) -> dict[str, Any]:
    return {"role": user.role, "userId": user.uid}


async def _run[T](fn: Callable[[AsyncTransaction], Awaitable[T | Failure]], *, max_attempts: int = 5) -> T:
    r = await run_transaction(fn, max_attempts=max_attempts)
    if isinstance(r, Failure):
        raise r.error
    return r  # type: ignore[return-value]


def _ist(dt: datetime) -> str:
    return (dt + timedelta(hours=5, minutes=30)).strftime("%d %b %Y, %I:%M %p")


def _first(name: str) -> str:
    parts = (name or "").strip().split()
    return parts[0] if parts else "Customer"


def _tokens(*parts: str | None) -> list[str]:
    out: dict[str, None] = {}
    for p in parts:
        for w in re.split(r"[^a-z0-9]+", (p or "").lower()):
            if len(w) >= 2:
                out[w] = None
    return list(out)[:40]


def add_rating(avg: float, count: int, rating: int) -> dict[str, Any]:
    n = int(count) + 1
    value = (Decimal(str(avg)) * int(count) + rating) / n
    return {"ratingAvg": float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)), "ratingCount": n}


def booking_event(
    booking_id: str,
    type_: str,
    now: datetime,
    by: dict[str, Any],
    *,
    checkpoint_index: int | None = None,
    place_name: str | None = None,
    remarks: str | None = None,
    client_at: datetime | None = None,
    files: list[dict[str, str]] | None = None,
    visibility: Sequence[str] = ("customer", "agency", "driver"),
) -> dict[str, Any]:
    return {
        "id": new_id("bev"),
        "bookingId": booking_id,
        "type": type_,
        "at": now,
        "seq": next(_SEQ),
        "clientAt": client_at,
        "actor": dict(by),
        "checkpointIndex": checkpoint_index,
        "placeName": place_name,
        "remarks": remarks,
        "files": list(files or []),
        "visibility": list(visibility),
    }


def _add_event(tx: AsyncTransaction, ev: dict[str, Any]) -> None:
    events_repo.tx_add_booking_event(tx, ev)


# ── OTP secrets (Fernet with OTP_ENC_KEY) ─────────────────────────────────────
def _fernet() -> Fernet:
    raw = get_settings()._secret("OTP_ENC_KEY")  # noqa: SLF001 - shared secret accessor (dev fallback)
    try:
        return Fernet(raw)
    except (ValueError, TypeError):
        return Fernet(base64.urlsafe_b64encode(hashlib.sha256(raw).digest()))


def encrypt_otp(code: str) -> str:
    return _fernet().encrypt(code.encode()).decode()


def decrypt_otp(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        log.error("OPS ALERT: booking OTP could not be decrypted (OTP_ENC_KEY changed?)")
        return None


def new_otp(other: str | None = None) -> str:
    while True:
        code = f"{pysecrets.randbelow(1_000_000):06d}"
        if code != other:
            return code


def new_secrets_doc(booking_id: str, now: datetime) -> dict[str, Any]:
    pickup = new_otp()
    delivery = new_otp(pickup)
    return {
        "id": booking_id,
        "pickupOtpEnc": encrypt_otp(pickup),
        "deliveryOtpEnc": encrypt_otp(delivery),
        "pickupAttempts": 0,
        "deliveryAttempts": 0,
        "pickupUsedAt": None,
        "deliveryUsedAt": None,
        "issuedAt": now,
        "updatedAt": now,
    }


def _otp_check(
    tx: AsyncTransaction, sec: dict[str, Any], which: Literal["pickup", "delivery"], code: str, now: datetime
) -> Failure | None:
    attempts_key = f"{which}Attempts"
    used = int(sec.get(attempts_key) or 0)
    if used >= bm.OTP_ATTEMPTS:
        return Failure(
            AppError(
                "too_many_attempts",
                "Too many incorrect attempts. Ask the customer to generate a new code.",
                details={"attemptsLeft": 0},
            )
        )
    expected = decrypt_otp(sec.get(f"{which}OtpEnc"))
    if expected is not None and pysecrets.compare_digest(code, expected):
        return None
    attempts = used + 1
    left = bm.OTP_ATTEMPTS - attempts
    secrets_repo.tx_update(tx, sec["id"], {attempts_key: attempts, "updatedAt": now})
    if left <= 0:
        return Failure(
            AppError(
                "too_many_attempts",
                "Too many incorrect attempts. Ask the customer to generate a new code.",
                details={"attemptsLeft": 0},
            )
        )
    return Failure(
        AppError(
            "otp_invalid",
            f"That code is incorrect. {left} attempt{'' if left == 1 else 's'} left.",
            details={"attemptsLeft": left},
        )
    )


# ── bundle (read phase) and write accumulation ────────────────────────────────
@dataclass
class Bundle:
    booking: dict[str, Any]
    trip: dict[str, Any] | None
    shipment: dict[str, Any] | None
    agency: dict[str, Any] | None
    payments: list[PaymentDoc] = field(default_factory=list)


async def _read(tx: AsyncTransaction | None, collection: str, doc_id: str | None) -> dict[str, Any] | None:
    if not doc_id:
        return None
    return await (tx_get(tx, collection, doc_id) if tx is not None else get_doc(collection, doc_id))


async def read_bundle(tx: AsyncTransaction | None, booking_id: str, *, payments: bool = True) -> Bundle | None:
    """READS ONLY: booking + trip + shipment + agency (+ payments of the booking)."""
    if not re.match(r"^TAKI\d{8}$", booking_id or ""):
        return None
    b = await _read(tx, C.bookings, booking_id)
    if b is None:
        return None
    trip = await _read(tx, C.trips, b.get("tripId"))
    shipment = await _read(tx, C.shipments, b.get("shipmentId"))
    agency = await _read(tx, C.agencies, b.get("agencyId"))
    pays: list[PaymentDoc] = []
    if payments and tx is not None:
        pays = await payments_repo.tx_list_for_booking(tx, booking_id)
    return Bundle(b, trip, shipment, agency, pays)


def _counts(trip: dict[str, Any]) -> dict[str, int]:
    c = trip.get("counts") or {}
    return {k: int(c.get(k, 0)) for k in ("awaiting", "held", "committed", "delivered")}


def _bump(counts: dict[str, int], key: str, by: int) -> None:
    counts[key] = max(0, counts.get(key, 0) + by)


def _write_booking(tx: AsyncTransaction, bundle: Bundle, patch: dict[str, Any]) -> None:
    if not patch:
        return
    bookings_repo.tx_update(tx, bundle.booking["id"], patch)
    bundle.booking = {**bundle.booking, **patch}


def _write_trip(tx: AsyncTransaction, trip: dict[str, Any], patch: dict[str, Any], now: datetime) -> dict[str, Any]:
    full = {**patch, "updatedAt": now, "version": int(trip.get("version", 0)) + 1}
    tx.update(doc_ref(C.trips, trip["id"]), full)
    return {**trip, **full}


def _trip_hold_patch(
    trip: dict[str, Any], holds: dict[str, Any], counts: dict[str, int], now: datetime
) -> dict[str, Any]:
    nxt = {**trip, "holds": holds}
    return {"holds": holds, "counts": counts, "capacitySummary": capacity.summary(nxt, now)}


def _payable_kind(b: dict[str, Any]) -> bool:
    return b.get("approvalStatus") == "accepted" and b.get("paymentStatus") in bm.PAYABLE and not b.get("closure")


def due_expiry(bundle: Bundle, now: datetime) -> str | None:
    """``expire_request`` / ``expire_payment`` when a lapse is due now (pure on the bundle)."""
    b, trip = bundle.booking, bundle.trip
    if b.get("closure"):
        return None
    if b.get("approvalStatus") == "pending":
        rb = b.get("respondBy")
        return "expire_request" if rb is not None and now >= rb else None
    if not _payable_kind(b):
        return None
    hold = ((trip or {}).get("holds") or {}).get(b["id"])
    if hold and hold.get("state") == "committed":
        return None
    due = (hold or {}).get("dueAt") or b.get("paymentDueAt")
    if due is None or now < due:
        return None
    for p in bundle.payments:
        if p.status in OPEN_PAYMENT_STATUSES and now - p.created_at < bm.CHECKOUT_GRACE:
            return None
    return "expire_payment"


# ── notification copy ─────────────────────────────────────────────────────────
def _link(b: dict[str, Any]) -> dict[str, str]:
    return {"type": "booking", "id": b["id"]}


def to_customer(b: dict[str, Any], kind: str, title: str, body: str) -> Note:
    return Note(b["customerId"], "customer", kind, title, body, _link(b))


def to_driver(b: dict[str, Any], kind: str, title: str, body: str) -> Note:
    return Note(b.get("driverId") or "", "driver", kind, title, body, _link(b))


def to_agency(agency: dict[str, Any] | None, b: dict[str, Any], kind: str, title: str, body: str) -> Note | None:
    owner = (agency or {}).get("ownerUid")
    return Note(owner, "agency", kind, title, body, _link(b)) if owner else None


def _notes(*items: Note | None) -> list[Note]:
    return [n for n in items if n is not None]


# ── closing (reject / expire / cancel / refuse / trip cancel) ─────────────────
@dataclass
class CloseOut:
    changed: bool
    job_ids: list[str] = field(default_factory=list)
    trip: dict[str, Any] | None = None


async def _close(
    tx: AsyncTransaction,
    bundle: Bundle,
    event: str,
    by: dict[str, Any],
    now: datetime,
    *,
    note: str | None = None,
    refund_reason: str = "booking_cancelled",
    touch_payments: bool = True,
    write_trip: bool = True,
) -> CloseOut:
    """WRITES ONLY. Applies a closing event and every dependent change except notifications."""
    b = bundle.booking
    t = bm.apply(b, event, now=now, by=by, note=note)
    if not t.changed:
        return CloseOut(False, trip=bundle.trip)
    trip = bundle.trip
    if trip is not None:
        holds = capacity.holds_of(trip)
        counts = _counts(trip)
        if b.get("approvalStatus") == "pending":
            _bump(counts, "awaiting", -1)
        h = holds.pop(b["id"], None)
        if h is not None:
            _bump(counts, "committed" if h.get("state") == "committed" else "held", -1)
        patch = _trip_hold_patch(trip, holds, counts, now)
        if write_trip:
            trip = _write_trip(tx, trip, patch, now)
        else:
            trip = {**trip, **patch}
        bundle.trip = trip
    s = bundle.shipment
    if s is not None and s.get("currentBookingId") == b["id"]:
        sp = {"status": "open", "currentBookingId": None, "updatedAt": now, "version": int(s.get("version", 0)) + 1}
        shipments_repo.tx_update(tx, s["id"], sp)
        bundle.shipment = {**s, **sp}
    job_ids: list[str] = []
    if touch_payments:
        job_ids = await _close_payments(tx, bundle, refund_reason, now)
    _write_booking(tx, bundle, t.patch)
    closure = t.booking.get("closure") or {}
    ev_type = {"expire_request": "expired"}.get(event, "rejected" if closure.get("kind") == "rejected" else "cancelled")
    _add_event(tx, booking_event(b["id"], ev_type, now, by, remarks=note))
    if job_ids:
        _add_event(tx, booking_event(b["id"], "refund_started", now, SYSTEM, visibility=("customer", "agency")))
    return CloseOut(True, job_ids, trip)


async def _close_payments(tx: AsyncTransaction, bundle: Bundle, reason: str, now: datetime) -> list[str]:
    """WRITES ONLY: succeeded payment → D5 refund (100 %, incl. TAKI fee); open payments → cancelled."""
    from app.services.payment_service import get_payment_service  # lazy: avoids an import cycle

    job_ids: list[str] = []
    for p in bundle.payments:
        if p.booking_id != bundle.booking["id"]:
            continue
        if p.status == "succeeded":
            job = await get_payment_service().tx_start_refund(tx, p, payable_of(bundle, now), reason=reason, now=now)
            if job:
                job_ids.append(job)
        elif p.status in OPEN_PAYMENT_STATUSES:
            payments_repo.tx_put(
                tx,
                p.model_copy(
                    update={
                        "status": "cancelled",
                        "failure_reason": "booking_closed",
                        "updated_at": now,
                        "version": p.version + 1,
                    }
                ),
            )
    return job_ids


# ── read model for D5 ─────────────────────────────────────────────────────────
def payable_of(bundle: Bundle, now: datetime) -> Any:
    from app.services.payment_service import PayableBooking

    b, trip = bundle.booking, bundle.trip
    hold = ((trip or {}).get("holds") or {}).get(b["id"])
    rs = b.get("reservationStatus")
    hold_active = bool(hold) and capacity.is_active(hold, now) and rs in ("held", "committed")
    refittable = False
    if not hold_active and rs == "held" and trip is not None and trip.get("status") == "published":
        i, j = (b.get("pickup") or {}).get("checkpointIndex"), (b.get("drop") or {}).get("checkpointIndex")
        try:
            dep_ok = (b.get("pickup") or {}).get("expectedDepartureAt") is None or now < (
                b["pickup"]["expectedDepartureAt"] - bm.PAYMENT_CUTOFF_BEFORE_PICKUP
            )
            refittable = dep_ok and capacity.fits(trip, int(b.get("weightKg", 0)), int(i), int(j), now, b["id"])
        except (TypeError, ValueError):
            refittable = False
    d = b.get("display") or {}
    return PayableBooking(
        id=b["id"],
        customer_id=b["customerId"],
        agency_id=b.get("agencyId"),
        amount_paise=int((b.get("pricing") or {}).get("totalPayable", 0)) * 100,
        approval_status=b.get("approvalStatus", "pending"),
        payment_status=b.get("paymentStatus", "not_due"),
        reservation_status=rs or "none",
        fulfilment_status=b.get("fulfilmentStatus", "not_started"),
        closed=bool(b.get("closure")),
        payment_id=b.get("paymentId"),
        payment_due_at=b.get("paymentDueAt"),
        hold_active=hold_active,
        hold_refittable=refittable,
        customer_name=str(d.get("customerName") or ""),
        customer_phone=str(d.get("customerPhone") or ""),
        route_label=d.get("routeLabel"),
        status=bm.derive(b)["status"],
        closure=_closure_json(b.get("closure")),
        raw=bundle,
    )


def _closure_json(c: dict[str, Any] | None) -> dict[str, Any] | None:
    if not c:
        return None
    from app.core.time import iso_z

    return {
        "kind": c.get("kind"),
        "reason": c.get("reason"),
        "note": c.get("note"),
        "at": iso_z(c.get("at")),
        "byRole": (c.get("by") or {}).get("role"),
    }


def _bundle_of(pb: Any) -> Bundle:
    if not isinstance(pb.raw, Bundle):
        raise AppError("internal", "Booking snapshot missing.")
    return pb.raw


# ── D5 port (payment_service.BookingPaymentPort) ──────────────────────────────
async def load_for_payment(tx: AsyncTransaction | None, booking_id: str, *, now: datetime) -> Any:
    """READS ONLY. Booking + trip hold + customer display data. ``None`` when missing."""
    bundle = await read_bundle(tx, booking_id, payments=False)
    return None if bundle is None else payable_of(bundle, now)


async def start_payment(
    tx: AsyncTransaction, booking: Any, *, payment_id: str, hold_due_at: datetime, now: datetime
) -> None:
    """WRITES ONLY. paymentStatus due|failed → processing; trip hold dueAt extended (checkout grace)."""
    bundle = _bundle_of(booking)
    b = bundle.booking
    t = bm.apply(b, "checkout_started", now=now, by={"role": "customer", "userId": b["customerId"]})
    patch = dict(t.patch) if t.changed else {"updatedAt": now, "version": int(b.get("version", 0)) + 1}
    patch["paymentId"] = payment_id
    _write_booking(tx, bundle, patch)
    trip = bundle.trip
    if trip is not None and b["id"] in (trip.get("holds") or {}):
        cap = (b.get("pickup") or {}).get("expectedDepartureAt")
        due = hold_due_at if cap is None else min(hold_due_at, cap - bm.PAYMENT_CUTOFF_BEFORE_PICKUP)
        holds = capacity.extended(trip, b["id"], due)
        bundle.trip = _write_trip(tx, trip, _trip_hold_patch(trip, holds, _counts(trip), now), now)
    _add_event(
        tx,
        booking_event(
            b["id"], "payment_started", now, {"role": "customer", "userId": b["customerId"]}, visibility=("customer",)
        ),
    )


async def apply_payment_result(
    tx: AsyncTransaction,
    booking: Any,
    *,
    payment: PaymentDoc,
    result: Literal["paid", "failed", "expired"],
    now: datetime,
) -> None:
    """WRITES ONLY. The single path to ``paid`` (called by D5's verified ``confirm_payment``)."""
    bundle = _bundle_of(booking)
    b = bundle.booking
    if result == "failed":
        t = bm.apply(b, "payment_failed", now=now, by=SYSTEM)
        if t.changed:
            _write_booking(tx, bundle, t.patch)
            _add_event(tx, booking_event(b["id"], "payment_failed", now, SYSTEM, visibility=("customer",)))
            due = b.get("paymentDueAt")
            notify_many(
                tx,
                [
                    to_customer(
                        b,
                        "payment_failed",
                        "Payment failed",
                        f"Your payment for {b['id']} didn't go through."
                        + (f" You can try again until {_ist(due)}." if due else ""),
                    )
                ],
                now,
            )
        return
    if result == "expired":
        t = bm.apply(b, "payment_order_expired", now=now, by=SYSTEM)
        if t.changed:
            _write_booking(tx, bundle, t.patch)
        return

    t = bm.apply(b, "payment_succeeded", now=now, by=SYSTEM)
    if not t.changed:
        return
    patch = {**t.patch, "paidAt": now, "paymentId": payment.id, "driverAssignedAt": now}
    _write_booking(tx, bundle, patch)
    trip = bundle.trip
    if trip is not None:
        holds = capacity.holds_of(trip)
        counts = _counts(trip)
        h = holds.get(b["id"])
        i, j = int(b["pickup"]["checkpointIndex"]), int(b["drop"]["checkpointIndex"])
        if h is None:
            holds = capacity.with_hold(trip, b["id"], int(b["weightKg"]), i, j, None, now, state="committed")
        else:
            holds = capacity.committed(trip, b["id"])
            if h.get("state") == "held":
                _bump(counts, "held", -1)
        if h is None or h.get("state") == "held":
            _bump(counts, "committed", 1)
        bundle.trip = _write_trip(tx, trip, _trip_hold_patch(trip, holds, counts, now), now)
    secrets_repo.tx_set(tx, new_secrets_doc(b["id"], now))
    s = bundle.shipment
    if s is not None and s.get("currentBookingId") == b["id"]:
        sp = {"status": "booked", "updatedAt": now, "version": int(s.get("version", 0)) + 1}
        shipments_repo.tx_update(tx, s["id"], sp)
        bundle.shipment = {**s, **sp}
    for ev in ("payment_succeeded", "confirmed", "driver_assigned"):
        vis = ("customer", "agency", "driver") if ev != "payment_succeeded" else ("customer", "agency")
        _add_event(tx, booking_event(b["id"], ev, now, SYSTEM, visibility=vis))
    d = b.get("display") or {}
    total = (b.get("pricing") or {}).get("totalPayable")
    notify_many(
        tx,
        _notes(
            to_customer(
                b,
                "payment_succeeded",
                "Payment received — booking confirmed",
                f"₹{total} received for {b['id']}. Your pickup and delivery codes are in the booking.",
            ),
            to_agency(
                bundle.agency,
                b,
                "payment_succeeded",
                "Booking confirmed",
                f"{d.get('customerName', 'The customer')} paid for {b['id']} ({d.get('routeLabel', '')}).",
            ),
            to_driver(
                b,
                "shipment_assigned",
                "New shipment assigned",
                f"{b['id']}: pick up {b.get('weightKg')} kg at {(b.get('pickup') or {}).get('placeName', '')}.",
            ),
        ),
        now,
    )


async def expire_payment_window(tx: AsyncTransaction, booking: Any, *, now: datetime) -> None:
    """WRITES ONLY. The payment window closed: release the hold, paymentStatus → expired."""
    bundle = _bundle_of(booking)
    out = await _close(
        tx, bundle, "expire_payment", SYSTEM, now, note="The payment window closed.", touch_payments=False
    )
    if out.changed:
        notify_many(tx, _expiry_notes(bundle, "expire_payment"), now)


async def apply_refund_result(tx: AsyncTransaction, booking: Any, *, payment: PaymentDoc, now: datetime) -> None:
    """WRITES ONLY. Mirror the payment's refund state onto the booking (only for its own payment)."""
    bundle = _bundle_of(booking)
    b = bundle.booking
    if b.get("paymentId") != payment.id or payment.status not in ("refund_pending", "refunded", "refund_failed"):
        return
    if b.get("paymentStatus") == payment.status:
        return
    t = bm.with_state(b, {"paymentStatus": payment.status}, now=now, by=SYSTEM)
    _write_booking(tx, bundle, t.patch)
    amount = round(payment.amount_paise / 100) if payment.amount_paise % 100 == 0 else payment.amount_paise / 100
    if payment.status == "refunded":
        _add_event(tx, booking_event(b["id"], "refunded", now, SYSTEM, visibility=("customer", "agency")))
        notify_many(
            tx, [to_customer(b, "refund_completed", "Refund completed", f"₹{amount} for {b['id']} was refunded.")], now
        )
    elif payment.status == "refund_pending":
        _add_event(tx, booking_event(b["id"], "refund_started", now, SYSTEM, visibility=("customer", "agency")))
        notify_many(
            tx,
            [to_customer(b, "payment_refunded", "Refund started", f"A refund of ₹{amount} for {b['id']} has started.")],
            now,
        )
    else:
        notify_many(
            tx,
            [
                to_customer(
                    b,
                    "payment_refunded",
                    "Refund delayed",
                    f"The refund for {b['id']} is taking longer than usual. Our team is on it.",
                )
            ],
            now,
        )


# ── lazy expiry ────────────────────────────────────────────────────────────────
def _expiry_notes(bundle: Bundle, kind: str) -> list[Note]:
    b = bundle.booking
    d = b.get("display") or {}
    if kind == "expire_request":
        return _notes(
            to_customer(
                b,
                "booking_expired",
                "Request expired",
                f"{d.get('agencyName', 'The agency')} didn't respond to {b['id']} in time. "
                "Choose another trip for your shipment.",
            ),
            to_agency(bundle.agency, b, "booking_expired", "Request expired", f"{b['id']} expired without a response."),
        )
    return _notes(
        to_customer(
            b,
            "booking_cancelled",
            "Booking cancelled — payment window closed",
            f"{b['id']} was released because payment wasn't completed in time.",
        ),
        to_agency(
            bundle.agency,
            b,
            "booking_cancelled",
            "Booking released",
            f"{b['id']} was released: the customer didn't pay in time.",
        ),
    )


async def _expire_if_due(
    tx: AsyncTransaction, bundle: Bundle, now: datetime, *, write_trip: bool = True
) -> tuple[str | None, list[str]]:
    """WRITES ONLY (after the bundle was read). Returns (kind, refund placeholders)."""
    kind = due_expiry(bundle, now)
    if kind is None:
        return None, []
    note = "The agency did not respond in time." if kind == "expire_request" else "The payment window closed."
    out = await _close(tx, bundle, kind, SYSTEM, now, note=note, refund_reason="late_payment", write_trip=write_trip)
    if not out.changed:
        return None, []
    notify_many(tx, _expiry_notes(bundle, kind), now)
    return kind, out.job_ids


def _expiry_failure(kind: str) -> Failure:
    return Failure(AppError("request_expired" if kind == "expire_request" else "payment_window_closed"))


async def expire_if_due(booking_id: str, now: datetime) -> tuple[str | None, list[str]]:
    """Sweep: expire one booking if (still) due, in its own transaction."""

    async def fn(tx: AsyncTransaction) -> tuple[str | None, list[str]]:
        bundle = await read_bundle(tx, booking_id)
        if bundle is None:
            return None, []
        kind, jobs = await _expire_if_due(tx, bundle, now)
        return kind, jobs

    return await run_transaction(fn)


# ── ownership guards (404 when not visible: no existence leak) ───────────────
def _own_customer(user: CurrentUser, b: dict[str, Any] | None) -> dict[str, Any]:
    if b is None or user.role != "customer" or b.get("customerId") != user.uid:
        raise AppError("not_found")
    return b


def _own_agency(user: CurrentUser, b: dict[str, Any] | None) -> dict[str, Any]:
    if b is None or user.role != "agency" or not user.agency_id or b.get("agencyId") != user.agency_id:
        raise AppError("not_found")
    return b


def driver_can_see(b: dict[str, Any] | None, uid: str) -> bool:
    return b is not None and b.get("driverId") == uid and b.get("paidAt") is not None


def _own_driver(user: CurrentUser, b: dict[str, Any] | None) -> dict[str, Any]:
    if user.role != "driver" or not driver_can_see(b, user.uid):
        raise AppError("not_found")
    assert b is not None  # noqa: S101 - narrowed above
    return b


def _clean(text: str | None, max_len: int, field_name: str, min_len: int = 0) -> str | None:
    v = (text or "").strip()
    if not v:
        if min_len:
            raise AppError("invalid_request", fields={field_name: f"Enter at least {min_len} characters"})
        return None
    if len(v) < min_len or len(v) > max_len:
        raise AppError("invalid_request", fields={field_name: f"Use {min_len or 1}–{max_len} characters"})
    return v


# ── E34 request ────────────────────────────────────────────────────────────────
@dataclass
class RequestResult:
    booking: dict[str, Any]
    replayed: bool


async def request_booking(
    user: CurrentUser, *, shipment_id: str, trip_id: str, idempotency_key: str, now: datetime
) -> RequestResult:
    if user.role != "customer":
        raise AppError("forbidden")
    request_hash = hashlib.sha256(f"{shipment_id}|{trip_id}".encode()).hexdigest()
    candidates = [new_booking_id() for _ in range(3)]
    by = actor_of(user)

    async def fn(tx: AsyncTransaction) -> RequestResult:
        record = await idem_repo.tx_get_record(tx, IDEMPOTENCY_SCOPE, user.uid, idempotency_key)
        if record is not None:
            if record.get("requestHash") != request_hash:
                raise AppError("idempotency_key_reused")
            existing = await bookings_repo.tx_get_booking(tx, str((record.get("body") or {}).get("bookingId", "")))
            if existing is not None:
                return RequestResult(existing, True)
        shipment = await shipments_repo.tx_get_shipment(tx, shipment_id)
        trip = await _read(tx, C.trips, trip_id)
        customer = await _read(tx, C.customers, user.uid)
        agency = await _read(tx, C.agencies, (trip or {}).get("agencyId"))
        taken = await bookings_repo.tx_taken(tx, candidates)

        if shipment is None or shipment.get("customerId") != user.uid:
            raise AppError("not_found")
        if shipment.get("currentBookingId"):
            raise AppError("shipment_has_open_booking", details={"bookingId": shipment["currentBookingId"]})
        if shipment.get("status") != "open":
            raise AppError("invalid_transition", "This shipment can no longer be booked.")
        if trip is None or trip.get("status") != "published" or agency is None:
            raise AppError("trip_not_bookable")
        if (agency.get("verification") or {}).get("status") != "verified":
            raise AppError("trip_not_bookable")
        c = _counts(trip)
        if c["awaiting"] + c["held"] + c["committed"] >= bm.MAX_OPEN_BOOKINGS_PER_TRIP:
            raise AppError("trip_not_bookable", "This trip isn't taking more requests.")
        ms = shipment_for_match(shipment)
        r = match_trip(trip, ms, now)
        if not r.ok:
            code = r.problem or "not_on_route"
            if code == "insufficient_capacity" and r.match is not None:
                raise AppError(code, details={"availableKg": r.match.available_kg})
            raise AppError("trip_not_bookable" if code == "wrong_date" else code)
        m = r.match
        assert m is not None  # noqa: S101
        bid = next((x for x in candidates if x not in taken), None)
        if bid is None:
            raise AppError("contention")
        cps = trip["checkpoints"]
        pcp, dcp = cps[m.pickup_index], cps[m.drop_index]
        customer_name = str((customer or {}).get("fullName") or user.name)
        customer_phone = str((customer or {}).get("phone") or user.phone)
        route_label = f"{pcp['place']['name']} → {dcp['place']['name']}"
        vehicle, driver = trip.get("vehicle") or {}, trip.get("driver") or {}
        doc: dict[str, Any] = {
            "id": bid,
            "shipmentId": shipment["id"],
            "tripId": trip["id"],
            "customerId": user.uid,
            "agencyId": trip["agencyId"],
            "driverId": trip.get("driverId"),
            "vehicleId": trip.get("vehicleId"),
            "approvalStatus": "pending",
            "paymentStatus": "not_due",
            "reservationStatus": "none",
            "fulfilmentStatus": "not_started",
            "closure": None,
            "matchType": m.match_type,
            "pickup": {
                "checkpointIndex": m.pickup_index,
                "placeName": pcp["place"]["name"],
                "placeId": pcp["place"].get("placeId"),
                "district": district_name_of(pcp["place"]),
                "expectedDepartureAt": m.pickup_departure_at,
                "distanceKm": m.pickup_distance_km,
            },
            "drop": {
                "checkpointIndex": m.drop_index,
                "placeName": dcp["place"]["name"],
                "placeId": dcp["place"].get("placeId"),
                "district": district_name_of(dcp["place"]),
                "expectedArrivalAt": m.drop_arrival_at,
                "distanceKm": m.drop_distance_km,
            },
            "weightKg": ms.weight_kg,
            "goodsCategory": ms.goods_category,
            "specialHandling": list(ms.special_handling),
            "pricing": m.pricing,
            "respondBy": respond_by(m.pickup_departure_at),
            "acceptedAt": None,
            "paymentDueAt": None,
            "paidAt": None,
            "paymentId": None,
            "driverAssignedAt": None,
            "pickedUpAt": None,
            "deliveredAt": None,
            "statusHistory": [{"status": "awaiting_agency", "at": now, "by": by}],
            "reviewed": False,
            "display": {
                "customerName": customer_name,
                "customerPhone": customer_phone,
                "receiverName": (shipment.get("receiver") or {}).get("name"),
                "agencyName": trip.get("agencyName") or agency.get("agencyName"),
                "routeLabel": route_label,
                "tripDepartureAt": trip.get("departureAt"),
                "vehicleReg": vehicle.get("registrationNumber"),
                "driverName": driver.get("fullName"),
            },
            "searchTokens": _tokens(
                bid,
                customer_name,
                (shipment.get("receiver") or {}).get("name"),
                pcp["place"]["name"],
                dcp["place"]["name"],
                str(vehicle.get("registrationNumber") or "").replace(" ", ""),
                customer_phone[-4:],
            ),
            "createdAt": now,
            "updatedAt": now,
            "version": 1,
        }
        doc.update(bm.derive(doc))
        bookings_repo.tx_create(tx, doc)
        _add_event(tx, booking_event(bid, "requested", now, by, place_name=pcp["place"]["name"]))
        shipments_repo.tx_update(
            tx,
            shipment["id"],
            {
                "status": "requested",
                "currentBookingId": bid,
                "bookingIds": [*(shipment.get("bookingIds") or []), bid],
                "updatedAt": now,
                "version": int(shipment.get("version", 0)) + 1,
            },
        )
        _bump(c, "awaiting", 1)
        _write_trip(tx, trip, {"counts": c}, now)
        if customer is not None:
            stats = dict(customer.get("stats") or {})
            stats["bookings"] = int(stats.get("bookings", 0)) + 1
            tx.update(doc_ref(C.customers, user.uid), {"stats": stats, "updatedAt": now})
        notify_many(
            tx,
            _notes(
                to_agency(
                    agency,
                    doc,
                    "booking_requested",
                    "New booking request",
                    f"{customer_name} requested {doc['weightKg']} kg on {route_label}. "
                    f"Respond before {_ist(doc['respondBy'])}.",
                )
            ),
            now,
        )
        idem_repo.tx_put(
            tx,
            scope=IDEMPOTENCY_SCOPE,
            uid=user.uid,
            key=idempotency_key,
            request_hash=request_hash,
            status=201,
            body={"bookingId": bid},
            now=now,
        )
        return RequestResult(doc, False)

    return await run_transaction(fn)


# ── E82 / E83 agency accept / reject ──────────────────────────────────────────
async def accept(user: CurrentUser, booking_id: str, *, now: datetime) -> list[str]:
    by = actor_of(user)

    async def fn(tx: AsyncTransaction) -> list[str] | Failure:
        bundle = await read_bundle(tx, booking_id)
        b = _own_agency(user, bundle.booking if bundle else None)
        assert bundle is not None  # noqa: S101
        kind, jobs = await _expire_if_due(tx, bundle, now)
        if kind:
            return _expiry_failure(kind)
        if b.get("approvalStatus") == "accepted" and not b.get("closure"):
            return []
        if b.get("approvalStatus") != "pending" or b.get("closure"):
            raise AppError("invalid_transition", details={"event": "accept", "from": b.get("status")})
        vstatus = ((bundle.agency or {}).get("verification") or {}).get("status")
        if vstatus == "suspended":
            raise AppError("agency_suspended")
        if vstatus != "verified":
            raise AppError("agency_not_verified")
        trip = bundle.trip
        if trip is None or trip.get("status") != "published":
            raise AppError("trip_not_bookable")
        i, j = int(b["pickup"]["checkpointIndex"]), int(b["drop"]["checkpointIndex"])
        ms = MatchShipment(
            source=(0.0, 0.0),
            destination=(0.0, 0.0),
            weight_kg=int(b["weightKg"]),
            goods_category=b["goodsCategory"],
            special_handling=tuple(b.get("specialHandling") or ()),
        )
        problem = match_fixed_segment(trip, ms, i, j, now, exclude_booking=b["id"])
        if problem == "insufficient_capacity":
            raise AppError(
                "insufficient_capacity", details={"availableKg": capacity.available_kg(trip, i, j, now, b["id"])}
            )
        if problem == "departed":
            raise AppError("request_expired")
        if problem:
            raise AppError("trip_not_bookable" if problem in ("trip_not_bookable", "not_on_route") else problem)
        pickup_at = b["pickup"]["expectedDepartureAt"]
        due = bm.payment_due_at(now, pickup_at)
        holds = capacity.with_hold(trip, b["id"], int(b["weightKg"]), i, j, due, now)
        pricing = quote_for_trip(
            trip, i, j, weight_kg=int(b["weightKg"]), special_handling=b.get("specialHandling") or []
        )
        t = bm.apply(b, "accept", now=now, by=by)
        vehicle, driver = trip.get("vehicle") or {}, trip.get("driver") or {}
        display = {
            **(b.get("display") or {}),
            "driverName": driver.get("fullName"),
            "vehicleReg": vehicle.get("registrationNumber"),
        }
        _write_booking(
            tx, bundle, {**t.patch, "pricing": pricing, "acceptedAt": now, "paymentDueAt": due, "display": display}
        )
        counts = _counts(trip)
        _bump(counts, "awaiting", -1)
        _bump(counts, "held", 1)
        bundle.trip = _write_trip(tx, trip, _trip_hold_patch(trip, holds, counts, now), now)
        _add_event(tx, booking_event(b["id"], "accepted", now, by))
        old_total = (b.get("pricing") or {}).get("totalPayable")
        price_note = (
            f" The price was updated to ₹{pricing['totalPayable']}." if pricing["totalPayable"] != old_total else ""
        )
        notify_many(
            tx,
            [
                to_customer(
                    b,
                    "booking_accepted",
                    "Booking accepted — complete payment",
                    f"{display.get('agencyName')} accepted {b['id']}. Driver {display.get('driverName')}, vehicle "
                    f"{display.get('vehicleReg')}. Pay ₹{pricing['totalPayable']} by {_ist(due)}.{price_note}",
                )
            ],
            now,
        )
        return []

    return await _run(fn, max_attempts=10)


async def reject(user: CurrentUser, booking_id: str, reason: str, *, now: datetime) -> list[str]:
    note = _clean(reason, 300, "reason", 3)
    by = actor_of(user)

    async def fn(tx: AsyncTransaction) -> list[str] | Failure:
        bundle = await read_bundle(tx, booking_id)
        b = _own_agency(user, bundle.booking if bundle else None)
        assert bundle is not None  # noqa: S101
        was_pending = b.get("approvalStatus") == "pending"
        kind, jobs = await _expire_if_due(tx, bundle, now)
        if kind:
            return jobs if (kind == "expire_request" and was_pending) else _expiry_failure(kind)
        out = await _close(tx, bundle, "reject", by, now, note=note)
        if out.changed:
            d = bundle.booking.get("display") or {}
            notify_many(
                tx,
                [
                    to_customer(
                        bundle.booking,
                        "booking_rejected",
                        "Booking request declined",
                        f"{d.get('agencyName')} declined {b['id']}: {note}. Choose another trip.",
                    )
                ],
                now,
            )
        return out.job_ids

    return await _run(fn)


# ── E37 customer cancel / E95 refuse pickup ───────────────────────────────────
async def cancel_by_customer(user: CurrentUser, booking_id: str, reason: str | None, *, now: datetime) -> list[str]:
    note = _clean(reason, 300, "reason")
    by = actor_of(user)

    async def fn(tx: AsyncTransaction) -> list[str]:
        bundle = await read_bundle(tx, booking_id)
        b = _own_customer(user, bundle.booking if bundle else None)
        assert bundle is not None  # noqa: S101
        kind, jobs = await _expire_if_due(tx, bundle, now)
        if kind:
            return jobs
        was_paid = b.get("paymentStatus") == "paid"
        out = await _close(tx, bundle, "cancel", by, now, note=note, refund_reason="booking_cancelled")
        if not out.changed:
            return []
        nb = bundle.booking
        d = nb.get("display") or {}
        refund = " A full refund has been started." if was_paid else ""
        notify_many(
            tx,
            _notes(
                to_agency(
                    bundle.agency,
                    nb,
                    "booking_cancelled",
                    "Booking cancelled by customer",
                    f"{d.get('customerName')} cancelled {nb['id']}.",
                ),
                to_driver(
                    nb,
                    "booking_cancelled",
                    "Pickup cancelled",
                    f"{nb['id']} at {nb['pickup']['placeName']} was cancelled by the customer.",
                )
                if was_paid
                else None,
                to_customer(nb, "booking_cancelled", "Booking cancelled", f"You cancelled {nb['id']}.{refund}"),
            ),
            now,
        )
        return out.job_ids

    return await run_transaction(fn)


async def refuse_pickup(user: CurrentUser, booking_id: str, reason: str, *, now: datetime) -> list[str]:
    note = _clean(reason, 300, "reason", 5)
    by = actor_of(user)

    async def fn(tx: AsyncTransaction) -> list[str]:
        bundle = await read_bundle(tx, booking_id)
        b = _own_driver(user, bundle.booking if bundle else None)
        assert bundle is not None  # noqa: S101
        out = await _close(tx, bundle, "refuse_pickup", by, now, note=note, refund_reason="booking_cancelled")
        if not out.changed:
            return []
        d = b.get("display") or {}
        notify_many(
            tx,
            _notes(
                to_customer(
                    b,
                    "booking_cancelled",
                    "Pickup refused by driver",
                    f"The driver couldn't take {b['id']}: {note}. A full refund has been started.",
                ),
                to_agency(
                    bundle.agency,
                    b,
                    "booking_cancelled",
                    "Pickup refused",
                    f"{d.get('driverName')} refused pickup of {b['id']}: {note}",
                ),
            ),
            now,
        )
        return out.job_ids

    return await run_transaction(fn)


# ── E94 pickup / E96 E97 manual steps / E98 deliver / E99 remark ──────────────
async def pickup(
    user: CurrentUser, booking_id: str, otp: str, *, remarks: str | None, client_at: datetime | None, now: datetime
) -> None:
    text = _clean(remarks, 300, "remarks")
    by = actor_of(user)

    async def fn(tx: AsyncTransaction) -> None | Failure:
        bundle = await read_bundle(tx, booking_id, payments=False)
        b = _own_driver(user, bundle.booking if bundle else None)
        assert bundle is not None  # noqa: S101
        sec = await secrets_repo.tx_get_secrets(tx, b["id"])
        if b.get("fulfilmentStatus") in bm.PICKED_UP_OR_LATER:
            return None
        if b.get("closure") or b.get("paymentStatus") != "paid" or b.get("fulfilmentStatus") != "not_started":
            raise AppError("invalid_transition", details={"event": "pickup", "from": b.get("status")})
        trip = bundle.trip
        if trip is None or trip.get("status") not in ("published", "in_progress"):
            raise AppError("invalid_transition", "This trip isn't active.")
        if now < b["pickup"]["expectedDepartureAt"] - bm.PICKUP_WINDOW:
            raise AppError("too_early", "Pickup opens 24 hours before the scheduled departure.")
        if sec is None:
            raise AppError("internal", "Pickup code missing for this booking.")
        failure = _otp_check(tx, sec, "pickup", otp, now)
        if failure:
            return failure
        t = bm.apply(b, "pickup", now=now, by=by, note=text)
        _write_booking(tx, bundle, {**t.patch, "pickedUpAt": now})
        secrets_repo.tx_update(tx, b["id"], {"pickupUsedAt": now, "updatedAt": now})
        s = bundle.shipment
        if s is not None:
            shipments_repo.tx_update(
                tx, s["id"], {"status": "in_transit", "updatedAt": now, "version": int(s.get("version", 0)) + 1}
            )
        _add_event(
            tx,
            booking_event(
                b["id"],
                "picked_up",
                now,
                by,
                checkpoint_index=b["pickup"]["checkpointIndex"],
                place_name=b["pickup"]["placeName"],
                remarks=text,
                client_at=client_at,
            ),
        )
        d = b.get("display") or {}
        notify_many(
            tx,
            [
                to_customer(
                    b,
                    "pickup_confirmed",
                    "Shipment picked up",
                    f"{d.get('driverName')} picked up {b['id']} at {b['pickup']['placeName']}.",
                )
            ],
            now,
        )
        return None

    await _run(fn)


async def manual_step(
    user: CurrentUser,
    booking_id: str,
    event: Literal["start_transit", "out_for_delivery"],
    *,
    remarks: str | None,
    client_at: datetime | None,
    now: datetime,
) -> None:
    text = _clean(remarks, 300, "remarks")
    by = actor_of(user)

    async def fn(tx: AsyncTransaction) -> None:
        bundle = await read_bundle(tx, booking_id, payments=False)
        b = _own_driver(user, bundle.booking if bundle else None)
        assert bundle is not None  # noqa: S101
        t = bm.apply(b, event, now=now, by=by, note=text)
        if not t.changed:
            return
        _write_booking(tx, bundle, t.patch)
        if event == "start_transit":
            _add_event(tx, booking_event(b["id"], "in_transit", now, by, remarks=text, client_at=client_at))
            return
        _add_event(
            tx,
            booking_event(
                b["id"],
                "out_for_delivery",
                now,
                by,
                remarks=text,
                client_at=client_at,
                place_name=b["drop"]["placeName"],
                checkpoint_index=b["drop"]["checkpointIndex"],
            ),
        )
        notify_many(
            tx,
            [
                to_customer(
                    b,
                    "out_for_delivery",
                    "Out for delivery",
                    f"{b['id']} is out for delivery at {b['drop']['placeName']}.",
                )
            ],
            now,
        )

    await run_transaction(fn)


async def deliver(
    user: CurrentUser,
    booking_id: str,
    otp: str,
    *,
    proof_file_ids: Sequence[str],
    remarks: str | None,
    received_by: str | None,
    client_at: datetime | None,
    now: datetime,
) -> None:
    text = _clean(remarks, 300, "remarks")
    receiver = _clean(received_by, 80, "receivedBy")
    by = actor_of(user)
    proof_ids = list(dict.fromkeys(proof_file_ids))
    if len(proof_ids) > bm.MAX_PROOF_FILES:
        raise AppError(
            "invalid_request", f"Add at most {bm.MAX_PROOF_FILES} photos.", fields={"proof": "Too many files"}
        )
    if not proof_ids and get_settings().REQUIRE_DELIVERY_PROOF:
        raise AppError("proof_required")

    async def fn(tx: AsyncTransaction) -> None | Failure:
        bundle = await read_bundle(tx, booking_id, payments=False)
        b = _own_driver(user, bundle.booking if bundle else None)
        assert bundle is not None  # noqa: S101
        sec = await secrets_repo.tx_get_secrets(tx, b["id"])
        driver = await _read(tx, C.drivers, b.get("driverId"))
        customer = await _read(tx, C.customers, b.get("customerId"))
        files = [await _read(tx, C.files, fid) for fid in proof_ids]
        if b.get("fulfilmentStatus") == "delivered":
            return None
        if b.get("closure") or b.get("fulfilmentStatus") != "out_for_delivery":
            raise AppError("invalid_transition", "Mark the shipment out for delivery first.")
        for f in files:
            if (
                f is None
                or f.get("kind") != "delivery_proof"
                or f.get("ownerType") != "booking"
                or f.get("ownerId") != b["id"]
                or f.get("status") != "active"
            ):
                raise AppError(
                    "invalid_request", "A delivery photo is invalid. Upload it again.", fields={"proof": "Invalid file"}
                )
        if sec is None:
            raise AppError("internal", "Delivery code missing for this booking.")
        failure = _otp_check(tx, sec, "delivery", otp, now)
        if failure:
            return failure
        t = bm.apply(b, "deliver", now=now, by=by, note=text)
        _write_booking(tx, bundle, {**t.patch, "deliveredAt": now})
        secrets_repo.tx_update(tx, b["id"], {"deliveryUsedAt": now, "updatedAt": now})
        trip = bundle.trip
        if trip is not None:
            holds = capacity.released(trip, b["id"])
            counts = _counts(trip)
            if b["id"] in (trip.get("holds") or {}):
                _bump(counts, "committed", -1)
            _bump(counts, "delivered", 1)
            bundle.trip = _write_trip(tx, trip, _trip_hold_patch(trip, holds, counts, now), now)
        pricing = b.get("pricing") or {}
        d = b.get("display") or {}
        earning = {
            "id": b["id"],
            "bookingId": b["id"],
            "agencyId": b["agencyId"],
            "tripId": b["tripId"],
            "driverId": b.get("driverId"),
            "customerPaid": int(pricing.get("totalPayable", 0)),
            "transportationCharge": int(pricing.get("transportationCharge", 0)),
            "additionalCharges": int(pricing.get("additionalCharges", 0)),
            "platformFee": int(pricing.get("serviceFee", 0)),
            "agencyNet": int(pricing.get("agencyNet", 0)),
            "routeLabel": d.get("routeLabel"),
            "deliveredAt": now,
            "status": "pending",
            "settlementId": None,
            "settledAt": None,
            "createdAt": now,
            "updatedAt": now,
        }
        tx.set(doc_ref(C.earnings, b["id"]), earning)
        s = bundle.shipment
        if s is not None:
            shipments_repo.tx_update(
                tx, s["id"], {"status": "delivered", "updatedAt": now, "version": int(s.get("version", 0)) + 1}
            )
        for coll, doc in ((C.drivers, driver), (C.agencies, bundle.agency), (C.customers, customer)):
            if doc is not None:
                stats = dict(doc.get("stats") or {})
                stats["delivered"] = int(stats.get("delivered", 0)) + 1
                tx.update(doc_ref(coll, doc["id"]), {"stats": stats, "updatedAt": now})
        remark = " · ".join(x for x in (f"Received by {receiver}" if receiver else None, text) if x) or None
        _add_event(
            tx,
            booking_event(
                b["id"],
                "delivered",
                now,
                by,
                checkpoint_index=b["drop"]["checkpointIndex"],
                place_name=b["drop"]["placeName"],
                remarks=remark,
                client_at=client_at,
                files=[{"fileId": fid} for fid in proof_ids],
            ),
        )
        notify_many(
            tx,
            _notes(
                to_customer(
                    b,
                    "delivered",
                    "Delivered",
                    f"{b['id']} was delivered at {b['drop']['placeName']}. Rate your experience.",
                ),
                to_agency(
                    bundle.agency,
                    b,
                    "delivered",
                    "Shipment delivered",
                    f"{b['id']} ({d.get('routeLabel')}) was delivered. "
                    f"₹{earning['agencyNet']} added to pending earnings.",
                ),
            ),
            now,
        )
        return None

    await _run(fn)


async def add_remark(user: CurrentUser, booking_id: str, text: str, *, now: datetime) -> dict[str, Any]:
    remark = _clean(text, 300, "text", 1)
    by = actor_of(user)

    async def fn(tx: AsyncTransaction) -> dict[str, Any]:
        b = _own_driver(user, await bookings_repo.tx_get_booking(tx, booking_id))
        if b.get("closure") or b.get("fulfilmentStatus") == "delivered":
            raise AppError("invalid_transition", "This shipment is closed.")
        ev = booking_event(b["id"], "remark", now, by, remarks=remark)
        _add_event(tx, ev)
        return ev

    return await run_transaction(fn)


# ── E41 review / E39 OTP regenerate ───────────────────────────────────────────
async def review(
    user: CurrentUser, booking_id: str, rating: int, comment: str | None, *, now: datetime
) -> dict[str, Any]:
    text = _clean(comment, 500, "comment")
    if not 1 <= int(rating) <= 5:
        raise AppError("invalid_request", "Choose a rating from 1 to 5.", fields={"rating": "1–5"})

    async def fn(tx: AsyncTransaction) -> dict[str, Any]:
        b = _own_customer(user, await bookings_repo.tx_get_booking(tx, booking_id))
        existing = await reviews_repo.tx_get_review(tx, b["id"])
        driver = await _read(tx, C.drivers, b.get("driverId"))
        agency = await _read(tx, C.agencies, b.get("agencyId"))
        customer = await _read(tx, C.customers, b.get("customerId"))
        future: list[dict[str, Any]] = []
        if b.get("driverId"):
            q = (
                get_db()
                .collection(C.trips)
                .where(filter=FieldFilter("driverId", "==", b["driverId"]))
                .where(filter=FieldFilter("status", "in", ["draft", "published"]))
                .limit(50)
            )
            future = [s.to_dict() | {"id": s.id} async for s in q.stream(transaction=tx)]
        if existing is not None or b.get("reviewed"):
            raise AppError("already_reviewed")
        if b.get("fulfilmentStatus") != "delivered" or b.get("closure"):
            raise AppError("invalid_transition", "You can review once the shipment is delivered.")
        name = str((customer or {}).get("fullName") or (b.get("display") or {}).get("customerName") or user.name)
        doc = {
            "id": b["id"],
            "bookingId": b["id"],
            "customerId": b["customerId"],
            "customerFirstName": _first(name),
            "driverId": b.get("driverId"),
            "agencyId": b.get("agencyId"),
            "tripId": b.get("tripId"),
            "rating": int(rating),
            "comment": text,
            "createdAt": now,
        }
        reviews_repo.tx_create(tx, doc)
        bookings_repo.tx_update(
            tx, b["id"], {"reviewed": True, "updatedAt": now, "version": int(b.get("version", 0)) + 1}
        )
        if driver is not None:
            st = dict(driver.get("stats") or {})
            r = add_rating(float(st.get("ratingAvg", 0)), int(st.get("ratingCount", 0)), int(rating))
            tx.update(doc_ref(C.drivers, driver["id"]), {"stats": {**st, **r}, "updatedAt": now})
            for t in future:
                tx.update(
                    doc_ref(C.trips, t["id"]),
                    {
                        "driver": {**(t.get("driver") or {}), **r},
                        "updatedAt": now,
                        "version": int(t.get("version", 0)) + 1,
                    },
                )
        if agency is not None:
            st = dict(agency.get("stats") or {})
            r = add_rating(float(st.get("ratingAvg", 0)), int(st.get("ratingCount", 0)), int(rating))
            tx.update(doc_ref(C.agencies, agency["id"]), {"stats": {**st, **r}, "updatedAt": now})
        body = f"{doc['customerFirstName']} rated {b['id']} {rating}/5" + (f": “{text}”" if text else ".")
        notify_many(
            tx,
            _notes(
                to_agency(agency, b, "review_received", "New review", body),
                to_driver(b, "review_received", "New review", body),
            ),
            now,
        )
        return doc

    return await run_transaction(fn)


async def regenerate_otp(
    user: CurrentUser, booking_id: str, which: Literal["pickup", "delivery"], *, now: datetime
) -> None:
    async def fn(tx: AsyncTransaction) -> None:
        bundle = await read_bundle(tx, booking_id)
        b = _own_customer(user, bundle.booking if bundle else None)
        assert bundle is not None  # noqa: S101
        sec = await secrets_repo.tx_get_secrets(tx, b["id"])
        kind, jobs = await _expire_if_due(tx, bundle, now)
        if kind:
            raise AppError("invalid_transition")
        if sec is None or b.get("closure") or b.get("paymentStatus") != "paid":
            raise AppError("invalid_transition", "Codes are available once the booking is paid.")
        ful = b.get("fulfilmentStatus")
        ok = ful == "not_started" if which == "pickup" else ful in bm.ON_BOARD
        if not ok or sec.get(f"{which}UsedAt") is not None:
            raise AppError("invalid_transition", "This code can't be changed now.")
        if int(sec.get(f"{which}Attempts") or 0) < bm.OTP_ATTEMPTS:
            raise AppError("otp_not_exhausted")
        other = decrypt_otp(sec.get("deliveryOtpEnc" if which == "pickup" else "pickupOtpEnc"))
        secrets_repo.tx_update(
            tx, b["id"], {f"{which}OtpEnc": encrypt_otp(new_otp(other)), f"{which}Attempts": 0, "updatedAt": now}
        )

    await run_transaction(fn)


# ── trip fan-out (checkpoint auto transitions; used by tracking_service) ──────
def tx_checkpoint_fanout(
    tx: AsyncTransaction,
    bookings: Iterable[dict[str, Any]],
    *,
    index: int,
    kind: Literal["arrive", "depart"],
    place_name: str,
    by: dict[str, Any],
    client_at: datetime | None,
    now: datetime,
) -> list[Note]:
    """WRITES ONLY. Checkpoint events + automatic transitions for paid bookings on the segment."""
    notes: list[Note] = []
    for b in bookings:
        if b.get("closure") or b.get("paymentStatus") != "paid":
            continue
        pi, di = int(b["pickup"]["checkpointIndex"]), int(b["drop"]["checkpointIndex"])
        if not pi <= index <= di:
            continue
        ev_type = "checkpoint_arrived" if kind == "arrive" else "checkpoint_departed"
        _add_event(
            tx,
            booking_event(
                b["id"], ev_type, now, by, checkpoint_index=index, place_name=place_name, client_at=client_at
            ),
        )
        ful = b.get("fulfilmentStatus")
        if kind == "depart" and ful == "picked_up":
            t = bm.apply(b, "start_transit", now=now, by=by)
            bookings_repo.tx_update(tx, b["id"], t.patch)
            _add_event(
                tx,
                booking_event(
                    b["id"], "in_transit", now, by, checkpoint_index=index, place_name=place_name, client_at=client_at
                ),
            )
        elif kind == "arrive" and index == di and ful == "in_transit":
            t = bm.apply(b, "out_for_delivery", now=now, by=by)
            bookings_repo.tx_update(tx, b["id"], t.patch)
            _add_event(
                tx,
                booking_event(
                    b["id"],
                    "out_for_delivery",
                    now,
                    by,
                    checkpoint_index=index,
                    place_name=place_name,
                    client_at=client_at,
                ),
            )
            notes.append(
                to_customer(
                    b,
                    "out_for_delivery",
                    "Out for delivery",
                    f"{b['id']} reached {place_name} and is out for delivery.",
                )
            )
        elif kind == "arrive" and pi < index < di and ful in ("picked_up", "in_transit"):
            notes.append(
                to_customer(
                    b,
                    "checkpoint_reached",
                    f"Reached {place_name}",
                    f"{b['id']} reached {place_name} on the way to {b['drop']['placeName']}.",
                )
            )
    return notes


# ── D3 port: trip cancel / reassign / unpublish ───────────────────────────────
@dataclass
class TripBookings:
    trip_id: str
    bookings: list[dict[str, Any]]
    bundles: list[Bundle]

    @property
    def has_picked_up(self) -> bool:
        return any(b.get("fulfilmentStatus") in bm.PICKED_UP_OR_LATER for b in self.bookings if not b.get("closure"))


@dataclass
class TripCloseResult:
    holds: dict[str, Any]
    counts: dict[str, int]
    capacity_summary: dict[str, int]
    job_ids: list[str]


async def load_trip_bookings(tx: AsyncTransaction, trip_id: str, *, now: datetime) -> TripBookings:
    """READS ONLY: non-terminal bookings of the trip with their shipments and payments."""
    rows = await bookings_repo.tx_list_for_trip(tx, trip_id, bm.OPEN_STATUSES)
    bundles: list[Bundle] = []
    for b in rows:
        s = await _read(tx, C.shipments, b.get("shipmentId"))
        pays = await payments_repo.tx_list_for_booking(tx, b["id"])
        bundles.append(Bundle(b, None, s, None, pays))
    return TripBookings(trip_id, rows, bundles)


async def close_for_trip_cancel(
    tx: AsyncTransaction, tb: TripBookings, trip: dict[str, Any], *, note: str, actor: dict[str, Any], now: datetime
) -> TripCloseResult:
    """WRITES ONLY. Closes every open booking of a cancelled trip; the caller writes the trip once."""
    if tb.has_picked_up:
        raise AppError("invalid_transition", "Some shipments are already picked up.")
    cur = dict(trip)
    job_ids: list[str] = []
    notes: list[Note] = []
    for bundle in tb.bundles:
        bundle.trip = cur
        was_paid = bundle.booking.get("paymentStatus") == "paid"
        out = await _close(
            tx, bundle, "trip_cancelled", actor, now, note=note, refund_reason="booking_cancelled", write_trip=False
        )
        if out.trip is not None:
            cur = out.trip
        if not out.changed:
            continue
        job_ids += out.job_ids
        refund = " A full refund has been started." if was_paid else ""
        notes.append(
            to_customer(
                bundle.booking,
                "trip_cancelled",
                "Trip cancelled",
                f"{trip.get('agencyName')} cancelled the trip for {bundle.booking['id']}: {note}.{refund} "
                "You can book another trip.",
            )
        )
    notify_many(tx, notes, now)
    holds = capacity.holds_of(cur)
    return TripCloseResult(holds, _counts(cur), capacity.summary({**cur, "holds": holds}, now), job_ids)


async def fan_out_driver(
    tx: AsyncTransaction,
    tb: TripBookings,
    trip: dict[str, Any],
    *,
    driver_id: str,
    driver_name: str,
    vehicle_id: str,
    vehicle_reg: str,
    actor: dict[str, Any],
    now: datetime,
) -> None:
    """WRITES ONLY. Reassign: open bookings get the new driver/vehicle; paid customers are told."""
    notes: list[Note] = []
    for b in tb.bookings:
        if b.get("closure"):
            continue
        display = {**(b.get("display") or {}), "driverName": driver_name, "vehicleReg": vehicle_reg}
        patch: dict[str, Any] = {
            "driverId": driver_id,
            "vehicleId": vehicle_id,
            "display": display,
            "updatedAt": now,
            "version": int(b.get("version", 0)) + 1,
        }
        if b.get("paymentStatus") == "paid":
            patch["driverAssignedAt"] = now
        bookings_repo.tx_update(tx, b["id"], patch)
        if b.get("paymentStatus") == "paid":
            _add_event(
                tx, booking_event(b["id"], "driver_reassigned", now, actor, remarks=f"{driver_name} · {vehicle_reg}")
            )
            notes.append(
                to_customer(
                    b,
                    "driver_reassigned",
                    "New driver assigned",
                    f"{b['id']} will now be carried by {driver_name} in {vehicle_reg}.",
                )
            )
    notify_many(tx, notes, now)


async def list_for_trip(agency_id: str, trip_id: str) -> list[dict[str, Any]]:
    return [b for b in await bookings_repo.list_for_trip(trip_id) if b.get("agencyId") == agency_id]


# ── D2 port: profile changes ──────────────────────────────────────────────────
async def refresh_customer_contact(
    uid: str, *, name: str | None = None, phone: str | None = None, now: datetime
) -> int:
    """Refresh ``display.customerName/customerPhone`` on the customer's open bookings (P2 §6.5)."""
    rows = await bookings_repo.list_open_for_customer(uid)
    n = 0
    for b in rows:
        d = dict(b.get("display") or {})
        if name:
            d["customerName"] = name
        if phone:
            d["customerPhone"] = phone
        if d != (b.get("display") or {}):
            await bookings_repo.update(b["id"], {"display": d, "updatedAt": now})
            n += 1
    return n


async def refresh_display_name(*, field: str, key: str, value: str, name: str) -> int:
    """D3 port: refresh ``display.<field>`` (agencyName / driverName) on open bookings where ``<key> == value``."""
    if field not in ("agencyName", "driverName", "customerName") or key not in ("agencyId", "driverId", "customerId"):
        raise ValueError(f"unsupported display refresh {field}/{key}")
    q = (
        get_db()
        .collection(C.bookings)
        .where(filter=FieldFilter(key, "==", value))
        .where(filter=FieldFilter("status", "in", list(bm.OPEN_STATUSES)))
        .limit(500)
    )
    n = 0
    async for snap in q.stream():
        d = snap.to_dict() or {}
        if (d.get("display") or {}).get(field) != name:
            await snap.reference.update({f"display.{field}": name})
            n += 1
    return n


async def run_jobs_after_commit(job_ids: Sequence[str], now: datetime) -> None:
    if job_ids:
        await jobs_service.run_jobs(list(job_ids), now)


__all__ = [
    "Bundle",
    "Failure",
    "RequestResult",
    "TripBookings",
    "TripCloseResult",
    "accept",
    "actor_of",
    "add_remark",
    "apply_payment_result",
    "apply_refund_result",
    "cancel_by_customer",
    "close_for_trip_cancel",
    "decrypt_otp",
    "deliver",
    "driver_can_see",
    "due_expiry",
    "expire_if_due",
    "expire_payment_window",
    "fan_out_driver",
    "list_for_trip",
    "load_for_payment",
    "load_trip_bookings",
    "manual_step",
    "pickup",
    "read_bundle",
    "refresh_customer_contact",
    "refuse_pickup",
    "regenerate_otp",
    "reject",
    "request_booking",
    "review",
    "start_payment",
    "tx_checkpoint_fanout",
]
