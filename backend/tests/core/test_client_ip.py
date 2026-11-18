"""T3-1: the per-IP rate-limit key comes from the proxy-appended X-Forwarded-For entry."""

from __future__ import annotations

import pytest
from starlette.requests import Request

from app.middleware import rate_limit as rl
from tests.support.app import make_settings


def _request(xff: list[str], peer: str = "169.254.1.1") -> Request:
    headers = [(b"x-forwarded-for", v.encode()) for v in xff]
    return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


@pytest.mark.parametrize(
    ("trust", "hops", "xff", "expected"),
    [
        (False, 1, ["198.51.100.1, 203.0.113.9"], "169.254.1.1"),  # proxy headers ignored
        (True, 1, ["203.0.113.9"], "203.0.113.9"),
        (True, 1, ["198.51.100.1, 198.51.100.2, 203.0.113.9"], "203.0.113.9"),  # spoofed prefix ignored
        (True, 1, ["198.51.100.1", "203.0.113.9"], "203.0.113.9"),  # repeated headers
        (True, 2, ["198.51.100.1, 203.0.113.9, 35.191.0.1"], "203.0.113.9"),  # two trusted proxies
        (True, 2, ["203.0.113.9"], "169.254.1.1"),  # fewer entries than trusted hops → peer
        (True, 1, [], "169.254.1.1"),
    ],
)
def test_client_ip_uses_right_most_trusted_hop(
    monkeypatch: pytest.MonkeyPatch, trust: bool, hops: int, xff: list[str], expected: str
) -> None:
    s = make_settings(TRUST_PROXY_HEADERS=trust, TRUSTED_PROXY_HOPS=hops)
    monkeypatch.setattr(rl, "get_settings", lambda: s)
    assert rl.client_ip(_request(xff)) == expected
