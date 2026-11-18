"""Shared projections: signed file URLs, documents, verification. Views are the only place that
turns Firestore documents into response DTOs (P2 §2 layering rules).

``file_url`` must only be called **after** the viewer has been authorised to read the file
(``file_service.can_read`` or an equivalent rule in the calling view).
"""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any

from app.core.config import get_settings
from app.core.security import signed_file_url
from app.domain.documents import DOCUMENT_LABELS
from app.schemas.common import FileRefDTO
from app.schemas.profile import DocumentDTO


def file_url(file_id: str, viewer_uid: str) -> str:
    s = get_settings()
    url, _ = signed_file_url(s.PUBLIC_API_BASE_URL, s.file_url_secret, file_id, viewer_uid, int(time.time()))
    return url


def file_url_with_exp(file_id: str, viewer_uid: str) -> tuple[str, int]:
    s = get_settings()
    return signed_file_url(s.PUBLIC_API_BASE_URL, s.file_url_secret, file_id, viewer_uid, int(time.time()))


def ref_url(ref: dict[str, Any] | None, viewer_uid: str) -> str | None:
    """``{fileId}`` map → signed URL (or None)."""
    if not ref or not ref.get("fileId"):
        return None
    return file_url(ref["fileId"], viewer_uid)


def file_ref_dto(file_id: str, viewer_uid: str) -> FileRefDTO:
    return FileRefDTO(file_id=file_id, url=file_url(file_id, viewer_uid))


def document_status(present: bool, verification: dict[str, Any] | None) -> str:
    if not present:
        return "missing"
    status = (verification or {}).get("status", "pending")
    if status in ("verified", "rejected"):
        return status
    return "pending"


def document_dto(
    kind: str, doc: dict[str, Any] | None, verification: dict[str, Any] | None, viewer_uid: str
) -> DocumentDTO:
    """``IdentityDocument`` map → ``DocumentDTO`` (number always masked)."""
    uploaded: datetime | None = (doc or {}).get("uploadedAt")
    valid_until = (doc or {}).get("validUntil")
    return DocumentDTO(
        kind=kind,
        label=DOCUMENT_LABELS.get(kind, kind),
        number_masked=(doc or {}).get("numberMasked"),
        file_url=ref_url((doc or {}).get("file"), viewer_uid),
        back_file_url=ref_url((doc or {}).get("backFile"), viewer_uid),
        status=document_status(doc is not None, verification),  # type: ignore[arg-type]
        uploaded_at=uploaded,
        valid_until=str(valid_until) if valid_until else None,
    )


def agency_documents(agency: dict[str, Any], viewer_uid: str) -> list[DocumentDTO]:
    ident = agency.get("identityDocument")
    if not ident:
        return []
    return [document_dto(ident["kind"], ident, agency.get("verification"), viewer_uid)]


def driver_documents(driver: dict[str, Any], viewer_uid: str) -> list[DocumentDTO]:
    v = driver.get("verification")
    return [
        document_dto("driving_license", driver.get("license"), v, viewer_uid),
        document_dto("aadhaar", driver.get("aadhaar"), v, viewer_uid),
    ]


def agency_documents_complete(agency: dict[str, Any]) -> bool:
    return bool(agency.get("identityDocument")) and bool(agency.get("photo"))


def driver_documents_complete(driver: dict[str, Any]) -> bool:
    return bool(driver.get("license")) and bool(driver.get("aadhaar")) and bool(driver.get("photo"))


def first_name(full: str) -> str:
    parts = full.strip().split()
    return parts[0] if parts else full
