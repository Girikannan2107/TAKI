"""Agency profile, verification, dashboard, history + shared agency guards (contract §10). Owner: D3.

Account data (profile edit, photo, identity documents) is D2's ``profile_service``; this module adds
agency guard rails, live counts, the verification status/submit endpoints (E50/E51), the dashboard
(E47), history search (E84) and the denormalised name fan-out (P2 §6.5).
"""

from __future__ import annotations

import logging
import re
from collections.abc import Sequence
from datetime import date, datetime, timedelta
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.core.config import get_settings
from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.time import IST, ist_date_of
from app.repositories import agencies as agencies_repo
from app.repositories import drivers as drivers_repo
from app.repositories import trips as trips_repo
from app.repositories import vehicles as vehicles_repo
from app.repositories.base import (
    C,
    col,
    commit_in_batches,
    count,
    doc_ref,
    page_list,
    page_query,
    query_docs,
    run_transaction,
)
from app.schemas.agency import (
    AgencyDashboardDTO,
    AgencyProfileResponse,
    AgencyVerificationStatusDTO,
    DashboardAgencyDTO,
    DashboardTotals,
    DashboardTrips,
    HistoryLink,
    HistoryPage,
    HistoryRow,
    ProfileCounts,
    VerificationRequirement,
)
from app.schemas.profile import AgencyProfileDTO, AgencyProfilePatch
from app.views import agency as views
from app.views.common import agency_documents_complete

log = logging.getLogger("taki.agency")


# ── Shared guards ─────────────────────────────────────────────────────────────
def agency_id_of(user: CurrentUser) -> str:
    if user.role != "agency" or not user.agency_id:
        raise AppError("forbidden")
    return user.agency_id


def actor_of(user: CurrentUser) -> dict[str, Any]:
    return {"role": user.role, "userId": user.uid}


async def load_agency(agency_id: str) -> dict[str, Any]:
    a = await agencies_repo.get(agency_id)
    if not a:
        raise AppError("not_found")
    return a


def verification_of(doc: dict[str, Any] | None, field: str = "verification") -> str:
    return str(((doc or {}).get(field) or {}).get("status", "not_submitted"))


def assert_not_suspended(agency: dict[str, Any]) -> None:
    """403 ``agency_suspended`` on every mutating endpoint except profile and verification."""
    if verification_of(agency) == "suspended":
        raise AppError("agency_suspended")


def assert_verified(agency: dict[str, Any], message: str | None = None) -> None:
    assert_not_suspended(agency)
    if verification_of(agency) != "verified":
        raise AppError("agency_not_verified", message)


async def mutable_agency(user: CurrentUser) -> dict[str, Any]:
    """The caller's agency, refusing suspended agencies."""
    agency = await load_agency(agency_id_of(user))
    assert_not_suspended(agency)
    return agency


def bump(doc: dict[str, Any], now: datetime) -> dict[str, Any]:
    return {"updatedAt": now, "version": int(doc.get("version", 1)) + 1}


# ── Profile (E48/E49) ─────────────────────────────────────────────────────────
async def counts(agency_id: str) -> ProfileCounts:
    return ProfileCounts(
        vehicles=await vehicles_repo.count_for_agency(agency_id, ["active", "inactive"]),
        drivers=await drivers_repo.count_for_agency(agency_id, "active"),
        pending_drivers=await drivers_repo.count_for_agency(agency_id, "pending"),
    )


async def get_profile(user: CurrentUser) -> AgencyProfileResponse:
    from app.services import profile_service

    agency_id = agency_id_of(user)
    profile = await profile_service.get_profile(user)
    if not isinstance(profile, AgencyProfileDTO):
        raise AppError("forbidden")
    return AgencyProfileResponse(**profile.model_dump(), counts=await counts(agency_id))


async def patch_profile(
    user: CurrentUser, body: AgencyProfilePatch, place: dict[str, Any], now: datetime
) -> AgencyProfileResponse:
    from app.services import profile_service

    agency_id_of(user)
    await profile_service.patch_profile(user, body, now, place)  # fans out names (after_profile_patch)
    return await get_profile(user)


# ── Verification (E50/E51) ────────────────────────────────────────────────────
def _requirements(agency: dict[str, Any]) -> list[VerificationRequirement]:
    return [
        VerificationRequirement(key="photo", done=bool(agency.get("photo"))),
        VerificationRequirement(key="identity_document", done=bool(agency.get("identityDocument"))),
    ]


def _status_dto(agency: dict[str, Any]) -> AgencyVerificationStatusDTO:
    v = agency.get("verification") or {}
    return AgencyVerificationStatusDTO(
        status=v.get("status", "not_submitted"),
        reason=v.get("reason"),
        submitted_at=v.get("submittedAt"),
        reviewed_at=v.get("reviewedAt"),
        requirements=_requirements(agency),
    )


async def verification_status(user: CurrentUser) -> AgencyVerificationStatusDTO:
    return _status_dto(await load_agency(agency_id_of(user)))


async def submit_verification(user: CurrentUser, now: datetime) -> AgencyProfileResponse:
    """``not_submitted`` / ``rejected`` → ``pending`` once photo + identity document are present."""
    agency_id = agency_id_of(user)
    auto = get_settings().DEV_AUTO_VERIFY

    async def _tx(tx: AsyncTransaction) -> None:
        a = await agencies_repo.tx_get_agency(tx, agency_id)
        if not a:
            raise AppError("not_found")
        v = a.get("verification") or {}
        status = v.get("status", "not_submitted")
        if status == "verified":
            raise AppError("already_verified", "Your agency is already verified.")
        if status == "suspended":
            raise AppError("agency_suspended")
        missing = [r.key for r in _requirements(a) if not r.done]
        if missing:
            raise AppError(
                "invalid_transition",
                "Upload your profile photo and one identity document first.",
                details={"missing": missing},
            )
        if status == "pending" and v.get("submittedAt"):
            return  # idempotent
        nv = {
            **v,
            "status": "verified" if auto else "pending",
            "submittedAt": now,
            "reviewedAt": now if auto else None,
            "reviewedBy": "dev-auto" if auto else None,
            "reason": None,
        }
        agencies_repo.tx_update(tx, agency_id, {"verification": nv, **bump(a, now)})

    await run_transaction(_tx)
    return await get_profile(user)


def documents_complete(agency: dict[str, Any]) -> bool:
    return agency_documents_complete(agency)


# ── Name fan-out (P2 §6.5) ────────────────────────────────────────────────────
async def _booking_display_refresh(field: str, key: str, value: str, name: str) -> None:
    """Delegates to D4 when it offers a refresher; booking documents belong to D4."""
    try:
        from app.services import booking_service  # type: ignore[attr-defined]
    except ImportError:
        return
    fn = getattr(booking_service, "refresh_display_name", None)
    if fn is not None:
        try:
            await fn(field=field, key=key, value=value, name=name)
        except Exception:  # noqa: BLE001 - denormalised data; never fail the profile edit
            log.warning("booking display refresh failed", extra={"fields": {"field": field}})


async def fan_out_agency_name(agency_id: str, name: str, now: datetime) -> int:
    """``agencyName`` on open trips, pending invites and drivers' agency links (batches of 400)."""
    writes: list[tuple[str, str, dict[str, Any]]] = []
    for t in await trips_repo.open_for_agency(agency_id):
        if t.get("agencyName") != name:
            writes.append((C.trips, t["id"], {"agencyName": name, "updatedAt": now}))
    for i in await query_docs(
        col(C.driver_invites)
        .where(filter=FieldFilter("agencyId", "==", agency_id))
        .where(filter=FieldFilter("status", "==", "pending"))
    ):
        if i.get("agencyName") != name:
            writes.append((C.driver_invites, i["id"], {"agencyName": name, "updatedAt": now}))
    for d in await drivers_repo.all_for_agency(agency_id):
        if (d.get("agencyLink") or {}).get("agencyName") != name:
            writes.append((C.drivers, d["id"], {"agencyLink.agencyName": name, "updatedAt": now}))
    n = await commit_in_batches(writes)
    await _booking_display_refresh("agencyName", "agencyId", agency_id, name)
    return n


async def fan_out_driver_name(driver_id: str, name: str, now: datetime) -> int:
    """``trip.driver.fullName`` on draft/published trips (+ bookings' ``display.driverName`` via D4)."""
    writes = [
        (C.trips, t["id"], {"driver.fullName": name, "updatedAt": now})
        for t in await trips_repo.open_for_driver(driver_id)
        if (t.get("driver") or {}).get("fullName") != name
    ]
    n = await commit_in_batches(writes)
    await _booking_display_refresh("driverName", "driverId", driver_id, name)
    return n


async def after_profile_patch(viewer: CurrentUser, now: datetime) -> None:
    """Called by ``profile_service.patch_profile`` after its commit (agency and driver renames)."""
    try:
        if viewer.role == "agency" and viewer.agency_id:
            a = await agencies_repo.get(viewer.agency_id)
            if a:
                await fan_out_agency_name(a["id"], a.get("agencyName", ""), now)
        elif viewer.role == "driver":
            d = await drivers_repo.get(viewer.uid)
            if d:
                await fan_out_driver_name(d["id"], d.get("fullName", ""), now)
    except AppError:
        log.warning("name fan-out failed", extra={"fields": {"uid": viewer.uid}})


# ── Dashboard (E47) ───────────────────────────────────────────────────────────
def month_key(dt: datetime) -> str:
    return ist_date_of(dt).isoformat()[:7]


def shift_month(month: str, delta: int) -> str:
    y, m = (int(x) for x in month.split("-"))
    idx = y * 12 + (m - 1) + delta
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def revenue_of(earnings: Sequence[dict[str, Any]], now: datetime) -> dict[str, Any]:
    """Σ agencyNet of real earnings (delivered bookings) by IST month, last 6 months."""
    this = month_key(now)
    months = [shift_month(this, i - 5) for i in range(6)]
    by = dict.fromkeys(months, 0)
    total = 0
    for e in earnings:
        net = int(e.get("agencyNet", 0))
        total += net
        k = month_key(e["deliveredAt"])
        if k in by:
            by[k] += net
    this_m, last_m = by[this], by.get(shift_month(this, -1), 0)
    return {
        "this_month": this_m,
        "last_month": last_m,
        "total": total,
        "change_pct": round((this_m - last_m) * 100 / last_m) if last_m > 0 else None,
        "monthly_series": [{"month": m, "amount": by[m]} for m in months],
    }


async def _bookings_count(agency_id: str, field: str, value: str) -> int:
    q = (
        col(C.bookings)
        .where(filter=FieldFilter("agencyId", "==", agency_id))
        .where(filter=FieldFilter(field, "==", value))
    )
    return await count(q)


async def dashboard(user: CurrentUser, now: datetime) -> AgencyDashboardDTO:
    from app.repositories import earnings as earnings_repo
    from app.services import notification_service

    agency_id = agency_id_of(user)
    agency = await load_agency(agency_id)
    v = agency.get("verification") or {}
    upcoming, _ = await trips_repo.page_for_agency(agency_id, ["published"], True, 3, None)
    return AgencyDashboardDTO(
        agency=DashboardAgencyDTO(
            id=agency_id,
            name=agency.get("agencyName", ""),
            owner_name=agency.get("ownerName", ""),
            verification=v.get("status", "not_submitted"),
            verification_reason=v.get("reason"),
        ),
        totals=DashboardTotals(
            vehicles=await vehicles_repo.count_for_agency(agency_id, ["active", "inactive"]),
            drivers=await drivers_repo.count_for_agency(agency_id, "active"),
            pending_drivers=await drivers_repo.count_for_agency(agency_id, "pending"),
        ),
        trips=DashboardTrips(
            active=await trips_repo.count_for_agency(agency_id, ["in_progress"]),
            upcoming=await trips_repo.count_for_agency(agency_id, ["published"]),
        ),
        pending_bookings=await _bookings_count(agency_id, "agencyTab", "pending"),
        completed_shipments=await _bookings_count(agency_id, "status", "delivered"),
        revenue=revenue_of(await earnings_repo.for_agency(agency_id), now),  # type: ignore[arg-type]
        upcoming_trips=[views.trip_list_item(t, now, user.uid) for t in upcoming],
        recent_activity=await notification_service.recent(user.uid, 8),
    )


# ── History (E84) ─────────────────────────────────────────────────────────────
def tokens_of(q: str | None, min_length: int = 2) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", (q or "").lower()) if len(t) >= min_length][:6]


def text_matches(haystack: str, tokens: Sequence[str]) -> bool:
    """Tokens of 2+ chars match anywhere; a single character must start a word."""
    h = haystack.lower()
    words = re.split(r"[^a-z0-9]+", h)
    return all((t in h) if len(t) > 1 else any(w.startswith(t) for w in words) for t in tokens)


def _token_match(search_tokens: Sequence[str], tokens: Sequence[str]) -> bool:
    return all(any(s == t or s.startswith(t) for s in search_tokens) for t in tokens)


def _range(frm: str | None, to: str | None) -> tuple[datetime | None, datetime | None]:
    def start(d: str) -> datetime:
        x = date.fromisoformat(d)
        return datetime(x.year, x.month, x.day, tzinfo=IST)

    return (start(frm) if frm else None, start(to) + timedelta(days=1) if to else None)


def _in(dt: datetime | None, lo: datetime | None, hi: datetime | None) -> bool:
    if dt is None:
        return lo is None and hi is None
    return (lo is None or dt >= lo) and (hi is None or dt < hi)


def _booking_row(b: dict[str, Any]) -> HistoryRow:
    d = b.get("display") or {}
    pick = (b.get("pickup") or {}).get("placeName", "")
    drop = (b.get("drop") or {}).get("placeName", "")
    return HistoryRow(
        type="bookings",
        id=b["id"],
        title=f"{b['id']} · {d.get('customerName', '')}",
        subtitle=f"{pick} → {drop} · {b.get('weightKg', 0)} kg · {d.get('vehicleReg', '')}",
        date=b["createdAt"],
        status=b.get("status"),
        link=HistoryLink(type="booking", id=b["id"]),
    )


async def history(
    user: CurrentUser,
    *,
    type_: str,
    q: str | None,
    frm: str | None,
    to: str | None,
    limit: int,
    cursor: str | None,
) -> HistoryPage:
    agency_id = agency_id_of(user)
    tokens, mem = tokens_of(q), tokens_of(q, 1)
    lo, hi = _range(frm, to)

    if type_ == "bookings":
        query: Any = col(C.bookings).where(filter=FieldFilter("agencyId", "==", agency_id))
        if tokens:
            query = query.where(filter=FieldFilter("searchTokens", "array_contains", tokens[0]))
        if lo is not None:
            query = query.where(filter=FieldFilter("createdAt", ">=", lo))
        if hi is not None:
            query = query.where(filter=FieldFilter("createdAt", "<", hi))
        query = query.order_by("createdAt", direction="DESCENDING").order_by("__name__", direction="DESCENDING")
        if len(tokens) <= 1:
            rows, nxt = await page_query(C.bookings, query, limit, cursor)
            return HistoryPage(items=[_booking_row(b) for b in rows], next_cursor=nxt)
        scanned = await query_docs(query.limit(500))
        matched = [b for b in scanned if _token_match(b.get("searchTokens") or [], tokens[1:])]
        items, nxt = page_list(matched, limit, cursor)
        return HistoryPage(items=[_booking_row(b) for b in items], next_cursor=nxt)

    rows: list[HistoryRow] = []
    if type_ == "trips":
        for t in await trips_repo.list_for_agency(agency_id):
            if not _in(t.get("departureAt"), lo, hi):
                continue
            cps = t.get("checkpoints") or []
            text = " ".join(
                [
                    t["id"],
                    *(f"{views.place_name(c)} {(c.get('place') or {}).get('district') or ''}" for c in cps),
                    (t.get("vehicle") or {}).get("registrationNumber", ""),
                    (t.get("driver") or {}).get("fullName", ""),
                ]
            )
            if mem and not text_matches(text, mem):
                continue
            rows.append(
                HistoryRow(
                    type="trips",
                    id=t["id"],
                    title=views.route_label(cps),
                    subtitle=f"{(t.get('vehicle') or {}).get('registrationNumber', '')} · "
                    f"{(t.get('driver') or {}).get('fullName', '')} · {views.trip_distance_km(t)} km",
                    date=t["departureAt"],
                    status=t.get("status"),
                    link=HistoryLink(type="trip", id=t["id"]),
                )
            )
    elif type_ == "vehicles":
        for v in await vehicles_repo.all_for_agency(agency_id):
            if not _in(v.get("createdAt"), lo, hi):
                continue
            reg = v.get("registrationNumber", "")
            if mem and not text_matches(
                f"{reg} {reg.replace(' ', '')} {v.get('makeModel', '')} {v.get('vehicleClass', '')}", mem
            ):
                continue
            rows.append(
                HistoryRow(
                    type="vehicles",
                    id=v["id"],
                    title=reg,
                    subtitle=f"{v.get('makeModel', '')} · {v.get('vehicleClass', '')} · "
                    f"{int(v.get('maxPayloadKg', 0)):,} kg",
                    date=v["createdAt"],
                    status=v.get("status"),
                    link=None if v.get("status") == "removed" else HistoryLink(type="vehicle", id=v["id"]),
                )
            )
    elif type_ == "drivers":
        drivers = sorted(await drivers_repo.all_for_agency(agency_id), key=lambda d: str(d.get("fullName", "")).lower())
        for d in drivers:
            link = d.get("agencyLink") or {}
            when = link.get("requestedAt") or d.get("createdAt")
            if not _in(when, lo, hi):
                continue
            if mem and not text_matches(f"{d.get('fullName', '')} {str(d.get('phone', ''))[-4:]}", mem):
                continue
            rows.append(
                HistoryRow(
                    type="drivers",
                    id=d["id"],
                    title=d.get("fullName", ""),
                    subtitle=f"{(d.get('stats') or {}).get('delivered', 0)} deliveries · "
                    + ("Invited" if link.get("via") == "invite" else "Requested to join"),
                    date=when,
                    status=link.get("status"),
                    link=HistoryLink(type="driver", id=d["id"]),
                )
            )
    else:  # customers: grouped from the agency's bookings (name only, no contact details)
        bookings = await query_docs(
            col(C.bookings)
            .where(filter=FieldFilter("agencyId", "==", agency_id))
            .order_by("createdAt", direction="DESCENDING")
            .limit(500)
        )
        by: dict[str, dict[str, Any]] = {}
        for b in bookings:
            if not _in(b.get("createdAt"), lo, hi):
                continue
            cur = by.get(b["customerId"])
            if cur:
                cur["count"] += 1
            else:
                by[b["customerId"]] = {
                    "name": (b.get("display") or {}).get("customerName", ""),
                    "count": 1,
                    "latest": b,
                }
        for cid, c in by.items():
            if mem and not text_matches(c["name"], mem):
                continue
            n = c["count"]
            rows.append(
                HistoryRow(
                    type="customers",
                    id=cid,
                    title=c["name"],
                    subtitle=f"{n} {'booking' if n == 1 else 'bookings'} · latest {c['latest']['id']}",
                    date=c["latest"]["createdAt"],
                    status=None,
                    link=HistoryLink(type="booking", id=c["latest"]["id"]),
                )
            )
    items, nxt = page_list(rows, limit, cursor)
    return HistoryPage(items=items, next_cursor=nxt)


_ = doc_ref
