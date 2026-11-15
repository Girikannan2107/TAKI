"""Structured logging (Cloud Logging JSON) with request-id correlation and a PII scrubber."""

from __future__ import annotations

import json
import logging
import re
import sys
from contextvars import ContextVar
from typing import Any

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

SENSITIVE_KEYS = {
    "authorization",
    "password",
    "confirmpassword",
    "currentpassword",
    "otp",
    "x-client-secret",
    "x-phone-proof",
    "aadhaar",
    "number",
    "token",
    "customtoken",
    "idtoken",
}
_PHONE_RE = re.compile(r"\+91(\d{6})(\d{4})")


def mask_phones(text: str) -> str:
    return _PHONE_RE.sub(lambda m: f"+91******{m.group(2)}", text)


def scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: ("[redacted]" if str(k).lower() in SENSITIVE_KEYS else scrub(v)) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [scrub(v) for v in value]
    if isinstance(value, str):
        return mask_phones(value)
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "severity": record.levelname,
            "message": mask_phones(record.getMessage()),
            "logger": record.name,
        }
        rid = request_id_var.get()
        if rid:
            entry["requestId"] = rid
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            entry.update(scrub(extra))
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


class PlainFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            base += " " + json.dumps(scrub(extra), default=str)
        return mask_phones(base)


def configure_logging(level: str = "INFO", json_logs: bool = True) -> None:
    root = logging.getLogger("taki")
    root.setLevel(level.upper())
    if getattr(root, "_taki_configured", False):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if json_logs else PlainFormatter("%(levelname)s %(name)s %(message)s"))
    root.addHandler(handler)
    root.propagate = False
    root._taki_configured = True  # type: ignore[attr-defined]
