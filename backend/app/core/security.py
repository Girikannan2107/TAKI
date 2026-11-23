"""Password hashing (argon2id), HMAC helpers and signed file URLs (P2 §5.3, §12.2)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
from functools import lru_cache

import anyio
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.constants import FILE_URL_TTL_SECONDS, PASSWORD_MAX, PASSWORD_MIN

# argon2id $argon2id$v=19$m=65536,t=3,p=2$… (P2 §6.4)
_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2, hash_len=32, salt_len=16)


def _prepare(password: str, pepper: bytes | None) -> str:
    if pepper:
        return hmac.new(pepper, password.encode(), hashlib.sha256).hexdigest()
    return password


def hash_password_sync(password: str, pepper: bytes | None = None) -> str:
    return _hasher.hash(_prepare(password, pepper))


async def hash_password(password: str, pepper: bytes | None = None) -> str:
    return await anyio.to_thread.run_sync(hash_password_sync, password, pepper)


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    return _hasher.hash(secrets.token_urlsafe(18))


def _verify_sync(password: str, stored: str | None, pepper: bytes | None) -> tuple[bool, bool]:
    target = stored or _dummy_hash()
    candidate = _prepare(password[: PASSWORD_MAX * 4], pepper)
    try:
        _hasher.verify(target, candidate)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False, False
    if stored is None:
        return False, False
    return True, _hasher.check_needs_rehash(stored)


async def verify_password(password: str, stored: str | None, pepper: bytes | None = None) -> tuple[bool, bool]:
    """Constant-work verification. ``stored=None`` (unknown account) still runs argon2.

    Returns ``(ok, needs_rehash)``.
    """
    return await anyio.to_thread.run_sync(_verify_sync, password, stored, pepper)


def password_problem(password: str, phone_e164: str | None = None) -> str | None:
    """Password policy (8–64 chars, ≥1 letter, ≥1 digit, not the phone number)."""
    if len(password) < PASSWORD_MIN:
        return f"Use at least {PASSWORD_MIN} characters"
    if len(password) > PASSWORD_MAX:
        return f"Use at most {PASSWORD_MAX} characters"
    if not re.search(r"[A-Za-z]", password):
        return "Include a letter"
    if not re.search(r"\d", password):
        return "Include a number"
    if phone_e164:
        digits = re.sub(r"\D", "", phone_e164)
        pw = re.sub(r"\s", "", password)
        if pw in (digits, digits[-10:], f"+{digits}"):
            return "Don't use your phone number as your password"
    return None


# ── HMAC helpers ──────────────────────────────────────────────────────────────
def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def hmac_b64(key: bytes, message: str) -> str:
    return b64url(hmac.new(key, message.encode(), hashlib.sha256).digest())


def sha256_hex(value: str | bytes) -> str:
    data = value.encode() if isinstance(value, str) else value
    return hashlib.sha256(data).hexdigest()


# ── Signed file content URLs ──────────────────────────────────────────────────
def file_signature(secret: bytes, file_id: str, viewer_uid: str, exp: int) -> str:
    return hmac_b64(secret, f"{file_id}|{viewer_uid}|{exp}")


def signed_file_url(base_url: str, secret: bytes, file_id: str, viewer_uid: str, now_ts: int) -> tuple[str, int]:
    exp = now_ts + FILE_URL_TTL_SECONDS
    sig = file_signature(secret, file_id, viewer_uid, exp)
    return f"{base_url}/api/v1/files/{file_id}/content?exp={exp}&v={viewer_uid}&sig={sig}", exp


def verify_file_signature(secret: bytes, file_id: str, viewer_uid: str, exp: int, sig: str, now_ts: int) -> bool:
    if exp < now_ts or exp > now_ts + FILE_URL_TTL_SECONDS + 60:
        return False
    expected = file_signature(secret, file_id, viewer_uid, exp)
    return hmac.compare_digest(expected, sig)
