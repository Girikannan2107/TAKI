"""Injectable clock. Business time comes from ``get_clock()`` (overridden in tests)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class FrozenClock:
    """Test clock: fixed until moved with ``advance`` / ``set``."""

    def __init__(self, at: datetime | None = None) -> None:
        self._at = at or datetime.now(UTC)

    def now(self) -> datetime:
        return self._at

    def advance(self, **kw: float) -> None:
        self._at = self._at + timedelta(**kw)

    def set(self, at: datetime) -> None:
        self._at = at


_system = SystemClock()


def get_clock() -> Clock:
    return _system


def utcnow() -> datetime:
    """Real wall-clock time. Use for security timestamps compared with Firebase token times."""
    return datetime.now(UTC)
