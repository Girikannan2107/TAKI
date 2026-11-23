"""Account documents (P2 §6.4): users, credentials, phoneIndex, customers."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.models.base import DocModel, TimestampedDoc
from app.models.enums import Role, UserStatus


class UserDoc(TimestampedDoc):
    role: Role
    phone: str  # E.164
    display_name: str
    status: UserStatus = "active"
    agency_id: str | None = None
    sessions_valid_after: datetime
    last_login_at: datetime | None = None
    phone_verified_at: datetime


class CredentialDoc(DocModel):
    password_hash: str
    password_changed_at: datetime
    failed_count: int = 0
    locked_until: datetime | None = None
    updated_at: datetime


class PhoneIndexDoc(DocModel):
    uid: str
    role: Role
    created_at: datetime


class FileRef(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    file_id: str


class CustomerStats(BaseModel):
    bookings: int = 0
    delivered: int = 0


class CustomerDoc(TimestampedDoc):
    full_name: str
    dob: str  # IST date YYYY-MM-DD
    phone: str
    photo: FileRef | None = None
    stats: CustomerStats = CustomerStats()
    version: int = 1
