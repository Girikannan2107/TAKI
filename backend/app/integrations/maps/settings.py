"""Google Maps settings (P2 §4, §9.1). Owner: D5.

Same variable names as ``app.core.config.Settings``. The server key is used only inside FastAPI
(Geocoding API + Routes API); the browser key is a separate, referrer-restricted frontend variable.

Provider selection (``MAPS_PROVIDER``):
- ``auto`` (default): Google when ``GOOGLE_MAPS_SERVER_KEY`` is set; otherwise the deterministic
  :class:`~app.integrations.maps.fake.FakeMapsClient` in local/development/test, and
  ``maps_not_configured`` (503) everywhere else.
- ``google``: Google only (503 without a key).
- ``fake``: the fake gazetteer; refused outside local/development/test.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

DEV_APP_ENVS: frozenset[str] = frozenset({"local", "development", "dev", "test"})
DEFAULT_SERVICE_STATES: tuple[str, ...] = ("TN", "KL", "KA", "TG", "AP")


class MapsSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=True, env_ignore_empty=True)

    APP_ENV: str = "local"
    GOOGLE_MAPS_SERVER_KEY: SecretStr | None = None
    MAPS_PROVIDER: Literal["auto", "google", "fake"] = "auto"
    MAPS_REGION: str = "in"
    MAPS_LANGUAGE: str = "en-IN"
    MAPS_TIMEOUT_SECONDS: float = 8.0
    SERVICE_STATES: Annotated[list[str], NoDecode] = list(DEFAULT_SERVICE_STATES)

    @field_validator("SERVICE_STATES", mode="before")
    @classmethod
    def _split_states(cls, v: object) -> object:
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                return json.loads(v)
            return [s.strip().upper() for s in v.split(",") if s.strip()]
        return v

    @field_validator("GOOGLE_MAPS_SERVER_KEY", mode="before")
    @classmethod
    def _blank_is_none(cls, v: object) -> object:
        raw = v.get_secret_value() if isinstance(v, SecretStr) else v
        return None if isinstance(raw, str) and not raw.strip() else v

    @property
    def is_dev_env(self) -> bool:
        return self.APP_ENV.lower() in DEV_APP_ENVS

    @property
    def use_fake(self) -> bool:
        if not self.is_dev_env:
            return False
        if self.MAPS_PROVIDER == "fake":
            return True
        return self.MAPS_PROVIDER == "auto" and self.GOOGLE_MAPS_SERVER_KEY is None

    @property
    def google_configured(self) -> bool:
        return self.GOOGLE_MAPS_SERVER_KEY is not None and self.MAPS_PROVIDER != "fake"


@lru_cache
def get_maps_settings() -> MapsSettings:
    """Shared fields from ``app.core.config.get_settings()`` (D2); maps-only extras from the environment."""
    from app.core.config import get_settings

    core = get_settings()
    shared = {k: getattr(core, k) for k in MapsSettings.model_fields if hasattr(core, k)}
    return MapsSettings(**shared)


def check_maps_startup(settings: MapsSettings | None = None) -> list[str]:
    """Boot guard: ``MAPS_PROVIDER=fake`` outside local/development/test refuses to start."""
    s = settings or get_maps_settings()
    if s.MAPS_PROVIDER == "fake" and not s.is_dev_env:
        raise RuntimeError(f"MAPS_PROVIDER=fake is only allowed in local/development/test (APP_ENV={s.APP_ENV!r}).")
    warnings: list[str] = []
    if s.use_fake:
        warnings.append("Google Maps server key not set: using the FAKE maps gazetteer (development/test only).")
    elif not s.google_configured:
        warnings.append("GOOGLE_MAPS_SERVER_KEY is not set: maps endpoints answer 503 maps_not_configured.")
    return warnings
