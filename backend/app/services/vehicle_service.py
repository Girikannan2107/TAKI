"""Agency fleet (contract E52–E59; port of ``modules/agency/vehicles.ts`` + RC upload). Owner: D3.

Registration numbers are unique platform-wide through ``registrationIndex/{reg without spaces}``,
claimed in the same transaction as the vehicle. Removal is soft (``status: removed``), releases the
registration and is blocked while the vehicle has published / in-progress trips. Vehicle edits
refresh the ``trip.vehicle`` snapshot on draft and published trips (P2 §6.5).
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.core.config import get_settings
from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.ids import new_id
from app.domain.documents import document_hmac
from app.domain.vehicles import MAX_VEHICLE_PHOTOS, image_key_for, mask_registration, registration_key
from app.middleware import rate_limit
from app.models.misc import new_verification
from app.repositories import agencies as agencies_repo
from app.repositories import trips as trips_repo
from app.repositories import vehicles as vehicles_repo
from app.repositories.base import C, commit_in_batches, run_transaction
from app.schemas.agency import VehicleBody, VehicleDTO, VehiclePatchBody
from app.schemas.common import Items
from app.services import file_service
from app.services.agency_service import agency_id_of, assert_not_suspended, bump, mutable_agency
from app.views import agency as views

log = logging.getLogger("taki.vehicles")


def _taken() -> AppError:
    msg = "A vehicle with this registration number already exists."
    return AppError("registration_taken", msg, fields={"registrationNumber": msg})


async def _owned(agency_id: str, vehicle_id: str) -> dict[str, Any]:
    v = await vehicles_repo.get(vehicle_id)
    if not v or v.get("agencyId") != agency_id or v.get("status") == "removed":
        raise AppError("not_found")
    return v


def _snapshot(v: dict[str, Any]) -> dict[str, Any]:
    photos = v.get("photos") or []
    return {
        "vehicleClass": v["vehicleClass"],
        "makeModel": v.get("makeModel", ""),
        "registrationNumber": v.get("registrationNumber", ""),
        "bodyType": v.get("bodyType", ""),
        "photo": photos[0] if photos else None,
        "imageKey": v.get("imageKey", ""),
    }


async def _dto(v: dict[str, Any], viewer: CurrentUser) -> VehicleDTO:
    return views.vehicle_dto(v, viewer.uid, await trips_repo.count_live_for_vehicle(v["id"]))


# ── Reads (E52, E54) ──────────────────────────────────────────────────────────
async def list_vehicles(user: CurrentUser, status: str) -> Items[VehicleDTO]:
    agency_id = agency_id_of(user)
    statuses = ["active", "inactive"] if status == "all" else [status]
    rows = await vehicles_repo.list_for_agency(agency_id, statuses)
    return Items[VehicleDTO](items=[await _dto(v, user) for v in rows])


async def get_vehicle(user: CurrentUser, vehicle_id: str) -> VehicleDTO:
    return await _dto(await _owned(agency_id_of(user), vehicle_id), user)


# ── Create (E53) ──────────────────────────────────────────────────────────────
async def create_vehicle(user: CurrentUser, body: VehicleBody, now: datetime) -> VehicleDTO:
    agency_id = agency_id_of(user)
    await mutable_agency(user)
    vid = new_id("veh")
    key = registration_key(body.registration_number)
    vehicle: dict[str, Any] = {
        "id": vid,
        "agencyId": agency_id,
        "vehicleClass": body.vehicle_class,
        "modelId": body.model_id,
        "makeModel": body.make_model,
        "registrationNumber": body.registration_number,
        "maxPayloadKg": body.max_payload_kg,
        "bodyType": body.body_type,
        "dimensionsFt": body.dimensions_ft.model_dump() if body.dimensions_ft else None,
        "acceptedGoods": list(body.accepted_goods),
        "handlingSupported": list(body.handling_supported),
        "photos": [],
        "imageKey": image_key_for(body.vehicle_class, body.model_id),
        "rc": None,
        "rcVerification": new_verification(),
        "status": "active",
        "createdAt": now,
        "updatedAt": now,
        "version": 1,
    }

    async def _tx(tx: AsyncTransaction) -> None:
        agency = await agencies_repo.tx_get_agency(tx, agency_id)
        taken = await vehicles_repo.tx_get_registration(tx, key)
        if not agency:
            raise AppError("not_found")
        assert_not_suspended(agency)
        if taken:
            raise _taken()
        vehicles_repo.tx_claim_registration(tx, key, vid, agency_id, now)
        vehicles_repo.tx_create(tx, vehicle)
        stats = agency.get("stats") or {}
        agencies_repo.tx_update(tx, agency_id, {"stats.vehicles": int(stats.get("vehicles", 0)) + 1, "updatedAt": now})

    await run_transaction(_tx)
    return views.vehicle_dto(vehicle, user.uid, 0)


# ── Update (E55) ──────────────────────────────────────────────────────────────
async def update_vehicle(user: CurrentUser, vehicle_id: str, patch: VehiclePatchBody, now: datetime) -> VehicleDTO:
    agency_id = agency_id_of(user)
    await mutable_agency(user)
    fields = patch.model_fields_set

    async def _tx(tx: AsyncTransaction) -> dict[str, Any]:
        v = await vehicles_repo.tx_get_vehicle(tx, vehicle_id)
        if not v or v.get("agencyId") != agency_id or v.get("status") == "removed":
            raise AppError("not_found")
        live = await trips_repo.tx_live_for_vehicle(tx, vehicle_id, 50)
        new_reg = patch.registration_number if "registration_number" in fields else None
        reg_changed = new_reg is not None and new_reg != v.get("registrationNumber")
        new_key = registration_key(new_reg) if reg_changed and new_reg else None
        taken = await vehicles_repo.tx_get_registration(tx, new_key) if new_key else None
        if taken and taken.get("vehicleId") != vehicle_id:
            raise _taken()
        if live:
            if patch.status == "inactive" and v.get("status") != "inactive":
                raise AppError(
                    "vehicle_has_active_trips",
                    "This vehicle has upcoming or active trips. Cancel or reassign them first.",
                )
            if reg_changed:
                raise AppError(
                    "vehicle_has_active_trips",
                    "The registration can't change while the vehicle has upcoming or active trips.",
                    fields={"registrationNumber": "Vehicle is on a published trip"},
                )
            if patch.max_payload_kg is not None:
                biggest = max(int((t.get("capacity") or {}).get("offeredKg", 0)) for t in live)
                if patch.max_payload_kg < biggest:
                    raise AppError(
                        "vehicle_has_active_trips",
                        f"A published trip offers {biggest:,} kg on this vehicle.",
                        fields={"maxPayloadKg": f"At least {biggest:,} kg while trips are published"},
                    )
        merged = dict(v)
        mapping = {
            "vehicle_class": "vehicleClass",
            "model_id": "modelId",
            "make_model": "makeModel",
            "registration_number": "registrationNumber",
            "max_payload_kg": "maxPayloadKg",
            "body_type": "bodyType",
            "accepted_goods": "acceptedGoods",
            "handling_supported": "handlingSupported",
            "status": "status",
        }
        for attr, key in mapping.items():
            if attr in fields and (getattr(patch, attr) is not None or attr == "model_id"):
                val = getattr(patch, attr)
                merged[key] = list(val) if isinstance(val, list) else val
        if "dimensions_ft" in fields:
            merged["dimensionsFt"] = patch.dimensions_ft.model_dump() if patch.dimensions_ft else None
        merged["imageKey"] = image_key_for(merged["vehicleClass"], merged.get("modelId"))
        merged.update(bump(v, now))
        if new_key:
            vehicles_repo.tx_release_registration(tx, registration_key(v["registrationNumber"]))
            vehicles_repo.tx_claim_registration(tx, new_key, vehicle_id, agency_id, now)
        vehicles_repo.tx_set(tx, merged)
        return merged

    merged = await run_transaction(_tx)
    await refresh_trip_snapshots(merged, now)
    return await _dto(merged, user)


async def refresh_trip_snapshots(vehicle: dict[str, Any], now: datetime) -> int:
    """``trip.vehicle`` on draft/published trips (P2 §6.5); capacity max follows the payload on drafts."""
    snap = _snapshot(vehicle)
    writes: list[tuple[str, str, dict[str, Any]]] = []
    for t in await trips_repo.open_for_vehicle(vehicle["id"]):
        data: dict[str, Any] = {"vehicle": snap, "updatedAt": now}
        if t.get("status") == "draft":
            data["capacity.vehicleMaxKg"] = int(vehicle["maxPayloadKg"])
        writes.append((C.trips, t["id"], data))
    return await commit_in_batches(writes)


# ── Remove (E56) ──────────────────────────────────────────────────────────────
async def remove_vehicle(user: CurrentUser, vehicle_id: str, now: datetime) -> None:
    agency_id = agency_id_of(user)
    await mutable_agency(user)

    async def _tx(tx: AsyncTransaction) -> None:
        v = await vehicles_repo.tx_get_vehicle(tx, vehicle_id)
        if not v or v.get("agencyId") != agency_id or v.get("status") == "removed":
            raise AppError("not_found")
        live = await trips_repo.tx_live_for_vehicle(tx, vehicle_id, 1)
        agency = await agencies_repo.tx_get_agency(tx, agency_id)
        if live:
            raise AppError(
                "vehicle_has_active_trips",
                "This vehicle has upcoming or active trips. Cancel them or use another vehicle first.",
            )
        vehicles_repo.tx_update(tx, vehicle_id, {"status": "removed", **bump(v, now)})
        vehicles_repo.tx_release_registration(tx, registration_key(v["registrationNumber"]))
        if agency:
            n = int((agency.get("stats") or {}).get("vehicles", 1))
            agencies_repo.tx_update(tx, agency_id, {"stats.vehicles": max(0, n - 1), "updatedAt": now})

    await run_transaction(_tx)


# ── Photos (E57, E58) ─────────────────────────────────────────────────────────
def _photos_full() -> AppError:
    msg = f"A vehicle can have at most {MAX_VEHICLE_PHOTOS} photos."
    return AppError("conflict", msg, fields={"photo": msg})


async def add_photo(user: CurrentUser, vehicle_id: str, data: bytes, now: datetime) -> VehicleDTO:
    agency_id = agency_id_of(user)
    await mutable_agency(user)
    v = await _owned(agency_id, vehicle_id)
    if len(v.get("photos") or []) >= MAX_VEHICLE_PHOTOS:
        raise _photos_full()
    await rate_limit.check("upload_uid", user.uid, now)
    saved = await file_service.save_upload(
        data=data,
        kind="vehicle_photo",
        owner_type="vehicle",
        owner_id=vehicle_id,
        uploaded_by=user.uid,
        now=now,
        field="photo",
        agency_id=agency_id,
        vehicle_id=vehicle_id,
    )

    async def _tx(tx: AsyncTransaction) -> dict[str, Any]:
        cur = await vehicles_repo.tx_get_vehicle(tx, vehicle_id)
        if not cur or cur.get("agencyId") != agency_id or cur.get("status") == "removed":
            raise AppError("not_found")
        photos = list(cur.get("photos") or [])
        if len(photos) >= MAX_VEHICLE_PHOTOS:
            raise _photos_full()
        merged = {**cur, "photos": [*photos, {"fileId": saved["id"]}], **bump(cur, now)}
        vehicles_repo.tx_set(tx, merged)
        return merged

    try:
        merged = await run_transaction(_tx)
    except Exception:
        await file_service.discard_uploads([saved["id"]], now)
        raise
    await refresh_trip_snapshots(merged, now)
    return await _dto(merged, user)


async def remove_photo(user: CurrentUser, vehicle_id: str, file_id: str, now: datetime) -> VehicleDTO:
    agency_id = agency_id_of(user)
    await mutable_agency(user)

    async def _tx(tx: AsyncTransaction) -> dict[str, Any]:
        cur = await vehicles_repo.tx_get_vehicle(tx, vehicle_id)
        if not cur or cur.get("agencyId") != agency_id or cur.get("status") == "removed":
            raise AppError("not_found")
        photos = list(cur.get("photos") or [])
        if not any(p.get("fileId") == file_id for p in photos):
            raise AppError("not_found")
        merged = {**cur, "photos": [p for p in photos if p.get("fileId") != file_id], **bump(cur, now)}
        vehicles_repo.tx_set(tx, merged)
        return merged

    merged = await run_transaction(_tx)
    await file_service.mark_replaced(file_id, now)
    await refresh_trip_snapshots(merged, now)
    return await _dto(merged, user)


# ── RC document (E59) ─────────────────────────────────────────────────────────
async def upload_rc(
    user: CurrentUser,
    vehicle_id: str,
    front: bytes,
    back: bytes | None,
    valid_until: str | None,
    now: datetime,
) -> VehicleDTO:
    """The RC number is the vehicle's registration (not re-entered). RC review is optional
    (``REQUIRE_VEHICLE_RC_VERIFIED``); uploading moves ``rcVerification`` to ``pending``."""
    agency_id = agency_id_of(user)
    await mutable_agency(user)
    if valid_until is not None:
        try:
            date.fromisoformat(valid_until)
        except ValueError as e:
            raise AppError("invalid_request", fields={"validUntil": "Enter a valid date (YYYY-MM-DD)"}) from e
    v = await _owned(agency_id, vehicle_id)
    if (v.get("rcVerification") or {}).get("status") == "verified":
        raise AppError("already_verified")
    await rate_limit.check("upload_uid", user.uid, now)
    common: dict[str, Any] = {
        "kind": "rc",
        "owner_type": "vehicle",
        "owner_id": vehicle_id,
        "uploaded_by": user.uid,
        "now": now,
        "agency_id": agency_id,
        "vehicle_id": vehicle_id,
    }
    saved = await file_service.save_upload(data=front, field="file", **common)
    saved_back = None
    if back:
        try:
            saved_back = await file_service.save_upload(data=back, field="backFile", **common)
        except Exception:
            await file_service.discard_uploads([saved["id"]], now)
            raise
    uploaded = [saved["id"], *([saved_back["id"]] if saved_back else [])]
    settings = get_settings()
    auto = settings.DEV_AUTO_VERIFY

    async def _tx(tx: AsyncTransaction) -> tuple[dict[str, Any], list[str]]:
        cur = await vehicles_repo.tx_get_vehicle(tx, vehicle_id)
        if not cur or cur.get("agencyId") != agency_id or cur.get("status") == "removed":
            raise AppError("not_found")
        rcv = cur.get("rcVerification") or {}
        if rcv.get("status") == "verified":
            raise AppError("already_verified")
        reg = registration_key(cur["registrationNumber"])
        rc = {
            "kind": "rc",
            "numberMasked": mask_registration(cur["registrationNumber"]),
            "numberHmac": document_hmac(settings.pii_hash_key, "rc", reg),
            "file": {"fileId": saved["id"]},
            "backFile": {"fileId": saved_back["id"]} if saved_back else None,
            "validUntil": valid_until,
            "uploadedAt": now,
        }
        nv = {
            **rcv,
            "status": "verified" if auto else "pending",
            "submittedAt": now,
            "reviewedAt": now if auto else None,
            "reviewedBy": "dev-auto" if auto else None,
            "reason": None,
        }
        prev = cur.get("rc") or {}
        merged = {**cur, "rc": rc, "rcVerification": nv, **bump(cur, now)}
        vehicles_repo.tx_set(tx, merged)
        replaced = [r["fileId"] for r in (prev.get("file"), prev.get("backFile")) if r and r.get("fileId")]
        return merged, replaced

    try:
        merged, replaced = await run_transaction(_tx)
    except Exception:
        await file_service.discard_uploads(uploaded, now)
        raise
    for fid in replaced:
        await file_service.mark_replaced(fid, now)
    return await _dto(merged, user)


def rc_ok(vehicle: dict[str, Any]) -> bool:
    """Publish guard: RC present (``REQUIRE_VEHICLE_RC``) and verified (``REQUIRE_VEHICLE_RC_VERIFIED``)."""
    s = get_settings()
    if s.REQUIRE_VEHICLE_RC and not vehicle.get("rc"):
        return False
    return not (s.REQUIRE_VEHICLE_RC_VERIFIED and (vehicle.get("rcVerification") or {}).get("status") != "verified")
