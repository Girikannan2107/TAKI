"""Firebase Auth wrappers. The Admin SDK is synchronous, so every call runs in a worker thread."""

from __future__ import annotations

from typing import Any

import anyio
from firebase_admin import auth as fb_auth

from app.core.errors import AppError
from app.integrations.firebase.app import init_firebase


async def verify_id_token(token: str, *, check_revoked: bool = False) -> dict[str, Any]:
    """Verify a Firebase ID token; map SDK errors to the error catalog."""
    init_firebase()

    def _verify() -> dict[str, Any]:
        return fb_auth.verify_id_token(token, check_revoked=check_revoked, clock_skew_seconds=10)

    try:
        return await anyio.to_thread.run_sync(_verify)
    except fb_auth.ExpiredIdTokenError as e:
        raise AppError("token_expired") from e
    except fb_auth.RevokedIdTokenError as e:
        raise AppError("session_revoked") from e
    except fb_auth.UserDisabledError as e:
        raise AppError("account_disabled") from e
    except (fb_auth.InvalidIdTokenError, ValueError) as e:
        raise AppError("unauthenticated") from e
    except fb_auth.UserNotFoundError as e:
        raise AppError("unauthenticated") from e


async def create_custom_token(uid: str, claims: dict[str, Any] | None = None) -> str:
    init_firebase()

    def _mint() -> str:
        token = fb_auth.create_custom_token(uid, claims or None)
        return token.decode() if isinstance(token, bytes) else str(token)

    return await anyio.to_thread.run_sync(_mint)


async def set_custom_claims(uid: str, claims: dict[str, Any]) -> None:
    init_firebase()
    await anyio.to_thread.run_sync(lambda: fb_auth.set_custom_user_claims(uid, claims))


async def get_user(uid: str) -> fb_auth.UserRecord | None:
    init_firebase()

    def _get() -> fb_auth.UserRecord | None:
        try:
            return fb_auth.get_user(uid)
        except fb_auth.UserNotFoundError:
            return None

    return await anyio.to_thread.run_sync(_get)


async def create_user(*, phone_number: str, display_name: str | None = None) -> str:
    init_firebase()

    def _create() -> str:
        rec = fb_auth.create_user(phone_number=phone_number, display_name=display_name)
        return str(rec.uid)

    return await anyio.to_thread.run_sync(_create)


async def get_user_by_phone(phone_number: str) -> fb_auth.UserRecord | None:
    init_firebase()

    def _get() -> fb_auth.UserRecord | None:
        try:
            return fb_auth.get_user_by_phone_number(phone_number)
        except fb_auth.UserNotFoundError:
            return None

    return await anyio.to_thread.run_sync(_get)


async def update_user(uid: str, **kwargs: Any) -> None:
    init_firebase()
    await anyio.to_thread.run_sync(lambda: fb_auth.update_user(uid, **kwargs))


async def delete_user(uid: str) -> None:
    init_firebase()

    def _delete() -> None:
        try:
            fb_auth.delete_user(uid)
        except fb_auth.UserNotFoundError:
            pass

    await anyio.to_thread.run_sync(_delete)


async def revoke_refresh_tokens(uid: str) -> None:
    init_firebase()
    await anyio.to_thread.run_sync(lambda: fb_auth.revoke_refresh_tokens(uid))
