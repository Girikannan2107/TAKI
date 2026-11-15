"""Account features shared by every role (P2 §5.3; port of modules/profile/service.ts):
profile read/edit, password change, phone change, photo, identity documents and the
"submitted for review" rule (``not_submitted`` → ``pending`` once the set is complete).
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.context import CurrentUser, PhoneProof
from app.core.errors import AppError
from app.core.security import hash_password
from app.domain.documents import (
    DOCUMENT_KINDS_FOR,
    DOCUMENT_LABELS,
    DocumentNumberError,
    document_hmac,
    normalize_document_number,
)
from app.domain.phone import mask_phone
from app.integrations.firebase import auth as fb_auth
from app.middleware import rate_limit
from app.repositories import audit as audit_repo
from app.repositories import users as users_repo
from app.repositories.base import C, doc_ref, get_doc, run_transaction, tx_get
from app.schemas.auth import AuthResultDTO, ChangePasswordBody
from app.schemas.common import district_name_of, place_dto
from app.schemas.profile import (
    AdminProfileDTO,
    AgencyProfileDTO,
    AgencyProfilePatch,
    AgencyStatsDTO,
    AgencyVerificationDTO,
    CustomerProfileDTO,
    CustomerProfilePatch,
    DocumentUploadResultDTO,
    DriverAgencyLinkDTO,
    DriverProfileDTO,
    DriverProfilePatch,
    DriverStatsDTO,
    DriverVerificationDTO,
    PhotoResultDTO,
    ProfileDTO,
)
from app.services import auth_service, file_service
from app.services.auth_service import search_tokens_for
from app.views.common import (
    agency_documents,
    agency_documents_complete,
    document_dto,
    driver_documents,
    driver_documents_complete,
    file_ref_dto,
    ref_url,
)

log = logging.getLogger("taki.profile")


async def _load_user(viewer: CurrentUser) -> dict[str, Any]:
    u = await users_repo.get_user(viewer.uid)
    if not u:
        raise AppError("unauthenticated")
    return u


# ── Read (E13) ────────────────────────────────────────────────────────────────
async def get_profile(viewer: CurrentUser) -> ProfileDTO:
    user = await _load_user(viewer)
    uid = user["id"]
    base: dict[str, Any] = {
        "id": uid,
        "phone": user["phone"],
        "phone_masked": mask_phone(user["phone"]),
        "created_at": user["createdAt"],
    }
    role = user["role"]
    if role == "customer":
        c = await users_repo.get_customer(uid)
        if not c:
            raise AppError("not_found")
        return CustomerProfileDTO(**base, full_name=c["fullName"], dob=c["dob"], photo_url=ref_url(c.get("photo"), uid))
    if role == "agency":
        a = await get_doc(C.agencies, user["agencyId"]) if user.get("agencyId") else None
        if not a:
            raise AppError("not_found")
        v = a.get("verification") or {}
        return AgencyProfileDTO(
            **base,
            agency_id=a["id"],
            owner_name=a["ownerName"],
            agency_name=a["agencyName"],
            base=place_dto(a.get("base")),
            district_name=district_name_of(a.get("base")),
            state=str((a.get("base") or {}).get("state", "")),
            states_covered=list(a.get("statesCovered") or []),
            vehicle_count_range=a.get("vehicleCountRange", ""),
            photo_url=ref_url(a.get("photo"), uid),
            verification=AgencyVerificationDTO(
                status=v.get("status", "not_submitted"),
                submitted_at=v.get("submittedAt"),
                reviewed_at=v.get("reviewedAt"),
                reason=v.get("reason"),
            ),
            documents=agency_documents(a, uid),
            stats=AgencyStatsDTO.model_validate(a.get("stats") or {}),
        )
    if role == "driver":
        d = await get_doc(C.drivers, uid)
        if not d:
            raise AppError("not_found")
        v = d.get("verification") or {}
        link = d.get("agencyLink")
        return DriverProfileDTO(
            **base,
            full_name=d["fullName"],
            photo_url=ref_url(d.get("photo"), uid),
            agency_link=DriverAgencyLinkDTO(
                agency_id=link["agencyId"],
                agency_name=link.get("agencyName", ""),
                status=link["status"],
                via=link.get("via", "request"),
            )
            if link
            else None,
            verification=DriverVerificationDTO(
                status=v.get("status", "not_submitted"), reviewed_at=v.get("reviewedAt"), reason=v.get("reason")
            ),
            documents=driver_documents(d, uid),
            stats=DriverStatsDTO.model_validate(d.get("stats") or {}),
        )
    return AdminProfileDTO(**base, name=user.get("displayName", ""))


# ── Edit (E14) ────────────────────────────────────────────────────────────────
async def patch_profile(
    viewer: CurrentUser,
    body: CustomerProfilePatch | AgencyProfilePatch | DriverProfilePatch,
    now: datetime,
    place: dict[str, Any] | None = None,
) -> ProfileDTO:
    """Name changes are denormalised elsewhere (P2 §6.5).

    TODO(D3/D4): fan out ``agencyName`` / driver and customer names to trips, bookings,
    invites and links (call their refresh helpers here once they exist).
    """
    settings = get_settings()

    async def _tx(tx: AsyncTransaction) -> None:
        user = await users_repo.tx_get_user(tx, viewer.uid)
        if not user:
            raise AppError("unauthenticated")
        role = user["role"]
        if role == "customer" and isinstance(body, CustomerProfilePatch):
            tx.update(doc_ref(C.customers, user["id"]), {"fullName": body.full_name, "updatedAt": now})
            tx.update(doc_ref(C.users, user["id"]), {"displayName": body.full_name, "updatedAt": now})
            return
        if role == "driver" and isinstance(body, DriverProfilePatch):
            tx.update(doc_ref(C.drivers, user["id"]), {"fullName": body.full_name, "updatedAt": now})
            tx.update(doc_ref(C.users, user["id"]), {"displayName": body.full_name, "updatedAt": now})
            return
        if role == "agency" and isinstance(body, AgencyProfilePatch) and place is not None:
            agency = await tx_get(tx, C.agencies, str(user.get("agencyId")))
            if not agency:
                raise AppError("not_found")
            if place.get("state") not in settings.SERVICE_STATES:
                raise AppError("outside_service_area", fields={"base": "Choose a place in our service area"})
            tx.update(
                doc_ref(C.agencies, agency["id"]),
                {
                    "ownerName": body.owner_name,
                    "agencyName": body.agency_name,
                    "nameLower": body.agency_name.lower(),
                    "searchTokens": search_tokens_for(
                        body.agency_name, str(place.get("district") or place.get("name") or "")
                    ),
                    "base": place,
                    "statesCovered": list(dict.fromkeys([place["state"], *body.states_covered]))[:5],
                    "vehicleCountRange": body.vehicle_count_range,
                    "updatedAt": now,
                    "version": int(agency.get("version", 1)) + 1,
                },
            )
            tx.update(doc_ref(C.users, user["id"]), {"displayName": body.owner_name, "updatedAt": now})
            return
        if role == "admin":
            raise AppError("forbidden")
        raise AppError("invalid_request", "These details don't match your account type.")

    await run_transaction(_tx)
    return await get_profile(viewer)


# ── Password (E15) ────────────────────────────────────────────────────────────
async def change_password(viewer: CurrentUser, body: ChangePasswordBody, now: datetime) -> AuthResultDTO:
    await rate_limit.check("password_change_uid", viewer.uid, now)
    user = await _load_user(viewer)
    await auth_service.check_password(viewer.uid, body.current_password, now, field="currentPassword")
    auth_service._policy(body.password, user["phone"])  # noqa: SLF001 - shared policy helper
    pw_hash = await hash_password(body.password, get_settings().password_pepper)
    at = utcnow()
    await users_repo.update_credentials(
        viewer.uid,
        {"passwordHash": pw_hash, "passwordChangedAt": at, "failedCount": 0, "lockedUntil": None, "updatedAt": at},
    )
    await auth_service.revoke_sessions(viewer.uid, at)
    await audit_repo.write(
        actor_uid=viewer.uid, action="auth.password_change", target_type="user", target_id=viewer.uid, now=at
    )
    return await auth_service.issue(user)


# ── Phone (E16) ───────────────────────────────────────────────────────────────
async def change_phone(viewer: CurrentUser, current_password: str, proof: PhoneProof, now: datetime) -> AuthResultDTO:
    """TODO(D4): refresh ``booking.display.customerPhone`` on open bookings after the move."""
    await rate_limit.check("phone_proof_uid", viewer.uid, now)
    user = await _load_user(viewer)
    await auth_service.check_password(viewer.uid, current_password, now, field="currentPassword")
    new_phone = proof.phone
    if new_phone == user["phone"]:
        raise AppError("invalid_request", "That's already your number.")
    if await users_repo.get_phone_index(new_phone) or (
        proof.uid != viewer.uid and await users_repo.get_user(proof.uid)
    ):
        raise AppError("phone_taken", "This phone number is already registered to another account.")
    if proof.uid != viewer.uid:
        await fb_auth.delete_user(proof.uid)  # the proof user existed only to prove the number
    await fb_auth.update_user(viewer.uid, phone_number=new_phone)
    at = utcnow()

    async def _tx(tx: AsyncTransaction) -> dict[str, Any]:
        u = await users_repo.tx_get_user(tx, viewer.uid)
        if not u:
            raise AppError("unauthenticated")
        if await users_repo.tx_get_phone_index(tx, new_phone):
            raise AppError("phone_taken", "This phone number is already registered to another account.")
        tx.delete(doc_ref(C.phone_index, u["phone"]))
        tx.create(
            doc_ref(C.phone_index, new_phone), {"id": new_phone, "uid": u["id"], "role": u["role"], "createdAt": at}
        )
        tx.update(doc_ref(C.users, u["id"]), {"phone": new_phone, "phoneVerifiedAt": at, "updatedAt": at})
        if u["role"] == "customer":
            tx.update(doc_ref(C.customers, u["id"]), {"phone": new_phone, "updatedAt": at})
        elif u["role"] == "driver":
            tx.update(doc_ref(C.drivers, u["id"]), {"phone": new_phone, "updatedAt": at})
        elif u["role"] == "agency" and u.get("agencyId"):
            tx.update(doc_ref(C.agencies, u["agencyId"]), {"phone": new_phone, "updatedAt": at})
        return {**u, "phone": new_phone}

    try:
        updated = await run_transaction(_tx)
    except Exception:
        await fb_auth.update_user(viewer.uid, phone_number=user["phone"])  # undo the Auth change
        raise
    await auth_service.revoke_sessions(viewer.uid, at)
    await audit_repo.write(
        actor_uid=viewer.uid, action="auth.phone_change", target_type="user", target_id=viewer.uid, now=at
    )
    return await auth_service.issue(updated)


# ── Photo (E17) ───────────────────────────────────────────────────────────────
def _owner(viewer: CurrentUser) -> tuple[str, str, str]:
    """(collection, owner_type, owner_id) of the profile that owns photos and documents."""
    if viewer.role == "customer":
        return C.customers, "customer", viewer.uid
    if viewer.role == "driver":
        return C.drivers, "driver", viewer.uid
    if viewer.role == "agency" and viewer.agency_id:
        return C.agencies, "agency", viewer.agency_id
    raise AppError("forbidden")


def _next_verification(v: dict[str, Any], complete: bool, now: datetime) -> dict[str, Any]:
    status = v.get("status", "not_submitted")
    if status in ("verified", "suspended") or not complete:
        return v
    if status == "pending" and v.get("submittedAt"):
        return v
    # not_submitted / rejected → pending (resubmission after a rejection).
    return {**v, "status": "pending", "submittedAt": now, "reviewedAt": None, "reviewedBy": None, "reason": None}


async def set_photo(viewer: CurrentUser, data: bytes, now: datetime) -> PhotoResultDTO:
    col, owner_type, owner_id = _owner(viewer)
    await rate_limit.check("upload_uid", viewer.uid, now)
    saved = await file_service.save_upload(
        data=data,
        kind="profile_photo",
        owner_type=owner_type,
        owner_id=owner_id,
        uploaded_by=viewer.uid,
        now=now,
        field="photo",
        user_uid=viewer.uid,
    )

    async def _tx(tx: AsyncTransaction) -> dict[str, Any] | None:
        doc = await tx_get(tx, col, owner_id)
        if not doc:
            raise AppError("not_found")
        update: dict[str, Any] = {"photo": {"fileId": saved["id"]}, "updatedAt": now}
        if owner_type in ("agency", "driver"):
            nxt = {**doc, "photo": {"fileId": saved["id"]}}
            complete = agency_documents_complete(nxt) if owner_type == "agency" else driver_documents_complete(nxt)
            update["verification"] = _next_verification(doc.get("verification") or {}, complete, now)
        tx.update(doc_ref(col, owner_id), update)
        return doc.get("photo")

    try:
        previous = await run_transaction(_tx)
    except Exception:
        await file_service.discard_uploads([saved["id"]], now)
        raise
    if previous and previous.get("fileId") != saved["id"]:
        await file_service.mark_replaced(previous["fileId"], now)
    ref = file_ref_dto(saved["id"], viewer.uid)
    return PhotoResultDTO(photo_url=ref.url, file=ref)


# ── Identity documents (E18) ──────────────────────────────────────────────────
async def upload_document(
    viewer: CurrentUser,
    kind: str,
    number: str,
    valid_until: str | None,
    front: bytes,
    back: bytes | None,
    now: datetime,
) -> DocumentUploadResultDTO:
    if viewer.role not in DOCUMENT_KINDS_FOR:
        raise AppError("forbidden")
    if kind not in DOCUMENT_KINDS_FOR[viewer.role]:
        raise AppError("forbidden", f"{DOCUMENT_LABELS.get(kind, kind)} isn't needed for this account.")
    try:
        n = normalize_document_number(kind, number)
    except DocumentNumberError as e:
        raise AppError("invalid_document_number", str(e), fields={"number": str(e)}) from e
    if valid_until is not None:
        try:
            date.fromisoformat(valid_until)
        except ValueError as e:
            raise AppError("invalid_request", fields={"validUntil": "Enter a valid date (YYYY-MM-DD)"}) from e
    col, owner_type, owner_id = _owner(viewer)
    # Replacing a verified document is refused (P2 §3.3 already_verified).
    current = await get_doc(col, owner_id)
    if not current:
        raise AppError("not_found")
    if (current.get("verification") or {}).get("status") == "verified":
        raise AppError("already_verified")
    await rate_limit.check("upload_uid", viewer.uid, now)

    common = {
        "owner_type": owner_type,
        "owner_id": owner_id,
        "uploaded_by": viewer.uid,
        "now": now,
        "user_uid": viewer.uid,
    }
    saved_front = await file_service.save_upload(data=front, kind=kind, field="file", **common)  # type: ignore[arg-type]
    saved_back = None
    if back:
        try:
            saved_back = await file_service.save_upload(data=back, kind=kind, field="backFile", **common)  # type: ignore[arg-type]
        except Exception:
            await file_service.discard_uploads([saved_front["id"]], now)
            raise
    stored: dict[str, Any] = {
        "kind": kind,
        "numberMasked": n.masked,
        "numberHmac": document_hmac(get_settings().pii_hash_key, kind, n.normalized),
        "file": {"fileId": saved_front["id"]},
        "backFile": {"fileId": saved_back["id"]} if saved_back else None,
        "validUntil": valid_until,
        "uploadedAt": now,
    }
    field = {"agency": "identityDocument", "driving_license": "license", "aadhaar": "aadhaar"}[
        "agency" if owner_type == "agency" else kind
    ]

    async def _tx(tx: AsyncTransaction) -> tuple[list[str], dict[str, Any]]:
        doc = await tx_get(tx, col, owner_id)
        if not doc:
            raise AppError("not_found")
        if (doc.get("verification") or {}).get("status") == "verified":
            raise AppError("already_verified")
        prev = doc.get(field) or {}
        nxt = {**doc, field: stored}
        complete = agency_documents_complete(nxt) if owner_type == "agency" else driver_documents_complete(nxt)
        verification = _next_verification(doc.get("verification") or {}, complete, now)
        tx.update(
            doc_ref(col, owner_id),
            {field: stored, "verification": verification, "updatedAt": now, "version": int(doc.get("version", 1)) + 1},
        )
        replaced = [r["fileId"] for r in (prev.get("file"), prev.get("backFile")) if r and r.get("fileId")]
        return replaced, verification

    uploaded = [saved_front["id"], *([saved_back["id"]] if saved_back else [])]
    try:
        replaced, verification = await run_transaction(_tx)
    except Exception:
        await file_service.discard_uploads(uploaded, now)
        raise
    for fid in replaced:
        await file_service.mark_replaced(fid, now)
    return DocumentUploadResultDTO(
        document=document_dto(kind, stored, verification, viewer.uid), verification=verification["status"]
    )
