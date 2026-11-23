"""Document ids (P2 §6.1): ``<prefix>_<20 [a-z0-9]>`` and ``TAKI`` + 8 digits for bookings."""

from __future__ import annotations

import base64
import re
import secrets

ID_PREFIXES = frozenset(
    {"agc", "veh", "trp", "tev", "shp", "bev", "pay", "rf", "inv", "fil", "ntf", "stl", "job", "msg", "aud"}
)


def new_id(prefix: str) -> str:
    if prefix not in ID_PREFIXES:
        raise ValueError(f"unknown id prefix {prefix!r}")
    raw = base64.b32encode(secrets.token_bytes(15)).decode().lower()  # 24 chars of [a-z2-7]
    return f"{prefix}_{raw[:20]}"


def new_booking_id() -> str:
    return "TAKI" + "".join(secrets.choice("0123456789") for _ in range(8))


def id_pattern(prefix: str) -> str:
    return rf"^{prefix}_[a-z0-9]{{20}}$"


UID_RE = re.compile(r"^[A-Za-z0-9]{1,128}$")
BOOKING_ID_RE = re.compile(r"^TAKI\d{8}$")


def is_id(value: str, prefix: str) -> bool:
    return re.match(id_pattern(prefix), value) is not None


def is_uid(value: str) -> bool:
    return UID_RE.match(value) is not None
