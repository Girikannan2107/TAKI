"""Settings (P2 §4) loaded from the environment / ``.env`` with pydantic-settings.

Secrets are ``SecretStr`` and are never logged. ``check_boot_guards`` runs in ``create_app()``
so a misconfigured deployment fails fast at startup (before serving any request).
"""

from __future__ import annotations

import hashlib
import json
import logging
from functools import lru_cache
from typing import Annotated, Any, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

log = logging.getLogger("taki.config")

AppEnv = Literal["development", "test", "staging", "production"]
DEV_ENVS: frozenset[str] = frozenset({"development", "test"})


class ConfigError(RuntimeError):
    """Raised at startup when the configuration is unsafe or incomplete."""


def _split_list(v: Any) -> Any:
    """Accept a JSON list or a comma-separated string."""
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return []
        if s.startswith("["):
            return json.loads(s)
        return [p.strip() for p in s.split(",") if p.strip()]
    return v


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=True, env_ignore_empty=True)

    APP_ENV: AppEnv = "development"
    LOG_LEVEL: str = "INFO"
    LOG_JSON: bool = True

    # Firebase / GCP
    FIREBASE_PROJECT_ID: str = "demo-taki"
    FIREBASE_STORAGE_BUCKET: str | None = None  # default "<project>.appspot.com"
    FIREBASE_WEB_API_KEY: SecretStr | None = None  # tests/scripts that exchange custom tokens
    FIRESTORE_EMULATOR_HOST: str | None = None
    FIREBASE_AUTH_EMULATOR_HOST: str | None = None
    FIREBASE_STORAGE_EMULATOR_HOST: str | None = None
    GOOGLE_APPLICATION_CREDENTIALS: str | None = None

    # HTTP
    APP_ORIGIN: str = "http://localhost:3000"
    PUBLIC_API_BASE_URL: str = "http://localhost:8000"
    CORS_ALLOWED_ORIGINS: Annotated[list[str], NoDecode] = Field(default_factory=list)
    TRUST_PROXY_HEADERS: bool = False
    # Proxies in front of the app that append to X-Forwarded-For (Cloud Run: 1 = the Google front end).
    TRUSTED_PROXY_HOPS: int = Field(default=1, ge=1, le=5)

    # Secrets
    FILE_URL_SECRET: SecretStr | None = None
    PII_HASH_KEY: SecretStr | None = None
    OTP_ENC_KEY: SecretStr | None = None
    PASSWORD_PEPPER: SecretStr | None = None

    # Google Maps (server key — never sent to browsers)
    GOOGLE_MAPS_SERVER_KEY: SecretStr | None = None
    GOOGLE_MAPS_BROWSER_KEY: str | None = None  # informational only (frontend uses its own env)
    MAPS_PROVIDER: Literal["auto", "google", "fake"] = "auto"  # read by D5's integrations/maps
    MAPS_TIMEOUT_SECONDS: float = 8
    MAPS_REGION: str = "in"
    MAPS_LANGUAGE: str = "en-IN"
    SERVICE_STATES: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["TN", "KL", "KA", "TG", "AP"])

    # Payments
    PAYMENT_PROVIDER: Literal["cashfree", "dev"] = "cashfree"
    CASHFREE_APP_ID: SecretStr | None = None
    CASHFREE_SECRET_KEY: SecretStr | None = None
    CASHFREE_ENV: Literal["sandbox", "production"] | None = None
    CASHFREE_API_VERSION: str = "2025-01-01"
    CASHFREE_WEBHOOK_TOLERANCE_SECONDS: int = 300
    CASHFREE_TIMEOUT_SECONDS: float = 10  # read by D5's integrations/cashfree
    DEV_PAYMENT_SECRET: SecretStr | None = None  # dev/test gateway only

    # Scheduler
    SWEEP_OIDC_AUDIENCE: str | None = None
    SWEEP_INVOKER_EMAILS: Annotated[list[str], NoDecode] = Field(default_factory=list)
    CRON_SECRET: SecretStr | None = None

    # Feature flags
    REQUIRE_DELIVERY_PROOF: bool = False
    REQUIRE_DRIVER_VERIFICATION: bool = True
    REQUIRE_VEHICLE_RC: bool = True
    REQUIRE_VEHICLE_RC_VERIFIED: bool = False
    DEV_AUTO_VERIFY: bool = False
    RATE_LIMITS_ENABLED: bool = True

    @field_validator("APP_ENV", mode="before")
    @classmethod
    def _env_alias(cls, v: Any) -> Any:
        # P2 §4 used "local"; the owner decision names it "development".
        return "development" if v == "local" else v

    @field_validator("CORS_ALLOWED_ORIGINS", "SERVICE_STATES", "SWEEP_INVOKER_EMAILS", mode="before")
    @classmethod
    def _lists(cls, v: Any) -> Any:
        return _split_list(v)

    @model_validator(mode="after")
    def _defaults(self) -> Settings:
        if not self.FIREBASE_STORAGE_BUCKET:
            self.FIREBASE_STORAGE_BUCKET = f"{self.FIREBASE_PROJECT_ID}.appspot.com"
        if not self.CORS_ALLOWED_ORIGINS:
            self.CORS_ALLOWED_ORIGINS = [self.APP_ORIGIN.rstrip("/")]
        self.PUBLIC_API_BASE_URL = self.PUBLIC_API_BASE_URL.rstrip("/")
        return self

    # ── derived ────────────────────────────────────────────────────────────
    @property
    def is_dev(self) -> bool:
        return self.APP_ENV in DEV_ENVS

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def uses_emulators(self) -> bool:
        return bool(
            self.FIRESTORE_EMULATOR_HOST or self.FIREBASE_AUTH_EMULATOR_HOST or self.FIREBASE_STORAGE_EMULATOR_HOST
        )

    @property
    def dev_payment_gateway_enabled(self) -> bool:
        return self.PAYMENT_PROVIDER == "dev" and self.is_dev

    @property
    def payments_configured(self) -> bool:
        """Delegates to D5's gateway registry when present."""
        try:
            from app.integrations.cashfree import get_gateways
        except ImportError:
            get_gateways = None  # type: ignore[assignment]
        if get_gateways is not None:
            try:
                return bool(get_gateways().configured)
            except Exception:  # misconfiguration is reported by the startup checks
                return False
        if self.dev_payment_gateway_enabled:
            return True
        return bool(self.CASHFREE_APP_ID and self.CASHFREE_SECRET_KEY and self.CASHFREE_ENV)

    @property
    def maps_configured(self) -> bool:
        """Delegates to D5's maps integration (the fake gazetteer counts in development/test)."""
        try:
            from app.integrations.maps import maps_configured
        except ImportError:
            return self.GOOGLE_MAPS_SERVER_KEY is not None
        return bool(maps_configured())

    def _secret(self, name: str) -> bytes:
        value: SecretStr | None = getattr(self, name)
        if value is not None and value.get_secret_value():
            return value.get_secret_value().encode()
        # Deterministic dev value (only reachable in development/test: guarded at boot).
        return hashlib.sha256(f"taki-dev-{name}-{self.FIREBASE_PROJECT_ID}".encode()).digest()

    @property
    def file_url_secret(self) -> bytes:
        return self._secret("FILE_URL_SECRET")

    @property
    def pii_hash_key(self) -> bytes:
        return self._secret("PII_HASH_KEY")

    @property
    def password_pepper(self) -> bytes | None:
        p = self.PASSWORD_PEPPER
        return p.get_secret_value().encode() if p and p.get_secret_value() else None


REQUIRED_SECRETS = ("FILE_URL_SECRET", "PII_HASH_KEY", "OTP_ENC_KEY")


def check_boot_guards(s: Settings) -> None:
    """Fail fast on unsafe configuration (P2 §4 boot guards + owner decision on the dev gateway)."""
    # Owner decision: the dev payment gateway exists only for local development and tests.
    if s.PAYMENT_PROVIDER == "dev" and s.APP_ENV not in DEV_ENVS:
        raise ConfigError(
            f"PAYMENT_PROVIDER=dev is allowed only when APP_ENV is development or test "
            f"(APP_ENV={s.APP_ENV}). Use PAYMENT_PROVIDER=cashfree."
        )
    if s.is_production and s.uses_emulators:
        raise ConfigError("APP_ENV=production must not set any *_EMULATOR_HOST variable.")
    if s.uses_emulators and not s.FIREBASE_PROJECT_ID.startswith("demo-"):
        raise ConfigError("FIREBASE_PROJECT_ID must start with 'demo-' when an emulator host is set.")
    if s.DEV_AUTO_VERIFY and not s.is_dev:
        raise ConfigError("DEV_AUTO_VERIFY=true is allowed only in development or test.")
    if not s.is_dev:
        missing = [n for n in REQUIRED_SECRETS if getattr(s, n) is None or len(getattr(s, n).get_secret_value()) < 32]
        if missing:
            raise ConfigError(
                f"Missing or too-short secrets (>= 32 chars) for APP_ENV={s.APP_ENV}: " + ", ".join(missing)
            )
        if s.FIREBASE_PROJECT_ID.startswith("demo-"):
            raise ConfigError(f"APP_ENV={s.APP_ENV} needs a real FIREBASE_PROJECT_ID.")
    else:
        missing = [n for n in REQUIRED_SECRETS if getattr(s, n) is None]
        if missing:
            log.warning(
                "Using deterministic development values for %s (never do this in production).",
                ", ".join(missing),
            )
        if not s.uses_emulators and not s.GOOGLE_APPLICATION_CREDENTIALS:
            log.warning(
                "No emulator host and no GOOGLE_APPLICATION_CREDENTIALS set; "
                "start the emulators (scripts/dev) or provide credentials."
            )


def run_integration_startup_checks() -> None:
    """D5's payment and maps startup checks (they read the cached global settings).

    They raise ``RuntimeError`` on unsafe combinations and return warnings to log."""
    checks = []
    try:
        from app.integrations.cashfree.settings import check_payment_startup

        checks.append(check_payment_startup)
    except ImportError:
        pass
    try:
        from app.integrations.maps.settings import check_maps_startup

        checks.append(check_maps_startup)
    except ImportError:
        pass
    for check in checks:
        try:
            warnings = check()
        except RuntimeError as e:
            raise ConfigError(str(e)) from e
        for w in warnings:
            log.warning(w)


@lru_cache
def get_settings() -> Settings:
    return Settings()
