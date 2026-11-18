"""Typed Cashfree errors (D5). They subclass ``AppError`` so the global handler renders the envelope."""

from __future__ import annotations

from typing import Any

from app.core.errors import AppError


class PaymentsNotConfigured(AppError):
    def __init__(self) -> None:
        super().__init__("payments_not_configured")


class WebhookNotConfigured(AppError):
    def __init__(self) -> None:
        super().__init__("webhook_not_configured")


class InvalidWebhookSignature(AppError):
    def __init__(self) -> None:
        super().__init__("invalid_signature")


class StaleWebhookTimestamp(AppError):
    def __init__(self) -> None:
        super().__init__("stale_timestamp")


class CashfreeError(AppError):
    """Cashfree answered with an error or could not be reached (502 ``gateway_error``).

    ``http_status`` / ``cf_code`` are kept for logs and branching; they never reach the client.
    """

    def __init__(
        self,
        *,
        http_status: int | None = None,
        cf_code: str | None = None,
        timeout: bool = False,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__("gateway_error", details=details)
        self.http_status = http_status
        self.cf_code = cf_code
        self.timeout = timeout

    @property
    def is_conflict(self) -> bool:
        return self.http_status == 409

    @property
    def is_not_found(self) -> bool:
        return self.http_status == 404
