"""Payments (P2 §10): orders, verify, signed webhook, the single confirmation path, refunds. Owner: D5.

Invariants:
- The amount always comes from the booking (``pricing.totalPayable × 100``), never from the client.
- Nothing the browser sends can mark a payment paid. Only :func:`PaymentService.confirm_payment`
  applies an outcome, and only with an ``OrderStatus`` obtained from the gateway API (``GET /orders``)
  or, for the local/e2e dev gateway, from its explicit Approve call.
- A late or duplicate success never changes a booking: it is refunded.

Booking state belongs to D4. This module reaches bookings only through :class:`BookingPaymentPort`,
implemented by ``app.services.booking_service`` (module-level functions with these exact names).
Every ``tx`` method must respect Firestore's rule "all reads before any write": ``load_for_payment``
only reads; the other ``tx`` methods only write, and they write with partial ``tx.update`` calls so
two of them can be applied to the same booking in one transaction (e.g. expire + refund notice).
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal, Protocol

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.ids import new_id
from app.core.pagination import decode_cursor, encode_cursor
from app.integrations.cashfree import (
    CashfreeError,
    CreateOrderRequest,
    GatewayRegistry,
    OrderStatus,
    RefundResult,
    WebhookNotConfigured,
    get_gateways,
    parse_event,
    verify_webhook,
)
from app.integrations.cashfree.webhook import event_type_of, redact_payload
from app.models.payment import (
    OPEN_STATUSES,
    SUCCEEDED_STATUSES,
    TERMINAL_FAILED,
    Confirmation,
    PaymentAttempt,
    PaymentDoc,
    RefundInfo,
    WebhookEventDoc,
)
from app.repositories import idempotency as idem_repo
from app.repositories import payments as payments_repo
from app.repositories import webhook_events as events_repo
from app.repositories.base import run_transaction
from app.schemas.payments import (
    BookingStateDTO,
    CreatePaymentOrderResponse,
    PaymentHistoryItem,
    PaymentHistoryPage,
    PaymentStatusResponse,
    RefundDTO,
)
from app.services import jobs_service

log = logging.getLogger("taki.payments")

ORDER_TTL = timedelta(minutes=30)
CASHFREE_MIN_TTL = timedelta(minutes=15)  # Cashfree's minimum order_expiry_time and our checkout grace
REUSE_MARGIN = timedelta(minutes=2)
RECONCILE_AFTER = timedelta(minutes=10)
MAX_ATTEMPTS_KEPT = 20
IDEMPOTENCY_SCOPE = "payment_order"
IST_OFFSET = timedelta(hours=5, minutes=30)

PAYABLE_PAYMENT_STATUSES = frozenset({"due", "processing", "failed"})

Source = Literal["webhook", "verify", "reconcile", "dev_confirm"]
Outcome = Literal["applied", "duplicate", "ignored"]


# ── The booking port D4 implements (app/services/booking_service.py) ────────────────────────


@dataclass(frozen=True)
class PayableBooking:
    """A read-only snapshot of a booking for payments, built by D4 inside the transaction."""

    id: str
    customer_id: str
    agency_id: str | None
    amount_paise: int  # pricing.totalPayable * 100
    approval_status: str  # ApprovalStatus
    payment_status: str  # BookingPaymentStatus
    reservation_status: str  # ReservationStatus
    fulfilment_status: str
    closed: bool  # a closure record exists (rejected / cancelled)
    payment_id: str | None  # booking.paymentId (latest attempt)
    payment_due_at: datetime | None
    hold_active: bool  # held with dueAt > now, or committed
    hold_refittable: bool  # hold lapsed, but capacity for the booking's legs still fits now
    customer_name: str
    customer_phone: str  # E.164
    route_label: str | None
    status: str  # derived legacy BookingStatus
    closure: dict[str, Any] | None = None
    raw: Any = field(default=None, repr=False, compare=False)  # D4's opaque bundle (booking, trip, …)

    @property
    def payable(self) -> bool:
        return (
            self.approval_status == "accepted" and self.payment_status in PAYABLE_PAYMENT_STATUSES and not self.closed
        )

    def window_open(self, now: datetime) -> bool:
        return (
            self.hold_active or self.hold_refittable or (self.payment_due_at is not None and self.payment_due_at > now)
        )


class BookingPaymentPort(Protocol):
    async def load_for_payment(
        self, tx: AsyncTransaction | None, booking_id: str, *, now: datetime
    ) -> PayableBooking | None:
        """READS ONLY. Booking (+ trip hold, customer display data). ``None`` if it does not exist."""
        ...

    async def start_payment(
        self, tx: AsyncTransaction, booking: PayableBooking, *, payment_id: str, hold_due_at: datetime, now: datetime
    ) -> None:
        """WRITES ONLY. ``paymentStatus`` due|failed → processing, ``paymentId = payment_id``,
        trip hold ``dueAt = max(dueAt, hold_due_at)`` (checkout grace)."""
        ...

    async def apply_payment_result(
        self,
        tx: AsyncTransaction,
        booking: PayableBooking,
        *,
        payment: PaymentDoc,
        result: Literal["paid", "failed", "expired"],
        now: datetime,
    ) -> None:
        """WRITES ONLY. Called only when ``booking.payment_id == payment.id`` (failed/expired) or the
        booking is payable with an active or refittable hold (paid).

        - ``paid``: hold → committed, ``paymentStatus = paid``, ``paidAt``, ``paymentId``, driver
          assignment, pickup/delivery OTPs (``bookingSecrets``), shipment → booked, events, notifications.
        - ``failed``: ``paymentStatus`` processing → failed (customer may retry until ``paymentDueAt``).
        - ``expired``: order expired with the window still open → ``paymentStatus`` → due.
        """
        ...

    async def expire_payment_window(self, tx: AsyncTransaction, booking: PayableBooking, *, now: datetime) -> None:
        """WRITES ONLY. Lazy expiry: the payment window closed (release hold, paymentStatus → expired)."""
        ...

    async def apply_refund_result(
        self, tx: AsyncTransaction, booking: PayableBooking, *, payment: PaymentDoc, now: datetime
    ) -> None:
        """WRITES ONLY. ``payment.status`` became refund_pending | refunded | refund_failed. Mirror it onto
        ``booking.paymentStatus`` only when ``booking.payment_id == payment.id`` and notify the customer
        (refund started / completed / failed → admin queue)."""
        ...


class _BookingServiceMissing:
    async def load_for_payment(self, tx: AsyncTransaction | None, booking_id: str, *, now: datetime) -> None:
        raise AppError("not_implemented", "Bookings are not available yet.")

    async def start_payment(self, *a: Any, **k: Any) -> None:  # pragma: no cover
        raise AppError("not_implemented")

    async def apply_payment_result(self, *a: Any, **k: Any) -> None:  # pragma: no cover
        raise AppError("not_implemented")

    async def expire_payment_window(self, *a: Any, **k: Any) -> None:  # pragma: no cover
        raise AppError("not_implemented")

    async def apply_refund_result(self, *a: Any, **k: Any) -> None:  # pragma: no cover
        raise AppError("not_implemented")


def get_booking_port() -> BookingPaymentPort:
    try:
        from app.services import booking_service  # D4
    except ImportError:
        return _BookingServiceMissing()  # type: ignore[return-value]
    required = (
        "load_for_payment",
        "start_payment",
        "apply_payment_result",
        "expire_payment_window",
        "apply_refund_result",
    )
    if not all(hasattr(booking_service, n) for n in required):
        return _BookingServiceMissing()  # type: ignore[return-value]
    return booking_service  # type: ignore[return-value]


# ── Results ──────────────────────────────────────────────────────────────────────────────────


@dataclass
class ConfirmResult:
    payment: PaymentDoc | None
    outcome: Outcome
    job_ids: list[str] = field(default_factory=list)


@dataclass
class OrderResult:
    response: CreatePaymentOrderResponse
    created: bool  # 201 vs 200 (reused)
    job_ids: list[str] = field(default_factory=list)


def _ist_iso(dt: datetime) -> str:
    return (dt + IST_OFFSET).replace(tzinfo=None, microsecond=0).isoformat() + "+05:30"


def _refund_dto(p: PaymentDoc) -> RefundDTO | None:
    if p.refund is None:
        return None
    return RefundDTO(
        status=p.refund.status, amount_rupees=round(p.refund.amount_paise / 100), completed_at=p.refund.completed_at
    )


def _with_attempt(p: PaymentDoc, s: OrderStatus, now: datetime) -> list[PaymentAttempt]:
    if not s.provider_payment_id and s.status == "pending":
        return p.attempts
    entry = PaymentAttempt(
        provider_payment_id=s.provider_payment_id, status=s.provider_status, at=now, method_label=s.method_label
    )
    return [*p.attempts, entry][-MAX_ATTEMPTS_KEPT:]


# ── Service ──────────────────────────────────────────────────────────────────────────────────


class PaymentService:
    def __init__(self, gateways: GatewayRegistry | None = None, bookings: BookingPaymentPort | None = None) -> None:
        self.gateways = gateways or get_gateways()
        self.bookings = bookings or get_booking_port()

    # -- helpers ----------------------------------------------------------------------------------
    def _checkout(self, p: PaymentDoc) -> dict[str, Any]:
        gw = self.gateways.for_provider(p.provider)
        return gw.checkout_for(p.id, p.payment_session_id)

    def _order_response(self, p: PaymentDoc, *, reused: bool) -> CreatePaymentOrderResponse:
        return CreatePaymentOrderResponse.model_validate(
            {
                "paymentId": p.id,
                "provider": p.provider,
                "amountRupees": p.amount_rupees,
                "expiresAt": p.expires_at,
                "checkout": self._checkout(p),
                "reused": reused,
                "testPayment": p.test_payment,
            }
        )

    def _status_response(self, p: PaymentDoc, b: PayableBooking | None) -> PaymentStatusResponse:
        return PaymentStatusResponse(
            payment_id=p.id,
            booking_id=p.booking_id,
            status=p.status,
            booking_status=b.status if b else "cancelled",
            booking_state=BookingStateDTO(
                approval_status=b.approval_status,
                payment_status=b.payment_status,
                reservation_status=b.reservation_status,
                fulfilment_status=b.fulfilment_status,
                closure=b.closure,
            )
            if b
            else None,
            amount_rupees=p.amount_rupees,
            provider=p.provider,
            method_label=p.method_label,
            failure_reason=p.failure_reason,
            refund=_refund_dto(p),
            test_payment=p.test_payment,
        )

    async def _owned_payment(self, user: CurrentUser, payment_id: str) -> PaymentDoc:
        p = await payments_repo.get(payment_id) if payment_id.startswith("pay_") else None
        if p is None or user.role != "customer" or p.customer_id != user.uid:
            raise AppError("not_found")
        return p

    # -- E42 create order -------------------------------------------------------------------------
    async def create_order(
        self, user: CurrentUser, booking_id: str, idempotency_key: str, *, now: datetime, request_id: str | None = None
    ) -> OrderResult:
        if user.role != "customer":
            raise AppError("forbidden")
        gateway = self.gateways.current()  # 501 payments_not_configured before touching anything
        request_hash = hashlib.sha256(f"order:{booking_id}".encode()).hexdigest()
        new_payment_id = new_id("pay")

        async def tx1(tx: AsyncTransaction) -> tuple[str, PaymentDoc | None, PayableBooking | None, AppError | None]:
            # READS
            record = await idem_repo.tx_get_record(tx, IDEMPOTENCY_SCOPE, user.uid, idempotency_key)
            booking = await self.bookings.load_for_payment(tx, booking_id, now=now)
            existing = await payments_repo.tx_list_for_booking(tx, booking_id)
            if record is not None:
                if record.get("requestHash") != request_hash:
                    raise AppError("idempotency_key_reused")
                replay = next((p for p in existing if p.id == (record.get("body") or {}).get("paymentId")), None)
                if replay is not None:
                    return "reused", replay, booking, None
            if booking is None or booking.customer_id != user.uid:
                raise AppError("not_found")
            if booking.payment_status == "paid" or booking.reservation_status == "committed":
                raise AppError("already_paid")
            if not booking.payable:
                raise AppError("invalid_transition", "This booking can't be paid right now.")
            open_payments = [p for p in existing if p.status in OPEN_STATUSES]
            # WRITES
            if not booking.window_open(now):
                for p in open_payments:
                    payments_repo.tx_put(
                        tx,
                        p.model_copy(
                            update={
                                "status": "cancelled",
                                "failure_reason": "expired",
                                "updated_at": now,
                                "version": p.version + 1,
                            }
                        ),
                    )
                await self.bookings.expire_payment_window(tx, booking, now=now)
                return "failed", None, booking, AppError("payment_window_closed")
            reusable = next(
                (
                    p
                    for p in open_payments
                    if p.status == "pending" and p.provider == gateway.provider and p.expires_at > now + REUSE_MARGIN
                ),
                None,
            )
            if reusable is not None:
                idem_repo.tx_put(
                    tx,
                    scope=IDEMPOTENCY_SCOPE,
                    uid=user.uid,
                    key=idempotency_key,
                    request_hash=request_hash,
                    status=200,
                    body={"paymentId": reusable.id},
                    now=now,
                )
                return "reused", reusable, booking, None
            for p in open_payments:
                payments_repo.tx_put(
                    tx,
                    p.model_copy(
                        update={
                            "status": "cancelled",
                            "failure_reason": "superseded",
                            "updated_at": now,
                            "version": p.version + 1,
                        }
                    ),
                )
            due = booking.payment_due_at or now + ORDER_TTL
            expires_at = max(min(due, now + ORDER_TTL), now + CASHFREE_MIN_TTL)
            hold_due_at = max(due, expires_at)
            payment = PaymentDoc(
                id=new_payment_id,
                booking_id=booking.id,
                customer_id=booking.customer_id,
                agency_id=booking.agency_id,
                provider=gateway.provider,
                provider_env=gateway.env,  # type: ignore[arg-type]
                test_payment=gateway.provider == "dev",
                amount_paise=booking.amount_paise,
                status="created",
                idempotency_key=idempotency_key,
                expires_at=expires_at,
                route_label=booking.route_label,
                created_at=now,
                updated_at=now,
            )
            payments_repo.tx_create(tx, payment)
            await self.bookings.start_payment(tx, booking, payment_id=payment.id, hold_due_at=hold_due_at, now=now)
            idem_repo.tx_put(
                tx,
                scope=IDEMPOTENCY_SCOPE,
                uid=user.uid,
                key=idempotency_key,
                request_hash=request_hash,
                status=201,
                body={"paymentId": payment.id},
                now=now,
            )
            return "created", payment, booking, None

        kind, payment, booking, failure = await run_transaction(tx1)
        if failure is not None:
            raise failure
        assert payment is not None and booking is not None  # noqa: S101 - narrowed by tx1
        if kind == "reused":
            if payment.status == "created":  # a replay racing the first call: let the client retry
                raise AppError("contention")
            return OrderResult(self._order_response(payment, reused=True), created=False)

        try:
            created = await gateway.create_order(
                CreateOrderRequest(
                    order_id=payment.id,
                    amount_paise=payment.amount_paise,
                    customer_id=user.uid,
                    customer_phone=booking.customer_phone or user.phone,
                    customer_name=booking.customer_name or user.name,
                    return_url=self.gateways.settings.return_url(payment.id),
                    notify_url=self.gateways.settings.notify_url(),
                    expires_at_iso=_ist_iso(payment.expires_at),
                    tags={"bookingId": booking.id},
                ),
                request_id=request_id,
            )
        except CashfreeError:
            await self._mark_gateway_error(payment.id, now)
            raise

        async def tx2(tx: AsyncTransaction) -> PaymentDoc:
            p = await payments_repo.tx_get_payment(tx, payment.id)
            if p is None:
                raise AppError("not_found")
            if p.status != "created":
                return p
            nxt = p.model_copy(
                update={
                    "status": "pending",
                    "payment_session_id": created.payment_session_id,
                    "provider_order_status": created.provider_order_status,
                    "updated_at": now,
                    "version": p.version + 1,
                }
            )
            payments_repo.tx_put(tx, nxt)
            return nxt

        stored = await run_transaction(tx2)
        return OrderResult(self._order_response(stored, reused=False), created=True)

    async def _mark_gateway_error(self, payment_id: str, now: datetime) -> None:
        async def fn(tx: AsyncTransaction) -> None:
            p = await payments_repo.tx_get_payment(tx, payment_id)
            if p is None or p.status != "created":
                return
            b = await self.bookings.load_for_payment(tx, p.booking_id, now=now)
            failed = p.model_copy(
                update={
                    "status": "failed",
                    "failure_reason": "gateway_error",
                    "updated_at": now,
                    "version": p.version + 1,
                }
            )
            payments_repo.tx_put(tx, failed)
            if b is not None and b.payment_id == p.id and b.payable:
                await self.bookings.apply_payment_result(tx, b, payment=failed, result="failed", now=now)

        await run_transaction(fn)

    # -- E43 / E44 ------------------------------------------------------------------------------------
    async def get_status(self, user: CurrentUser, payment_id: str, *, now: datetime) -> PaymentStatusResponse:
        p = await self._owned_payment(user, payment_id)
        b = await self.bookings.load_for_payment(None, p.booking_id, now=now)
        return self._status_response(p, b)

    async def verify(
        self, user: CurrentUser, payment_id: str, *, now: datetime, request_id: str | None = None
    ) -> tuple[PaymentStatusResponse, list[str]]:
        p = await self._owned_payment(user, payment_id)
        job_ids: list[str] = []
        if p.status in OPEN_STATUSES or p.status in TERMINAL_FAILED:
            if p.provider == "dev":
                if p.status in OPEN_STATUSES and p.expires_at <= now:
                    r = await self.confirm_payment(
                        p.id, OrderStatus("expired", None, None, None, "DEV_EXPIRED", "expired"), "verify", now=now
                    )
                    job_ids = r.job_ids
            else:
                gw = self.gateways.for_provider(p.provider)  # 501 when Cashfree is not configured
                try:
                    status = await gw.fetch_order_status(p.id, request_id=request_id)
                except CashfreeError as exc:
                    b = await self.bookings.load_for_payment(None, p.booking_id, now=now)
                    stored = self._status_response(p, b).model_dump(by_alias=True, mode="json")
                    raise AppError("gateway_error", details={"payment": stored}) from exc
                r = await self.confirm_payment(p.id, status, "verify", now=now)
                job_ids = r.job_ids
        return await self.get_status(user, payment_id, now=now), job_ids

    # -- the single confirmation path (P2 §10.5) --------------------------------------------------
    async def confirm_payment(
        self,
        payment_id: str,
        result: OrderStatus,
        source: Source,
        *,
        now: datetime,
        event: WebhookEventDoc | None = None,
    ) -> ConfirmResult:
        async def fn(tx: AsyncTransaction) -> ConfirmResult:
            # READS
            if event is not None and await events_repo.tx_exists(tx, event.event_key):
                return ConfirmResult(None, "duplicate")
            p = await payments_repo.tx_get_payment(tx, payment_id)
            if p is None:
                return ConfirmResult(None, "ignored")
            b = await self.bookings.load_for_payment(tx, p.booking_id, now=now)
            siblings = await payments_repo.tx_list_for_booking(tx, p.booking_id) if result.status == "paid" else []
            # WRITES
            res = await self._apply(tx, p, b, siblings, result, source, now)
            if event is not None:
                events_repo.tx_create(
                    tx, event.model_copy(update={"outcome": res.outcome, "processed_at": now, "payment_id": p.id})
                )
            return res

        return await run_transaction(fn)

    async def _apply(
        self,
        tx: AsyncTransaction,
        p: PaymentDoc,
        b: PayableBooking | None,
        siblings: list[PaymentDoc],
        s: OrderStatus,
        source: Source,
        now: datetime,
    ) -> ConfirmResult:
        if p.status in SUCCEEDED_STATUSES or s.status == "pending":
            return ConfirmResult(p, "ignored")
        confirmation = Confirmation(source=source, at=now, provider_status=s.provider_status)
        attempts = _with_attempt(p, s, now)

        if s.status in ("failed", "expired"):
            if p.status in TERMINAL_FAILED:
                return ConfirmResult(p, "ignored")
            nxt = p.model_copy(
                update={
                    "status": "failed" if s.status == "failed" else "cancelled",
                    "failure_reason": s.failure_reason or ("declined" if s.status == "failed" else "expired"),
                    "provider_payment_id": s.provider_payment_id or p.provider_payment_id,
                    "method_label": s.method_label or p.method_label,
                    "provider_order_status": s.provider_status,
                    "confirmation": confirmation,
                    "attempts": attempts,
                    "updated_at": now,
                    "version": p.version + 1,
                }
            )
            payments_repo.tx_put(tx, nxt)
            if b is not None and b.payment_id == p.id and b.payable:
                if s.status == "expired" and not b.window_open(now):
                    await self.bookings.expire_payment_window(tx, b, now=now)
                else:
                    await self.bookings.apply_payment_result(tx, b, payment=nxt, result=s.status, now=now)
            return ConfirmResult(nxt, "applied")

        # ── paid ──
        if s.amount_paise is None or s.amount_paise != p.amount_paise:
            log.error(
                "OPS ALERT: amount mismatch on payment %s (expected %s, got %s)", p.id, p.amount_paise, s.amount_paise
            )
            nxt = p.model_copy(
                update={
                    "status": "failed",
                    "failure_reason": "amount_mismatch",
                    "provider_payment_id": s.provider_payment_id,
                    "confirmation": confirmation,
                    "attempts": attempts,
                    "updated_at": now,
                    "version": p.version + 1,
                }
            )
            payments_repo.tx_put(tx, nxt)
            if b is not None and b.payment_id == p.id and b.payable:
                await self.bookings.apply_payment_result(tx, b, payment=nxt, result="failed", now=now)
            return ConfirmResult(nxt, "applied")

        succeeded = p.model_copy(
            update={
                "status": "succeeded",
                "failure_reason": None,
                "provider_payment_id": s.provider_payment_id,
                "method_label": s.method_label,
                "provider_order_status": s.provider_status,
                "paid_at": now,
                "confirmation": confirmation,
                "attempts": attempts,
                "updated_at": now,
                "version": p.version + 1,
            }
        )
        if b is None:
            return self._refund(tx, succeeded, None, "late_payment", now)
        if b.payment_status == "paid":
            return await self._refund_and_mirror(tx, succeeded, b, "duplicate_payment", now)
        if b.payable and (b.hold_active or b.hold_refittable) and b.amount_paise == p.amount_paise:
            payments_repo.tx_put(tx, succeeded)
            for other in siblings:
                if other.id != p.id and other.status in OPEN_STATUSES:
                    payments_repo.tx_put(
                        tx,
                        other.model_copy(
                            update={
                                "status": "cancelled",
                                "failure_reason": "superseded",
                                "updated_at": now,
                                "version": other.version + 1,
                            }
                        ),
                    )
            await self.bookings.apply_payment_result(tx, b, payment=succeeded, result="paid", now=now)
            return ConfirmResult(succeeded, "applied")
        if b.payable and not b.window_open(now):
            await self.bookings.expire_payment_window(tx, b, now=now)
        return await self._refund_and_mirror(tx, succeeded, b, "late_payment", now)

    def _refund(
        self, tx: AsyncTransaction, p: PaymentDoc, b: PayableBooking | None, reason: str, now: datetime
    ) -> ConfirmResult:
        nxt = start_refund_doc(p, reason, now)
        payments_repo.tx_put(tx, nxt)
        job_id = jobs_service.tx_enqueue(tx, "refund", {"paymentId": p.id}, now)
        return ConfirmResult(nxt, "applied", [job_id])

    async def _refund_and_mirror(
        self, tx: AsyncTransaction, p: PaymentDoc, b: PayableBooking, reason: str, now: datetime
    ) -> ConfirmResult:
        r = self._refund(tx, p, b, reason, now)
        assert r.payment is not None  # noqa: S101
        await self.bookings.apply_refund_result(tx, b, payment=r.payment, now=now)
        return r

    # -- E45 webhook ----------------------------------------------------------------------------------
    async def handle_cashfree_webhook(
        self, raw_body: bytes, headers: dict[str, str], *, now: datetime, request_id: str | None = None
    ) -> ConfirmResult:
        secret = self.gateways.webhook_secret()
        if not secret:
            raise WebhookNotConfigured()
        verify_webhook(
            secret=secret,
            headers=headers,
            raw_body=raw_body,
            now=now,
            tolerance_seconds=self.gateways.settings.CASHFREE_WEBHOOK_TOLERANCE_SECONDS,
        )
        body_hash = hashlib.sha256(raw_body).hexdigest()
        ev = parse_event(raw_body)
        if ev is None:
            await self._record_ignored(f"{event_type_of(raw_body) or 'UNKNOWN'}:{body_hash}", raw_body, body_hash, now)
            return ConfirmResult(None, "ignored")
        record = WebhookEventDoc(
            id=events_repo.event_id(ev.event_key),
            type=ev.type,
            event_key=ev.event_key,
            order_id=ev.order_id,
            raw_body_sha256=body_hash,
            payload=redact_payload(raw_body),
            received_at=now,
            outcome="applied",
        )
        payment = await payments_repo.get(ev.order_id) if ev.order_id.startswith("pay_") else None
        if payment is None or payment.provider != "cashfree":
            log.warning("cashfree webhook for an unknown order (ignored)")
            await self._record_ignored(ev.event_key, raw_body, body_hash, now, ev.type, ev.order_id)
            return ConfirmResult(None, "ignored")
        if ev.kind == "refund_status":
            assert ev.refund_status is not None  # noqa: S101 - parse_event sets it for refunds
            return await self.apply_refund_result(
                payment.id,
                RefundResult(ev.refund_status, ev.provider_refund_id, ev.provider_status),
                now=now,
                event=record,
                final=ev.refund_status == "failed",
            )
        if await events_repo.get(ev.event_key) is not None:  # cheap pre-check; the tx re-checks
            return ConfirmResult(payment, "duplicate")
        # The webhook is only a trigger: the Cashfree API answer is the truth (P2 §10.4 step 6).
        gw = self.gateways.for_provider("cashfree")
        status = await gw.fetch_order_status(payment.id, request_id=request_id)
        return await self.confirm_payment(payment.id, status, "webhook", now=now, event=record)

    async def _record_ignored(
        self,
        key: str,
        raw: bytes,
        body_hash: str,
        now: datetime,
        type_: str | None = None,
        order_id: str | None = None,
    ) -> None:
        doc = WebhookEventDoc(
            id=events_repo.event_id(key),
            type=type_ or event_type_of(raw) or "UNKNOWN",
            event_key=key,
            order_id=order_id,
            raw_body_sha256=body_hash,
            payload=redact_payload(raw),
            received_at=now,
            processed_at=now,
            outcome="ignored",
        )
        await events_repo.put(doc)

    # -- refunds ------------------------------------------------------------------------------------
    async def apply_refund_result(
        self,
        payment_id: str,
        result: RefundResult,
        *,
        now: datetime,
        final: bool = False,
        event: WebhookEventDoc | None = None,
    ) -> ConfirmResult:
        """Refund outcome from the job runner or ``REFUND_STATUS_WEBHOOK`` (idempotent).

        ``failed`` becomes ``refund_failed`` only when ``final`` (the job gave up, or Cashfree cancelled it).
        """

        async def fn(tx: AsyncTransaction) -> ConfirmResult:
            if event is not None and await events_repo.tx_exists(tx, event.event_key):
                return ConfirmResult(None, "duplicate")
            p = await payments_repo.tx_get_payment(tx, payment_id)
            b = await self.bookings.load_for_payment(tx, p.booking_id, now=now) if p else None
            res = ConfirmResult(p, "ignored")
            if p is not None and p.refund is not None and p.status in ("refund_pending", "refund_failed"):
                refund = p.refund
                if result.status == "succeeded":
                    nxt = p.model_copy(
                        update={
                            "status": "refunded",
                            "refund": refund.model_copy(
                                update={
                                    "status": "succeeded",
                                    "completed_at": now,
                                    "provider_refund_id": result.provider_refund_id or refund.provider_refund_id,
                                }
                            ),
                            "updated_at": now,
                            "version": p.version + 1,
                        }
                    )
                elif result.status == "failed" and final and p.status == "refund_pending":
                    nxt = p.model_copy(
                        update={
                            "status": "refund_failed",
                            "refund": refund.model_copy(update={"status": "failed"}),
                            "updated_at": now,
                            "version": p.version + 1,
                        }
                    )
                else:
                    nxt = None
                if nxt is not None:
                    payments_repo.tx_put(tx, nxt)
                    if b is not None:
                        await self.bookings.apply_refund_result(tx, b, payment=nxt, now=now)
                    res = ConfirmResult(nxt, "applied")
            if event is not None:
                events_repo.tx_create(
                    tx, event.model_copy(update={"outcome": res.outcome, "processed_at": now, "payment_id": payment_id})
                )
            return res

        return await run_transaction(fn)

    async def tx_start_refund(
        self,
        tx: AsyncTransaction,
        payment: PaymentDoc,
        booking: PayableBooking | None,
        *,
        reason: str,
        now: datetime,
    ) -> str | None:
        """For D4 (pre-pickup cancel, refusal, trip cancel): WRITES ONLY, inside D4's transaction, after D4
        read the payment with ``payments_repo.tx_get_payment``. Returns the refund job id (run it after
        commit with ``jobs_service.run_jobs``), or ``None`` when the payment has nothing to refund.
        D4 updates the booking's own ``paymentStatus`` (→ refund_pending) in the same transaction."""
        if payment.status != "succeeded":
            return None
        return self._refund(tx, payment, booking, reason, now).job_ids[0]

    async def retry_refund(self, payment_id: str, *, now: datetime) -> tuple[PaymentDoc, list[str]]:
        """E128 (D2's admin router): ``refund_failed`` → ``refund_pending`` with a new job, same refund id."""
        p0 = await payments_repo.get(payment_id)
        if p0 is None:
            raise AppError("not_found")
        self.gateways.for_provider(p0.provider)  # 501 when the gateway is not configured

        async def fn(tx: AsyncTransaction) -> tuple[PaymentDoc, list[str]]:
            p = await payments_repo.tx_get_payment(tx, payment_id)
            if p is None:
                raise AppError("not_found")
            b = await self.bookings.load_for_payment(tx, p.booking_id, now=now)
            if p.status != "refund_failed" or p.refund is None:
                raise AppError("refund_not_allowed")
            nxt = p.model_copy(
                update={
                    "status": "refund_pending",
                    "refund": p.refund.model_copy(update={"status": "pending", "requested_at": now}),
                    "updated_at": now,
                    "version": p.version + 1,
                }
            )
            payments_repo.tx_put(tx, nxt)
            job_id = jobs_service.tx_enqueue(tx, "refund", {"paymentId": p.id}, now)
            if b is not None:
                await self.bookings.apply_refund_result(tx, b, payment=nxt, now=now)
            return nxt, [job_id]

        return await run_transaction(fn)

    async def run_refund_job(self, payload: dict[str, Any], now: datetime, attempts: int) -> jobs_service.JobOutcome:
        p = await payments_repo.get(str(payload.get("paymentId", "")))
        if p is None or p.refund is None:
            return jobs_service.JobOutcome("error", "payment_or_refund_missing")
        if p.status == "refunded":
            return jobs_service.JobOutcome("done")
        if p.status != "refund_pending":
            return jobs_service.JobOutcome("done", f"payment is {p.status}")
        gw = self.gateways.for_provider(p.provider)
        result: RefundResult | None = None
        if attempts > 1:  # an earlier attempt may have reached the gateway: ask before re-creating
            result = await gw.fetch_refund_status(p.id, p.refund.refund_id)
        if result is None or result.status == "failed":
            result = await gw.refund(
                p.id, refund_id=p.refund.refund_id, amount_paise=p.refund.amount_paise, reason=p.refund.reason
            )
        if result.status == "succeeded":
            await self.apply_refund_result(p.id, result, now=now)
            return jobs_service.JobOutcome("done")
        if result.status == "pending":
            return jobs_service.JobOutcome("wait", "refund pending at gateway")
        return jobs_service.JobOutcome("error", f"refund {result.provider_status}")

    async def on_refund_job_failed(self, payload: dict[str, Any], now: datetime) -> None:
        await self.apply_refund_result(
            str(payload.get("paymentId", "")), RefundResult("failed", None, "JOB_FAILED"), now=now, final=True
        )

    # -- dev gateway (local / e2e only) --------------------------------------------------------------
    async def dev_confirm(
        self,
        user: CurrentUser,
        payment_id: str,
        outcome: Literal["success", "failure"],
        dev_token: str,
        *,
        now: datetime,
    ) -> tuple[PaymentStatusResponse, list[str]]:
        dev = self.gateways.dev
        if dev is None:
            raise AppError("not_found")  # the route does not exist outside development/test
        p = await self._owned_payment(user, payment_id)
        if p.provider != "dev":
            raise AppError("not_found")
        if not dev.token_matches(p.id, dev_token):
            raise AppError("forbidden", "This test payment link is not valid.")
        if outcome == "success":
            status = OrderStatus("paid", p.amount_paise, f"dev_{p.id}", "Test payment", "DEV_APPROVED")
        else:
            status = OrderStatus("failed", None, None, "Test payment", "DEV_DECLINED", "declined")
        r = await self.confirm_payment(p.id, status, "dev_confirm", now=now)
        return await self.get_status(user, payment_id, now=now), r.job_ids

    # -- E46 history + agency/admin reads --------------------------------------------------------------
    async def history(self, user: CurrentUser, *, limit: int = 20, cursor: str | None = None) -> PaymentHistoryPage:
        if user.role != "customer":
            raise AppError("forbidden")
        c = decode_cursor(cursor)
        after_id = str(c.get("id", "")) if c else None
        if c is not None and not (after_id or "").startswith("pay_"):
            raise AppError("invalid_request", "Invalid cursor.", fields={"cursor": "Invalid cursor"})
        rows = await payments_repo.list_for_customer(user.uid, limit=limit + 1, after_id=after_id)
        page, more = rows[:limit], len(rows) > limit
        items = [
            PaymentHistoryItem(
                id=p.id,
                booking_id=p.booking_id,
                status=p.status,
                provider=p.provider,
                amount_rupees=p.amount_rupees,
                method_label=p.method_label,
                created_at=p.created_at,
                paid_at=p.paid_at,
                refund=_refund_dto(p),
                route_label=p.route_label,
                test_payment=p.test_payment,
            )
            for p in page
        ]
        nxt = encode_cursor({"id": page[-1].id}) if more and page else None
        return PaymentHistoryPage(items=items, next_cursor=nxt)

    async def agency_payments(self, agency_id: str) -> list[PaymentDoc]:
        """For D3's ``/agency/earnings``: succeeded and refunded payments only."""
        return await payments_repo.list_for_agency(
            agency_id, ["succeeded", "refund_pending", "refunded", "refund_failed"]
        )

    # -- sweep (D4's sweep_service calls these) -----------------------------------------------------
    async def reconcile_pending(self, *, now: datetime, limit: int = 25) -> tuple[int, list[str]]:
        """Sweep step 3: ``pending`` payments untouched for 10 minutes are re-checked with the gateway."""
        rows = await payments_repo.list_by_status_updated_before("pending", now - RECONCILE_AFTER, limit=limit)
        done, job_ids = 0, []
        for p in rows:
            try:
                if p.provider == "dev":
                    if p.expires_at > now:
                        continue
                    status = OrderStatus("expired", None, None, None, "DEV_EXPIRED", "expired")
                else:
                    status = await self.gateways.for_provider(p.provider).fetch_order_status(p.id)
            except AppError as exc:
                log.warning("reconcile %s skipped: %s", p.id, exc.code)
                continue
            r = await self.confirm_payment(p.id, status, "reconcile", now=now)
            done += 1 if r.outcome == "applied" else 0
            job_ids += r.job_ids
        return done, job_ids


def start_refund_doc(p: PaymentDoc, reason: str, now: datetime) -> PaymentDoc:
    """``succeeded`` → ``refund_pending`` with a refund record (refund id ``rf_`` + payment id suffix)."""
    refund = RefundInfo(
        refund_id="rf_" + p.id.removeprefix("pay_"),
        amount_paise=p.amount_paise,
        reason=reason,
        status="pending",
        requested_at=now,
    )
    return p.model_copy(
        update={"status": "refund_pending", "refund": refund, "updated_at": now, "version": p.version + 1}
    )


_service: PaymentService | None = None


def get_payment_service() -> PaymentService:
    """FastAPI dependency and accessor for other services (sweep, admin). Tests override it."""
    global _service
    if _service is None:
        _service = PaymentService()
        _register_job_handlers(_service)
    return _service


def set_payment_service(service: PaymentService | None) -> None:
    global _service
    _service = service
    if service is not None:
        _register_job_handlers(service)


async def retry_refund(payment_id: str, *, actor_uid: str, now: datetime | None = None) -> PaymentDoc:
    """E128 entry point for D2's admin router. Runs the new refund job immediately (the sweep retries)."""
    from app.core.clock import get_clock

    at = now or get_clock().now()
    payment, job_ids = await get_payment_service().retry_refund(payment_id, now=at)
    log.info("refund retry requested", extra={"fields": {"paymentId": payment_id, "actor": actor_uid}})
    await jobs_service.run_jobs(job_ids, at)
    return await payments_repo.get(payment_id) or payment


def _register_job_handlers(service: PaymentService) -> None:
    jobs_service.register_handler("refund", service.run_refund_job, service.on_refund_job_failed)


__all__ = [
    "BookingPaymentPort",
    "ConfirmResult",
    "OrderResult",
    "PayableBooking",
    "PaymentService",
    "get_booking_port",
    "get_payment_service",
    "set_payment_service",
    "start_refund_doc",
]
