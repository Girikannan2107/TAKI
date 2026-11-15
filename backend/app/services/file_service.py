"""Uploads, file authorisation and signed content URLs (P2 §12.2; port of ``files/*.ts``).

Uploads go through business endpoints (E17, E18, E57, E59, E98) which call ``save_upload``:
magic-byte sniffing (client MIME types and names are ignored), per-kind size/type rules,
EXIF stripping by re-encoding images, Storage path per P2 §12.2 and a ``files/{fil_*}`` doc.

D3/D4 call ``save_upload`` / ``mark_replaced`` / ``discard_uploads`` and, before projecting a URL
for a viewer, either their own projection rule or ``can_read``.
"""

from __future__ import annotations

import hashlib
import io
import logging
import time
from datetime import UTC, datetime
from typing import Any

from google.cloud.firestore_v1.base_query import FieldFilter

from app.core.config import get_settings
from app.core.constants import DOCUMENT_BYTES, PHOTO_BYTES, PROOF_BYTES
from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.ids import new_id
from app.core.security import verify_file_signature
from app.integrations.firebase import storage as fb_storage
from app.models.file import FileDoc
from app.repositories import files as files_repo
from app.repositories.base import C, get_db, get_doc, query_docs
from app.schemas.common import FileDTO
from app.views.common import file_url_with_exp

log = logging.getLogger("taki.files")

EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"}
IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp")
DOC_TYPES = (*IMAGE_TYPES, "application/pdf")
IDENTITY_KINDS = frozenset({"aadhaar", "pan", "driving_license"})


def sniff_content_type(b: bytes) -> str | None:
    if len(b) >= 3 and b[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(b) >= 8 and b[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(b) >= 12 and b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    if len(b) >= 5 and b[:5] == b"%PDF-":
        return "application/pdf"
    return None


def rules_for(kind: str) -> tuple[int, tuple[str, ...]]:
    if kind in IDENTITY_KINDS or kind == "rc":
        return DOCUMENT_BYTES, DOC_TYPES
    if kind == "delivery_proof":
        return PROOF_BYTES, IMAGE_TYPES
    return PHOTO_BYTES, IMAGE_TYPES


def validate_upload(data: bytes, kind: str, field: str = "file") -> str:
    max_bytes, types = rules_for(kind)
    if len(data) == 0:
        raise AppError("file_invalid", "The file is empty.", fields={field: "The file is empty"})
    if len(data) > max_bytes:
        raise AppError(
            "file_too_large",
            f"Files must be {max_bytes // (1024 * 1024)} MB or smaller.",
            fields={field: "Too large"},
        )
    ctype = sniff_content_type(data)
    if ctype is None or ctype not in types:
        msg = (
            "Upload a JPG, PNG, WEBP or PDF file." if "application/pdf" in types else "Upload a JPG, PNG or WEBP image."
        )
        raise AppError("file_invalid", msg, fields={field: "Unsupported file type"})
    return ctype


def strip_metadata(data: bytes, content_type: str) -> bytes:
    """Re-encode images to drop EXIF (GPS). PDFs are stored as uploaded."""
    if content_type not in IMAGE_TYPES:
        return data
    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover - Pillow is a runtime dependency
        log.warning("Pillow not installed; image metadata not stripped")
        return data
    try:
        with Image.open(io.BytesIO(data)) as img:
            img = ImageOps.exif_transpose(img)
            out = io.BytesIO()
            fmt = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}[content_type]
            if fmt == "JPEG" and img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            img.save(out, format=fmt, **({"quality": 90} if fmt in ("JPEG", "WEBP") else {}))
            return out.getvalue()
    except Exception as e:  # corrupt image with a valid header
        raise AppError("file_invalid", "That image couldn't be read.", fields={"file": "Unreadable image"}) from e


def storage_path_for(
    *,
    kind: str,
    file_id: str,
    ext: str,
    user_uid: str | None = None,
    agency_id: str | None = None,
    vehicle_id: str | None = None,
    booking_id: str | None = None,
) -> str:
    if kind == "profile_photo" and user_uid:
        return f"users/{user_uid}/profile_photo/{file_id}.{ext}"
    if kind in IDENTITY_KINDS and user_uid:
        return f"users/{user_uid}/identity/{kind}/{file_id}.{ext}"
    if kind in ("vehicle_photo", "rc") and agency_id and vehicle_id:
        folder = "photos" if kind == "vehicle_photo" else "rc"
        return f"agencies/{agency_id}/vehicles/{vehicle_id}/{folder}/{file_id}.{ext}"
    if kind == "delivery_proof" and booking_id:
        return f"bookings/{booking_id}/delivery_proof/{file_id}.{ext}"
    raise ValueError(f"cannot build a storage path for kind={kind}")


async def save_upload(
    *,
    data: bytes,
    kind: str,
    owner_type: str,
    owner_id: str,
    uploaded_by: str,
    now: datetime,
    field: str = "file",
    user_uid: str | None = None,
    agency_id: str | None = None,
    vehicle_id: str | None = None,
    booking_id: str | None = None,
) -> dict[str, Any]:
    """Validate + store bytes and create the ``files`` doc. Returns the doc (camelCase dict)."""
    ctype = validate_upload(data, kind, field)
    data = strip_metadata(data, ctype)
    file_id = new_id("fil")
    path = storage_path_for(
        kind=kind,
        file_id=file_id,
        ext=EXT[ctype],
        user_uid=user_uid,
        agency_id=agency_id,
        vehicle_id=vehicle_id,
        booking_id=booking_id,
    )
    await fb_storage.put_object(path, data, ctype)
    doc = FileDoc(
        id=file_id,
        owner_type=owner_type,  # type: ignore[arg-type]
        owner_id=owner_id,
        uploaded_by=uploaded_by,
        kind=kind,  # type: ignore[arg-type]
        storage_path=path,
        content_type=ctype,  # type: ignore[arg-type]
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        status="active",
        created_at=now,
        updated_at=now,
    ).to_firestore()
    try:
        await files_repo.create(doc)
    except Exception:
        await fb_storage.delete_object(path)
        raise
    return doc


async def mark_replaced(file_id: str, now: datetime) -> None:
    """The bytes are deleted later by a ``delete_files`` job (D5/D4 jobs runner, 30 days)."""
    try:
        await files_repo.set_status(file_id, "replaced", now)
    except Exception:  # best effort
        log.warning("mark_replaced failed", extra={"fields": {"fileId": file_id}})


async def discard_uploads(file_ids: list[str], now: datetime) -> None:
    """Delete freshly stored uploads after a failed transaction (best effort)."""
    for fid in file_ids:
        doc = await files_repo.get(fid)
        if not doc:
            continue
        await fb_storage.delete_object(doc["storagePath"])
        await files_repo.set_status(fid, "deleted", now)


# ── Authorisation (P2 §12.2 can_read; port of files/access.ts) ────────────────
def _is_owner(viewer: CurrentUser, f: dict[str, Any]) -> bool:
    ot, oid = f.get("ownerType"), f.get("ownerId")
    if f.get("uploadedBy") == viewer.uid and ot not in ("booking", "vehicle"):
        return True
    if ot in ("customer", "driver"):
        return oid == viewer.uid
    if ot == "agency":
        return viewer.agency_id is not None and oid == viewer.agency_id
    return False


async def _driver_linked_to_agency(agency_id: str | None, driver_id: str, statuses: tuple[str, ...]) -> bool:
    if not agency_id:
        return False
    d = await get_doc(C.drivers, driver_id)
    link = (d or {}).get("agencyLink") or {}
    return link.get("agencyId") == agency_id and link.get("status") in statuses


async def _bookings(filters: list[tuple[str, str]], limit: int = 50) -> list[dict[str, Any]]:
    q: Any = get_db().collection(C.bookings)
    for field, value in filters:
        q = q.where(filter=FieldFilter(field, "==", value))
    return await query_docs(q.limit(limit))


async def can_read(viewer: CurrentUser, f: dict[str, Any]) -> bool:
    if f.get("status") == "deleted":
        return False
    if viewer.role == "admin":
        return True
    if _is_owner(viewer, f):
        return True
    kind, ot, oid = f.get("kind"), f.get("ownerType"), str(f.get("ownerId"))

    if kind in IDENTITY_KINDS:
        # The agency with a pending or active link may review its drivers' documents. Never customers.
        return (
            ot == "driver"
            and viewer.role == "agency"
            and await _driver_linked_to_agency(viewer.agency_id, oid, ("pending", "active"))
        )

    if kind == "vehicle_photo":
        return True  # any authenticated user

    if kind == "rc":
        vehicle = await get_doc(C.vehicles, oid)
        if not vehicle:
            return False
        if viewer.role == "agency" and vehicle.get("agencyId") == viewer.agency_id:
            return True
        if viewer.role == "driver":
            q = (
                get_db()
                .collection(C.trips)
                .where(filter=FieldFilter("vehicleId", "==", oid))
                .where(filter=FieldFilter("driverId", "==", viewer.uid))
                .limit(20)
            )
            return any(t.get("status") in ("published", "in_progress") for t in await query_docs(q))
        return False

    if kind == "delivery_proof":
        if ot != "booking":
            return False
        b = await get_doc(C.bookings, oid)
        if not b:
            return False
        return (
            b.get("customerId") == viewer.uid
            or b.get("driverId") == viewer.uid
            or (viewer.agency_id is not None and b.get("agencyId") == viewer.agency_id)
        )

    if kind == "profile_photo":
        if ot == "driver":
            if viewer.role == "agency" and await _driver_linked_to_agency(viewer.agency_id, oid, ("pending", "active")):
                return True
            if viewer.role == "customer":
                rows = await _bookings([("customerId", viewer.uid), ("driverId", oid)])
                return any(r.get("approvalStatus") == "accepted" for r in rows)
            return False
        if ot == "agency":
            if viewer.role == "customer":
                return bool(await _bookings([("customerId", viewer.uid), ("agencyId", oid)], 1))
            if viewer.role == "driver":
                d = await get_doc(C.drivers, viewer.uid)
                link = (d or {}).get("agencyLink") or {}
                return link.get("agencyId") == oid and link.get("status") == "active"
            return False
        if ot == "customer":
            if viewer.role == "agency" and viewer.agency_id:
                return bool(await _bookings([("customerId", oid), ("agencyId", viewer.agency_id)], 1))
            if viewer.role == "driver":
                rows = await _bookings([("customerId", oid), ("driverId", viewer.uid)])
                return any(r.get("paymentStatus") == "paid" for r in rows)
            return False
    return False


async def get_file_for_viewer(viewer: CurrentUser, file_id: str) -> FileDTO:
    """E21: re-authorise and return a fresh signed URL. Missing or unreadable → 404."""
    f = await files_repo.get(file_id)
    if not f or f.get("status") != "active" or not await can_read(viewer, f):
        raise AppError("not_found")
    url, exp = file_url_with_exp(file_id, viewer.uid)
    return FileDTO(
        file_id=file_id,
        url=url,
        content_type=f["contentType"],
        size_bytes=int(f["sizeBytes"]),
        kind=f["kind"],
        expires_at=datetime.fromtimestamp(exp, tz=UTC),
    )


async def read_signed_content(file_id: str, exp: int, viewer_uid: str, sig: str) -> tuple[bytes, str]:
    """E22: verify the HMAC signature + expiry, re-check the file is active, return bytes."""
    s = get_settings()
    if not verify_file_signature(s.file_url_secret, file_id, viewer_uid, exp, sig, int(time.time())):
        raise AppError("forbidden", "This link is invalid or has expired.")
    f = await files_repo.get(file_id)
    if not f or f.get("status") != "active":
        raise AppError("not_found")
    data = await fb_storage.get_object(f["storagePath"])
    if data is None:
        raise AppError("not_found")
    return data, str(f["contentType"])
