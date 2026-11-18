"""Small documents: contact messages, audit log, rate-limit windows (P2 §6.4)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

from app.models.base import DocModel
from app.models.enums import ContactRole


class ContactMessageDoc(DocModel):
    name: str
    phone: str | None = None
    email: str | None = None
    role: ContactRole = "other"
    message: str
    status: Literal["new", "read", "closed"] = "new"
    ip_hash: str
    created_at: datetime


class AuditTarget(BaseModel):
    type: str
    id: str


class AuditLogDoc(DocModel):
    actor_uid: str | None
    action: str
    target: AuditTarget
    data: dict[str, Any] = {}
    at: datetime


class RateLimitDoc(DocModel):
    bucket: str
    count: int
    window_start: datetime
    expires_at: datetime


class VerificationState(BaseModel):
    """Embedded in agencies/drivers/vehicles (P2 §6.2). camelCase keys in Firestore."""

    status: Literal["not_submitted", "pending", "verified", "rejected", "suspended"] = "not_submitted"
    submitted_at: datetime | None = None
    reviewed_at: datetime | None = None
    reviewed_by: str | None = None
    reason: str | None = None


def new_verification() -> dict[str, Any]:
    return {"status": "not_submitted", "submittedAt": None, "reviewedAt": None, "reviewedBy": None, "reason": None}
