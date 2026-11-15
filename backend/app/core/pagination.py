"""Opaque cursors for ``{items, nextCursor}`` lists (P2 §14).

A cursor encodes the id of the last document of the previous page; the repository resolves it
to a snapshot and uses ``start_after``. Malformed cursors are a 400 ``invalid_request``.
"""

from __future__ import annotations

import base64
import json
from typing import Any

from app.core.errors import AppError


def encode_cursor(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def decode_cursor(cursor: str | None) -> dict[str, Any] | None:
    if not cursor:
        return None
    try:
        pad = "=" * (-len(cursor) % 4)
        data = json.loads(base64.urlsafe_b64decode(cursor + pad))
        if not isinstance(data, dict):
            raise ValueError
        return data
    except (ValueError, json.JSONDecodeError) as e:
        raise AppError("invalid_request", "Invalid cursor.", fields={"cursor": "Invalid cursor"}) from e
