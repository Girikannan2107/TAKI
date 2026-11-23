"""Identity document numbers (port of ``document-numbers.ts`` + RC, P2 §12.2). Pure.

Numbers are validated, masked for display and HMAC'd (to flag reuse across accounts).
The full number is never stored or returned.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from dataclasses import dataclass

DOCUMENT_LABELS: dict[str, str] = {
    "aadhaar": "Aadhaar",
    "pan": "PAN card",
    "driving_license": "Driving licence",
    "rc": "Registration certificate",
}

DOCUMENT_KINDS_FOR: dict[str, tuple[str, ...]] = {
    "agency": ("aadhaar", "pan", "driving_license"),
    "driver": ("driving_license", "aadhaar"),
}

_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]


def verhoeff_valid(digits: str) -> bool:
    if not digits.isdigit():
        return False
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


@dataclass(frozen=True)
class NormalizedDocument:
    normalized: str
    masked: str


class DocumentNumberError(ValueError):
    """``str(e)`` is the user-facing problem."""


def _mask_last4(v: str) -> str:
    return "X" * max(0, len(v) - 4) + v[-4:]


def normalize_document_number(kind: str, raw: str) -> NormalizedDocument:
    v = re.sub(r"[\s-]", "", raw.strip().upper())
    if kind == "aadhaar":
        if not re.match(r"^[2-9]\d{11}$", v) or not verhoeff_valid(v):
            raise DocumentNumberError("Enter a valid 12-digit Aadhaar number.")
        return NormalizedDocument(v, f"XXXX XXXX {v[-4:]}")
    if kind == "pan":
        if not re.match(r"^[A-Z]{5}\d{4}[A-Z]$", v):
            raise DocumentNumberError("Enter a valid PAN, e.g. ABCDE1234F.")
        return NormalizedDocument(v, f"XXXXXX{v[-4:]}")
    if kind == "driving_license":
        v = re.sub(r"[^A-Z0-9]", "", v)
        if not re.match(r"^[A-Z0-9]{10,20}$", v):
            raise DocumentNumberError("Enter a valid driving licence number (10–20 letters and digits).")
        return NormalizedDocument(v, _mask_last4(v))
    if kind == "rc":
        v = re.sub(r"[^A-Z0-9]", "", v)
        if not re.match(r"^[A-Z0-9]{6,20}$", v):
            raise DocumentNumberError("Enter a valid registration certificate number.")
        return NormalizedDocument(v, _mask_last4(v))
    raise DocumentNumberError("Unknown document type.")


def document_hmac(key: bytes, kind: str, normalized: str) -> str:
    import base64

    digest = hmac.new(key, f"{kind}:{normalized}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
