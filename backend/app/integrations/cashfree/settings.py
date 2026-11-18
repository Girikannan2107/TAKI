"""Payment settings (P2 §4, §10.1). Owner: D5.

Built from ``app.core.config.Settings`` (same variable names) plus a few payment-only extras, so the
payments package can also be configured and tested on its own. Names are kept identical to the
backend env-var table in ``docs/v3/deploy.md``.

Rules:
- ``PAYMENT_PROVIDER=cashfree`` (default): the Cashfree client exists only when ``CASHFREE_APP_ID``,
  ``CASHFREE_SECRET_KEY`` and ``CASHFREE_ENV`` are all set; otherwise payment endpoints answer
  501 ``payments_not_configured`` (webhook: 501 ``webhook_not_configured``).
- ``PAYMENT_PROVIDER=dev`` (owner decision: local/e2e only) is accepted only when ``APP_ENV`` is
  ``local``, ``development`` or ``test``. :func:`check_payment_startup` refuses to boot otherwise.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_APP_ENVS: frozenset[str] = frozenset({"local", "development", "dev", "test"})

CASHFREE_BASE_URLS: dict[str, str] = {
    "sandbox": "https://sandbox.cashfree.com/pg",
    "production": "https://api.cashfree.com/pg",
}


class PaymentSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=True, env_ignore_empty=True)

    APP_ENV: str = "local"
    PAYMENT_PROVIDER: Literal["cashfree", "dev"] = "cashfree"

    CASHFREE_APP_ID: SecretStr | None = None
    CASHFREE_SECRET_KEY: SecretStr | None = None
    CASHFREE_ENV: Literal["sandbox", "production"] | None = None
    CASHFREE_API_VERSION: str = "2025-01-01"
    CASHFREE_WEBHOOK_TOLERANCE_SECONDS: int = 300
    CASHFREE_TIMEOUT_SECONDS: float = 10.0

    APP_ORIGIN: str = "http://localhost:3000"  # Cashfree return_url base (frontend origin)
    PUBLIC_API_BASE_URL: str = "http://localhost:8000"  # notify_url base (this API)

    # Dev gateway only: key for the per-payment approve/decline token. Falls back to FILE_URL_SECRET.
    DEV_PAYMENT_SECRET: SecretStr | None = None
    FILE_URL_SECRET: SecretStr | None = None

    @field_validator(
        "CASHFREE_APP_ID", "CASHFREE_SECRET_KEY", "DEV_PAYMENT_SECRET", "FILE_URL_SECRET", "CASHFREE_ENV", mode="before"
    )
    @classmethod
    def _blank_is_none(cls, v: object) -> object:
        raw = v.get_secret_value() if isinstance(v, SecretStr) else v
        return None if isinstance(raw, str) and not raw.strip() else v

    @property
    def is_dev_env(self) -> bool:
        return self.APP_ENV.lower() in DEV_APP_ENVS

    @property
    def cashfree_configured(self) -> bool:
        return bool(self.CASHFREE_APP_ID and self.CASHFREE_SECRET_KEY and self.CASHFREE_ENV)

    @property
    def dev_gateway_enabled(self) -> bool:
        return self.PAYMENT_PROVIDER == "dev" and self.is_dev_env

    @property
    def payments_configured(self) -> bool:
        return self.dev_gateway_enabled or (self.PAYMENT_PROVIDER == "cashfree" and self.cashfree_configured)

    @property
    def cashfree_base_url(self) -> str:
        return CASHFREE_BASE_URLS[self.CASHFREE_ENV or "sandbox"]

    def notify_url(self) -> str:
        return f"{self.PUBLIC_API_BASE_URL.rstrip('/')}/api/v1/payments/cashfree/webhook"

    def return_url(self, payment_id: str) -> str:
        return f"{self.APP_ORIGIN.rstrip('/')}/customer/payment/return?paymentId={payment_id}"


@lru_cache
def get_payment_settings() -> PaymentSettings:
    """Shared fields come from ``app.core.config.get_settings()`` (one source of truth, D2);
    payment-only extras (``CASHFREE_TIMEOUT_SECONDS``, ``DEV_PAYMENT_SECRET``) from the environment."""
    from app.core.config import get_settings

    core = get_settings()
    shared = {k: getattr(core, k) for k in PaymentSettings.model_fields if hasattr(core, k)}
    return PaymentSettings(**shared)


def check_payment_startup(settings: PaymentSettings | None = None) -> list[str]:
    """Boot guard (call from ``main.py`` lifespan). Raises ``RuntimeError`` on a forbidden setup.

    Returns warnings (strings) the caller should log.
    """
    s = settings or get_payment_settings()
    warnings: list[str] = []
    if s.PAYMENT_PROVIDER == "dev" and not s.is_dev_env:
        raise RuntimeError(
            f"PAYMENT_PROVIDER=dev is only allowed when APP_ENV is local/development/test (APP_ENV={s.APP_ENV!r})."
        )
    if s.APP_ENV == "production":
        if s.PAYMENT_PROVIDER != "cashfree":
            raise RuntimeError("APP_ENV=production requires PAYMENT_PROVIDER=cashfree.")
        if s.CASHFREE_ENV == "sandbox":
            # Sandbox "PAID" orders are not real money: confirming them would book real capacity (T3-4).
            raise RuntimeError("APP_ENV=production requires CASHFREE_ENV=production (sandbox is refused).")
        if not s.PUBLIC_API_BASE_URL.startswith("https://") or not s.APP_ORIGIN.startswith("https://"):
            raise RuntimeError(
                "APP_ORIGIN and PUBLIC_API_BASE_URL must be https in production (Cashfree return/notify)."
            )
    if s.PAYMENT_PROVIDER == "cashfree" and not s.cashfree_configured:
        warnings.append("Cashfree credentials are not set: payment endpoints answer 501 payments_not_configured.")
    if s.dev_gateway_enabled:
        warnings.append("PAYMENT_PROVIDER=dev: the TEST payment gateway is active (no money moves).")
    return warnings
