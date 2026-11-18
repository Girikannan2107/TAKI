"""Agency ↔ driver links, invites and the driver's own profile (contract E60–E68, E101–E103).
Port of ``modules/agency/{drivers,invites}.ts`` and ``modules/driver/profile.ts``. Owner: D3.

Drivers join by invite (link ``active`` at signup, D2's ``signup_driver``) or by request (``pending``
until the agency approves). Removal sets the link to ``removed`` and is blocked while the driver is on a
published / in-progress trip of the agency. Assignment rules (active link + available + verified + no
schedule overlap) are enforced by ``trip_service`` at publish / reassign time.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.ids import new_id
from app.models.driver import INVITE_TTL_DAYS
from app.repositories import agencies as agencies_repo
from app.repositories import drivers as drivers_repo
from app.repositories import invites as invites_repo
from app.repositories import schedules as schedules_repo
from app.repositories import trips as trips_repo
from app.repositories import users as users_repo
from app.repositories.base import run_transaction
from app.schemas.agency import (
    AgencyDriverDetailDTO,
    AgencyDriverDTO,
    DriverAppProfileDTO,
    DriverInviteBody,
    InviteDTO,
    ReviewDTO,
)
from app.schemas.common import Items
from app.schemas.profile import DriverProfileDTO, DriverProfilePatch
from app.services.agency_service import agency_id_of, bump, mutable_agency
from app.views import agency as views


def _notify(tx: AsyncTransaction, **kw: Any) -> None:
    from app.services import notification_service

    notification_service.notify(tx, **kw)


async def _linked(agency_id: str, driver_id: str) -> dict[str, Any]:
    d = await drivers_repo.get(driver_id)
    if not d or (d.get("agencyLink") or {}).get("agencyId") != agency_id:
        raise AppError("not_found")
    return d


async def _schedule(driver_id: str) -> dict[str, Any] | None:
    return (await schedules_repo.get_schedules([("driver", driver_id)]))[0]


async def _reviews(field: str, value: str, limit: int) -> list[dict[str, Any]]:
    try:
        from app.repositories import reviews as reviews_repo  # D4
    except ImportError:
        return []
    return await reviews_repo.list_for(field, value, limit=limit)


# ── Agency drivers (E60–E65) ──────────────────────────────────────────────────
async def list_drivers(user: CurrentUser, status: str, now: datetime) -> Items[AgencyDriverDTO]:
    agency_id = agency_id_of(user)
    rows = await drivers_repo.list_for_agency(agency_id, status)
    scheds = await schedules_repo.get_schedules([("driver", d["id"]) for d in rows])
    return Items[AgencyDriverDTO](
        items=[views.agency_driver_dto(d, s, now, user.uid) for d, s in zip(rows, scheds, strict=True)]
    )


async def get_driver(user: CurrentUser, driver_id: str, now: datetime) -> AgencyDriverDetailDTO:
    agency_id = agency_id_of(user)
    d = await _linked(agency_id, driver_id)
    schedule = await _schedule(driver_id)
    trips = [t for t in await trips_repo.for_driver(driver_id, 50) if t.get("agencyId") == agency_id][:20]
    reviews = [r for r in await _reviews("driverId", driver_id, 20) if r.get("agencyId") == agency_id]
    base = views.agency_driver_dto(d, schedule, now, user.uid)
    return AgencyDriverDetailDTO(
        **base.model_dump(),
        trips=[views.trip_list_item(t, now, user.uid) for t in trips],
        reviews=[views.review_dto(r) for r in reviews],
        schedule=views.schedule_slots(schedule, now),
    )


async def set_availability(user: CurrentUser, driver_id: str, availability: str, now: datetime) -> AgencyDriverDTO:
    agency_id = agency_id_of(user)
    await mutable_agency(user)

    async def _tx(tx: AsyncTransaction) -> dict[str, Any]:
        d = await drivers_repo.tx_get_driver(tx, driver_id)
        link = (d or {}).get("agencyLink") or {}
        if not d or link.get("agencyId") != agency_id or link.get("status") != "active":
            raise AppError("not_found")
        if availability == "unavailable" and d.get("availability") != "unavailable":
            live = [t for t in await trips_repo.tx_live_for_driver(tx, driver_id) if t.get("agencyId") == agency_id]
            if live:
                raise AppError(
                    "driver_has_active_trips",
                    "This driver is assigned to upcoming or active trips. Reassign them first.",
                    details={"tripIds": [t["id"] for t in live]},
                )
        merged = {**d, "availability": availability, **bump(d, now)}
        drivers_repo.tx_update(tx, driver_id, {"availability": availability, **bump(d, now)})
        return merged

    d = await run_transaction(_tx)
    return views.agency_driver_dto(d, await _schedule(driver_id), now, user.uid)


async def _decide(
    user: CurrentUser, driver_id: str, decision: str, reason: str | None, now: datetime
) -> AgencyDriverDTO:
    agency_id = agency_id_of(user)
    await mutable_agency(user)

    async def _tx(tx: AsyncTransaction) -> dict[str, Any]:
        d = await drivers_repo.tx_get_driver(tx, driver_id)
        agency = await agencies_repo.tx_get_agency(tx, agency_id)
        link = (d or {}).get("agencyLink") or {}
        if not d or not agency or link.get("agencyId") != agency_id:
            raise AppError("not_found")
        if link.get("status") == decision:
            return d  # idempotent replay
        if link.get("status") != "pending":
            raise AppError("invalid_transition", "This driver request has already been handled.")
        new_link = {**link, "status": decision, "decidedAt": now, "reason": reason}
        drivers_repo.tx_update(tx, driver_id, {"agencyLink": new_link, **bump(d, now)})
        name = agency.get("agencyName", "")
        if decision == "active":
            stats = agency.get("stats") or {}
            agencies_repo.tx_update(
                tx, agency_id, {"stats.drivers": int(stats.get("drivers", 0)) + 1, "updatedAt": now}
            )
            title, body = f"{name} approved you", "You can now be assigned to trips."
        else:
            title = f"{name} declined your request"
            body = f"Reason: {reason}" if reason else "You can request another agency from your profile."
        _notify(
            tx,
            user_id=driver_id,
            role="driver",
            kind="driver_link_decided",
            title=title,
            body=body,
            link={"type": "profile", "id": driver_id},
            now=now,
        )
        return {**d, "agencyLink": new_link}

    d = await run_transaction(_tx)
    return views.agency_driver_dto(d, await _schedule(driver_id), now, user.uid)


async def approve_driver(user: CurrentUser, driver_id: str, now: datetime) -> AgencyDriverDTO:
    return await _decide(user, driver_id, "active", None, now)


async def reject_driver(user: CurrentUser, driver_id: str, reason: str | None, now: datetime) -> AgencyDriverDTO:
    return await _decide(user, driver_id, "rejected", (reason or "").strip() or None, now)


async def remove_driver(user: CurrentUser, driver_id: str, now: datetime) -> None:
    agency_id = agency_id_of(user)
    await mutable_agency(user)

    async def _tx(tx: AsyncTransaction) -> None:
        d = await drivers_repo.tx_get_driver(tx, driver_id)
        link = (d or {}).get("agencyLink") or {}
        if not d or link.get("agencyId") != agency_id or link.get("status") == "removed":
            raise AppError("not_found")
        live = [t for t in await trips_repo.tx_live_for_driver(tx, driver_id) if t.get("agencyId") == agency_id]
        agency = await agencies_repo.tx_get_agency(tx, agency_id)
        if live:
            raise AppError(
                "driver_has_active_trips",
                "This driver is assigned to upcoming or active trips. Reassign or cancel them first.",
                details={"tripIds": [t["id"] for t in live]},
            )
        drivers_repo.tx_update(
            tx, driver_id, {"agencyLink": {**link, "status": "removed", "decidedAt": now}, **bump(d, now)}
        )
        if link.get("status") == "active" and agency:
            n = int((agency.get("stats") or {}).get("drivers", 1))
            agencies_repo.tx_update(tx, agency_id, {"stats.drivers": max(0, n - 1), "updatedAt": now})
        _notify(
            tx,
            user_id=driver_id,
            role="driver",
            kind="driver_link_decided",
            title=f"{link.get('agencyName', 'Your agency')} removed you",
            body="You are no longer linked to this agency.",
            link={"type": "profile", "id": driver_id},
            now=now,
        )

    await run_transaction(_tx)


# ── Invites (E66–E68) ─────────────────────────────────────────────────────────
async def list_invites(user: CurrentUser, now: datetime) -> Items[InviteDTO]:
    rows = await invites_repo.list_for_agency(agency_id_of(user))
    return Items[InviteDTO](items=[views.invite_dto(i, now) for i in rows])


async def create_invite(user: CurrentUser, body: DriverInviteBody, now: datetime) -> InviteDTO:
    """14-day invite for a phone number. No SMS: the agency tells the driver, who sees the invite
    after verifying the phone at signup (``/auth/phone/status``)."""
    agency_id = agency_id_of(user)
    await mutable_agency(user)

    async def _tx(tx: AsyncTransaction) -> dict[str, Any]:
        agency = await agencies_repo.tx_get_agency(tx, agency_id)
        idx = await users_repo.tx_get_phone_index(tx, body.phone)
        existing = await invites_repo.tx_pending_for_phone(tx, body.phone)
        driver = await drivers_repo.tx_get_driver(tx, idx["uid"]) if idx and idx.get("role") == "driver" else None
        if not agency:
            raise AppError("not_found")
        if idx and idx.get("role") != "driver":
            msg = "This number is already registered to a TAKI account that isn't a driver. Use another number."
            raise AppError("phone_taken", msg, fields={"phone": msg})
        if idx:
            link = (driver or {}).get("agencyLink") or {}
            mine = link.get("agencyId") == agency_id and link.get("status") in ("pending", "active")
            msg = (
                "This driver is already linked to your agency."
                if mine
                else "This number already has a TAKI driver account. "
                "Ask the driver to request your agency from their profile."
            )
            raise AppError("phone_taken", msg, fields={"phone": msg})
        live = [i for i in existing if i.get("expiresAt") is None or i["expiresAt"] > now]
        if any(i.get("agencyId") == agency_id for i in live):
            raise AppError("already_exists", "You've already invited this number.", fields={"phone": "Already invited"})
        if live:
            msg = "This number has a pending invite from another agency."
            raise AppError("already_exists", msg, fields={"phone": msg})
        for stale in existing:  # expired but still marked pending
            invites_repo.tx_update(tx, stale["id"], {"status": "expired", "updatedAt": now})
        doc = {
            "id": new_id("inv"),
            "agencyId": agency_id,
            "agencyName": agency.get("agencyName", ""),
            "phone": body.phone,
            "fullName": body.full_name,
            "status": "pending",
            "expiresAt": now + timedelta(days=INVITE_TTL_DAYS),
            "driverId": None,
            "createdAt": now,
            "updatedAt": now,
        }
        invites_repo.tx_create(tx, doc)
        return doc

    return views.invite_dto(await run_transaction(_tx), now)


async def revoke_invite(user: CurrentUser, invite_id: str, now: datetime) -> None:
    agency_id = agency_id_of(user)
    await mutable_agency(user)

    async def _tx(tx: AsyncTransaction) -> None:
        inv = await invites_repo.tx_get_invite(tx, invite_id)
        if not inv or inv.get("agencyId") != agency_id:
            raise AppError("not_found")
        if inv.get("status") == "revoked":
            return
        if inv.get("status") != "pending":
            raise AppError("invalid_transition", "This invite is no longer pending.")
        invites_repo.tx_update(tx, invite_id, {"status": "revoked", "updatedAt": now})

    await run_transaction(_tx)


# ── Driver's own profile (E101–E103) ──────────────────────────────────────────
def _require_driver(user: CurrentUser) -> None:
    if user.role != "driver":
        raise AppError("forbidden")


async def driver_profile(user: CurrentUser) -> DriverAppProfileDTO:
    from app.services import profile_service

    _require_driver(user)
    account = await profile_service.get_profile(user)
    if not isinstance(account, DriverProfileDTO):
        raise AppError("forbidden")
    reviews = [views.review_dto(r) for r in await _reviews("driverId", user.uid, 20)]
    return DriverAppProfileDTO(account=account, reviews=reviews)


async def patch_driver_profile(user: CurrentUser, body: DriverProfilePatch, now: datetime) -> DriverAppProfileDTO:
    from app.services import profile_service

    _require_driver(user)
    await profile_service.patch_profile(user, body, now)  # fans out the name (after_profile_patch)
    return await driver_profile(user)


async def request_agency_link(user: CurrentUser, agency_id: str, now: datetime) -> DriverAppProfileDTO:
    """Allowed with no link, or after a rejected / removed link. 409 when active or already pending."""
    _require_driver(user)

    async def _tx(tx: AsyncTransaction) -> None:
        d = await drivers_repo.tx_get_driver(tx, user.uid)
        agency = await agencies_repo.tx_get_agency(tx, agency_id)
        if not d:
            raise AppError("not_found")
        if not agency or (agency.get("verification") or {}).get("status") != "verified":
            raise AppError("not_found", "Choose a verified agency from the list.")
        cur = d.get("agencyLink") or {}
        if cur.get("status") == "active":
            raise AppError(
                "invalid_transition",
                f"You're already linked to {cur.get('agencyName', 'an agency')}. Ask them to remove you first.",
            )
        if cur.get("status") == "pending":
            if cur.get("agencyId") == agency_id:
                return  # idempotent
            raise AppError("invalid_transition", "You already have a pending request. Wait for the agency to respond.")
        link = {
            "agencyId": agency_id,
            "agencyName": agency.get("agencyName", ""),
            "status": "pending",
            "via": "request",
            "requestedAt": now,
            "decidedAt": None,
            "reason": None,
        }
        drivers_repo.tx_update(tx, user.uid, {"agencyLink": link, **bump(d, now)})
        _notify(
            tx,
            user_id=agency["ownerUid"],
            role="agency",
            kind="driver_link_requested",
            title="New driver request",
            body=f"{d.get('fullName', 'A driver')} asked to join {agency.get('agencyName', '')} as a driver.",
            link={"type": "driver", "id": user.uid},
            now=now,
        )

    await run_transaction(_tx)
    return await driver_profile(user)


_ = ReviewDTO
