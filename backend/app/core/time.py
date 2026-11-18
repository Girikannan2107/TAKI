"""IST calendar helpers and ISO-8601 ``Z`` formatting (P2 §6.1, §14)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30), "IST")


def to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        raise ValueError("naive datetime")
    return dt.astimezone(UTC)


def iso_z(dt: datetime | None) -> str | None:
    """``2026-11-20T04:30:00.000Z`` (millisecond precision, like JS ``toISOString``)."""
    if dt is None:
        return None
    return to_utc(dt).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def ist_date_of(dt: datetime) -> date:
    return to_utc(dt).astimezone(IST).date()


def ist_today(now: datetime) -> date:
    return ist_date_of(now)


def ist_end_of_day_utc(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, 23, 59, 59, 999000, tzinfo=IST).astimezone(UTC)


def years_before(d: date, years: int) -> date:
    """Same calendar day ``years`` earlier; Feb 29 maps to Feb 28."""
    try:
        return d.replace(year=d.year - years)
    except ValueError:
        return d.replace(year=d.year - years, day=28)
