"""Indian mobile numbers (port of ``apps/web/src/lib/domain/phone.ts``). Pure."""

from __future__ import annotations

import re

INDIAN_MOBILE = re.compile(r"^[6-9]\d{9}$")
PHONE_MESSAGE = "Enter a valid 10-digit mobile number"


def normalize_indian_mobile(value: str | None) -> str | None:
    """Strip spaces/dashes, ``+91`` / ``91`` (12 digits) / leading ``0`` (11 digits) → 10 digits."""
    digits = re.sub(r"[\s-]", "", value or "")
    if digits.startswith("+91"):
        digits = digits[3:]
    elif len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits if INDIAN_MOBILE.match(digits) else None


def to_e164(value: str | None) -> str | None:
    d = normalize_indian_mobile(value)
    return f"+91{d}" if d else None


def mask_phone(e164: str) -> str:
    """``+919876543210`` → ``+91 ••••• •3210``."""
    return f"+91 ••••• •{e164[-4:]}"


def format_phone_for_admin(e164: str) -> str:
    """``+91 98765 43210`` (admins see full numbers)."""
    d = re.sub(r"\D", "", e164)[-10:]
    return f"+91 {d[:5]} {d[5:]}" if len(d) == 10 else e164
