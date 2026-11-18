"""Cashfree PG HTTP client (P2 §10.1). Owner: D5.

- Base URL ``https://sandbox.cashfree.com/pg`` or ``https://api.cashfree.com/pg``.
- Headers ``x-client-id``, ``x-client-secret``, ``x-api-version``, ``x-request-id`` and, on POST,
  ``x-idempotency-key``.
- 10 s timeout. POSTs are never retried automatically; GETs are retried twice on 5xx / transport errors.
- Logs carry only the HTTP status and Cashfree's error ``code``: never secrets, bodies or PII.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Protocol
from urllib.parse import quote

import httpx

from .errors import CashfreeError
from .models import CfOrder, CfPayment, CfRefund, CreateOrderRequest, paise_to_rupees_wire, ten_digit_phone

log = logging.getLogger("taki.cashfree")

GET_RETRIES = 2
GET_RETRY_BACKOFF_SECONDS = 0.25


class CashfreeClient(Protocol):
    async def create_order(self, req: CreateOrderRequest, *, request_id: str | None = None) -> CfOrder: ...
    async def get_order(self, order_id: str, *, request_id: str | None = None) -> CfOrder: ...
    async def get_order_payments(self, order_id: str, *, request_id: str | None = None) -> list[CfPayment]: ...
    async def create_refund(
        self, order_id: str, *, refund_id: str, amount_paise: int, note: str, request_id: str | None = None
    ) -> CfRefund: ...
    async def get_refund(self, order_id: str, refund_id: str, *, request_id: str | None = None) -> CfRefund: ...


def _seg(value: str) -> str:
    return quote(value, safe="")


def build_order_body(req: CreateOrderRequest) -> dict[str, Any]:
    """The exact ``POST /orders`` JSON (exposed for tests)."""
    body: dict[str, Any] = {
        "order_id": req.order_id,
        "order_amount": paise_to_rupees_wire(req.amount_paise),
        "order_currency": "INR",
        "customer_details": {
            "customer_id": req.customer_id[:50],
            "customer_phone": ten_digit_phone(req.customer_phone),
            "customer_name": req.customer_name[:100] or "TAKI customer",
        },
        "order_meta": {"return_url": req.return_url, "notify_url": req.notify_url},
        "order_expiry_time": req.expires_at_iso,
    }
    if req.tags:
        body["order_tags"] = dict(req.tags)
    return body


class HttpCashfreeClient:
    def __init__(
        self,
        *,
        app_id: str,
        secret_key: str,
        base_url: str,
        api_version: str,
        timeout_seconds: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "x-client-id": app_id,
            "x-client-secret": secret_key,
            "x-api-version": api_version,
        }
        self._timeout = httpx.Timeout(timeout_seconds)
        self._transport = transport

    # -- plumbing -------------------------------------------------------------------------------
    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        request_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        headers = dict(self._headers)
        if request_id:
            headers["x-request-id"] = request_id
        if idempotency_key:
            headers["x-idempotency-key"] = idempotency_key
        attempts = 1 + (GET_RETRIES if method == "GET" else 0)
        last: CashfreeError | None = None
        async with httpx.AsyncClient(
            base_url=self._base_url, timeout=self._timeout, transport=self._transport
        ) as client:
            for attempt in range(attempts):
                if attempt:
                    await asyncio.sleep(GET_RETRY_BACKOFF_SECONDS * attempt)
                try:
                    res = await client.request(method, path, json=json, headers=headers)
                except httpx.TimeoutException:
                    log.warning("cashfree %s %s timed out", method, _route(path))
                    last = CashfreeError(timeout=True)
                    continue
                except httpx.HTTPError as exc:
                    log.warning("cashfree %s %s transport error: %s", method, _route(path), type(exc).__name__)
                    last = CashfreeError()
                    continue
                if res.is_success:
                    return res.json() if res.content else {}
                code = _error_code(res)
                log.warning("cashfree %s %s failed: %s %s", method, _route(path), res.status_code, code)
                last = CashfreeError(http_status=res.status_code, cf_code=code)
                if res.status_code < 500:
                    break  # 4xx is final
        raise last or CashfreeError()

    # -- API ------------------------------------------------------------------------------------
    async def create_order(self, req: CreateOrderRequest, *, request_id: str | None = None) -> CfOrder:
        data = await self._request(
            "POST", "/orders", json=build_order_body(req), request_id=request_id, idempotency_key=req.order_id
        )
        return CfOrder.model_validate(data)

    async def get_order(self, order_id: str, *, request_id: str | None = None) -> CfOrder:
        return CfOrder.model_validate(await self._request("GET", f"/orders/{_seg(order_id)}", request_id=request_id))

    async def get_order_payments(self, order_id: str, *, request_id: str | None = None) -> list[CfPayment]:
        data = await self._request("GET", f"/orders/{_seg(order_id)}/payments", request_id=request_id)
        return [CfPayment.model_validate(p) for p in (data or [])]

    async def create_refund(
        self, order_id: str, *, refund_id: str, amount_paise: int, note: str, request_id: str | None = None
    ) -> CfRefund:
        body = {"refund_amount": paise_to_rupees_wire(amount_paise), "refund_id": refund_id, "refund_note": note[:100]}
        data = await self._request(
            "POST", f"/orders/{_seg(order_id)}/refunds", json=body, request_id=request_id, idempotency_key=refund_id
        )
        return CfRefund.model_validate(data)

    async def get_refund(self, order_id: str, refund_id: str, *, request_id: str | None = None) -> CfRefund:
        data = await self._request("GET", f"/orders/{_seg(order_id)}/refunds/{_seg(refund_id)}", request_id=request_id)
        return CfRefund.model_validate(data)


def _route(path: str) -> str:
    """``/orders/pay_x/payments`` → ``/orders/{id}/payments`` (ids stay out of logs)."""
    parts = path.split("/")
    return "/".join("{id}" if i in (2, 4) and p else p for i, p in enumerate(parts))


def _error_code(res: httpx.Response) -> str:
    try:
        body = res.json()
    except ValueError:
        return ""
    return str(body.get("code", "")) if isinstance(body, dict) else ""
