"""``files/{fil_*}`` (P2 §6.4)."""

from __future__ import annotations

from app.models.base import TimestampedDoc
from app.models.enums import FileContentType, FileKind, FileOwnerType, FileStatus


class FileDoc(TimestampedDoc):
    owner_type: FileOwnerType
    owner_id: str
    uploaded_by: str
    kind: FileKind
    storage_path: str
    content_type: FileContentType
    size_bytes: int
    sha256: str
    status: FileStatus = "active"
