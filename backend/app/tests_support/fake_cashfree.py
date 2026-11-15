"""FakeCashfree (P2 §15.4): an in-memory ``CashfreeClient`` that answers *as Cashfree would*.

It is not a payment simulator in the product: tests drive outcomes explicitly
(``mark_paid``, ``mark_failed``, ``mark_dropped``, ``expire``) and the app still has to confirm
through ``GET /orders`` exactly as in production. ``signed_webhook`` builds a body + headers signed
with the test secret. Refunds settle on the next fetch unless ``refunds_fail`` is set.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

from app.integrations.cashfree.errors import CashfreeError
from app.integrations.cashfree.models import CfOrder, CfPayment, CfRefund, CreateOrderRequest, paise_to_rupees_wire
from app.integrations.cashfree.webhook import compute_signature

TEST_SECRET = "cf_test_secret_key_for_unit_tests_only"  # noqa: S105 - test-only value


@dataclass
class _Order:
    req: CreateOrderRequest
    status: str = "ACTIVE"
    payments: list[CfPayment] = field(default_factory=list)
    refunds: dict[str, CfRefund] = field(default_factory=dict)


class FakeCashfreeClient:
    def __init__(self) -> None:
        self.orders: dict[str, _Order] = {}
        self.calls: list[tuple[str, str]] = []
        self.fail_next: CashfreeError | None = None
        self.refunds_fail = False
        self._seq = 1000

    def _next_id(self) -> int:
        self._seq += 1
        return self._seq

    def _maybe_fail(self) -> None:
        if self.fail_next is not None:
            err, self.fail_next = self.fail_next, None
            raise err

    def _order(self, order_id: str) -> _Order:
        o = self.orders.get(order_id)
        if o is None:
            raise CashfreeError(http_status=404, cf_code="order_not_found")
        return o

    # -- CashfreeClient -------------------------------------------------------------------------
    async def create_order(self, req: CreateOrderRequest, *, request_id: str | None = None) -> CfOrder:
        self.calls.append(("create_order", req.order_id))
        self._maybe_fail()
        if req.order_id in self.orders:
            raise CashfreeError(http_status=409, cf_code="order_already_exists")
        self.orders[req.order_id] = _Order(req)
        return self._cf_order(req.order_id)

    def _cf_order(self, order_id: str) -> CfOrder:
        o = self.orders[order_id]
        return CfOrder(
            order_id=order_id,
            cf_order_id=str(abs(hash(order_id)) % 10**9),
            order_status=o.status,
            order_amount=paise_to_rupees_wire(o.req.amount_paise),
            order_currency="INR",
            payment_session_id=f"session_{order_id}",
        )

    async def get_order(self, order_id: str, *, request_id: str | None = None) -> CfOrder:
        self.calls.append(("get_order", order_id))
        self._maybe_fail()
        self._order(order_id)
        return self._cf_order(order_id)

    async def get_order_payments(self, order_id: str, *, request_id: str | None = None) -> list[CfPayment]:
        self.calls.append(("get_order_payments", order_id))
        return list(self._order(order_id).payments)

    async def create_refund(
        self, order_id: str, *, refund_id: str, amount_paise: int, note: str, request_id: str | None = None
    ) -> CfRefund:
        self.calls.append(("create_refund", order_id))
        self._maybe_fail()
        o = self._order(order_id)
        if refund_id in o.refunds:
            raise CashfreeError(http_status=409, cf_code="refund_already_exists")
        r = CfRefund(
            refund_id=refund_id,
            cf_refund_id=str(self._next_id()),
            order_id=order_id,
            refund_amount=paise_to_rupees_wire(amount_paise),
            refund_status="PENDING",
        )
        o.refunds[refund_id] = r
        return r

    async def get_refund(self, order_id: str, refund_id: str, *, request_id: str | None = None) -> CfRefund:
        self.calls.append(("get_refund", order_id))
        o = self._order(order_id)
        r = o.refunds.get(refund_id)
        if r is None:
            raise CashfreeError(http_status=404, cf_code="refund_not_found")
        settled = r.model_copy(update={"refund_status": "CANCELLED" if self.refunds_fail else "SUCCESS"})
        o.refunds[refund_id] = settled
        return settled

    # -- test drivers --------------------------------------------------------------------------
    def _payment(self, order_id: str, status: str, amount_rupees: float | None, group: str = "upi") -> CfPayment:
        o = self._order(order_id)
        amount = amount_rupees if amount_rupees is not None else paise_to_rupees_wire(o.req.amount_paise)
        p = CfPayment(
            cf_payment_id=self._next_id(),
            order_id=order_id,
            payment_status=status,
            payment_amount=amount,
            payment_time=f"2026-11-16T10:{len(o.payments):02d}:00+05:30",
            payment_group=group,
            payment_method={"upi": {"upi_id": "masked@upi"}}
            if group == "upi"
            else {"card": {"card_number": "XXXXXXXXXXXX4242"}},
        )
        o.payments.append(p)
        return p

    def mark_paid(self, order_id: str, amount_rupees: float | None = None, group: str = "upi") -> CfPayment:
        p = self._payment(order_id, "SUCCESS", amount_rupees, group)
        self.orders[order_id].status = "PAID"
        return p

    def mark_failed(self, order_id: str) -> CfPayment:
        return self._payment(order_id, "FAILED", None)

    def mark_dropped(self, order_id: str) -> CfPayment:
        return self._payment(order_id, "USER_DROPPED", None)

    def expire(self, order_id: str) -> None:
        self._order(order_id).status = "EXPIRED"


def signed_webhook(
    event_type: str,
    order_id: str,
    *,
    payment: CfPayment | None = None,
    refund: dict[str, Any] | None = None,
    amount_rupees: float = 0.0,
    secret: str = TEST_SECRET,
    timestamp: str | None = None,
) -> tuple[bytes, dict[str, str]]:
    """A Cashfree-style webhook body and its signature headers (version 2025-01-01)."""
    data: dict[str, Any] = {"order": {"order_id": order_id, "order_amount": amount_rupees, "order_currency": "INR"}}
    if payment is not None:
        data["payment"] = payment.model_dump(exclude_none=True)
    if refund is not None:
        data["refund"] = {"order_id": order_id, **refund}
    data["customer_details"] = {"customer_name": "Test", "customer_phone": "9999999999"}
    body = json.dumps(
        {"data": data, "event_time": "2026-11-16T10:00:00+05:30", "type": event_type}, separators=(",", ":")
    ).encode()
    ts = timestamp or str(int(time.time() * 1000))
    headers = {
        "x-webhook-signature": compute_signature(secret, ts, body),
        "x-webhook-timestamp": ts,
        "x-webhook-version": "2025-01-01",
        "content-type": "application/json",
    }
    return body, headers
