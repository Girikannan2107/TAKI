"""Signup ×3, login, password reset, logout, claims (P2 §5.3; port of modules/auth/service.ts).

Phone-proof tokens (Firebase phone OTP) are accepted only by phone status, signup, password
reset and phone change. Daily login is phone + password verified here (argon2id in
``credentials/{uid}``, lockout after 5 failures for 15 minutes, per-IP and per-phone windows),
then a Firebase custom token is minted with claims ``{role, agencyId?, v}``.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.constants import (
    CLAIMS_VERSION,
    LOGIN_LOCK_MAX_FAILURES,
    LOGIN_LOCK_MINUTES,
    MIN_AGE_YEARS,
    UNDERAGE_MESSAGE,
)
from app.core.context import CurrentUser, PhoneProof
from app.core.errors import AppError
from app.core.ids import new_id
from app.core.security import hash_password, password_problem, verify_password
from app.core.time import iso_z, ist_today, years_before
from app.domain.phone import mask_phone
from app.integrations.firebase import auth as fb_auth
from app.middleware import rate_limit
from app.models.misc import new_verification
from app.models.user import CredentialDoc, CustomerDoc, PhoneIndexDoc, UserDoc
from app.repositories import audit as audit_repo
from app.repositories import users as users_repo
from app.repositories.base import C, doc_ref, get_db, get_doc, run_transaction, tx_get
from app.schemas.auth import (
    AgencySignupBody,
    AuthResultDTO,
    CustomerSignupBody,
    DriverSignupBody,
    InviteSummary,
    LoginBody,
    PhoneStatusResponse,
    ResetPasswordBody,
    SessionUserDTO,
)
from app.views.session import session_user_dto

log = logging.getLogger("taki.auth")

ROLE_NOUN = {"customer": "Customer", "agency": "Travel agency", "driver": "Driver", "admin": "Admin"}


# ── helpers ───────────────────────────────────────────────────────────────────
def max_dob(today: date) -> date:
    return years_before(today, MIN_AGE_YEARS)


def is_adult(dob: str, today: date) -> bool:
    return bool(re.match(r"^\d{4}-\d{2}-\d{2}$", dob)) and dob <= max_dob(today).isoformat()


def wrong_role_message(role: str) -> str:
    if role == "admin":
        return "This number can't sign in here."
    noun = ROLE_NOUN.get(role, role)
    return f"This number is registered as a {noun} account. Switch to {noun} login."


def search_tokens_for(*texts: str) -> list[str]:
    """Lowercase word prefixes (≥ 2 chars) for the public agency picker."""
    out: dict[str, None] = {}
    for t in texts:
        for w in [w for w in re.split(r"[^a-z0-9]+", t.lower()) if w]:
            for i in range(2, min(len(w), 15) + 1):
                out[w[:i]] = None
    return list(out)[:60]


def claims_for(role: str, agency_id: str | None) -> dict[str, Any]:
    c: dict[str, Any] = {"role": role, "v": CLAIMS_VERSION}
    if agency_id:
        c["agencyId"] = agency_id
    return c


def _policy(password: str, phone: str) -> None:
    problem = password_problem(password, phone)
    if problem:
        raise AppError("invalid_request", problem, fields={"password": problem})


def _pepper() -> bytes | None:
    return get_settings().password_pepper


def notify_tx(
    tx: AsyncTransaction,
    *,
    user_id: str,
    role: str,
    kind: str,
    title: str,
    body: str,
    link: dict[str, str] | None,
    now: datetime,
) -> None:
    """Write an in-app notification in the caller's transaction (P2 §13.2 shape).

    TODO(D4): replace with ``notification_service.notify(tx, …)`` once it exists.
    """
    nid = new_id("ntf")
    tx.set(
        doc_ref(C.notifications, nid),
        {
            "id": nid,
            "userId": user_id,
            "role": role,
            "kind": kind,
            "title": title,
            "body": body,
            "link": link,
            "createdAt": now,
            "readAt": None,
        },
    )


async def profile_doc_for(user: dict[str, Any]) -> dict[str, Any] | None:
    role = user.get("role")
    if role == "customer":
        return await get_doc(C.customers, user["id"])
    if role == "agency" and user.get("agencyId"):
        return await get_doc(C.agencies, user["agencyId"])
    if role == "driver":
        return await get_doc(C.drivers, user["id"])
    return None


async def session_user(user: dict[str, Any]) -> SessionUserDTO:
    return session_user_dto(user, await profile_doc_for(user))


async def session_user_for_uid(uid: str) -> SessionUserDTO | None:
    user = await users_repo.get_user(uid)
    return await session_user(user) if user else None


async def _sync_claims(uid: str, role: str, agency_id: str | None, *, force: bool = False) -> None:
    wanted = claims_for(role, agency_id)
    try:
        if not force:
            rec = await fb_auth.get_user(uid)
            if rec is not None and (rec.custom_claims or {}) == wanted:
                return
        await fb_auth.set_custom_claims(uid, wanted)
    except Exception:  # claims are derived data; repaired on the next login (P2 §5.5)
        log.warning("claims sync failed", extra={"fields": {"uid": uid}}, exc_info=True)


async def issue(user: dict[str, Any]) -> AuthResultDTO:
    token = await fb_auth.create_custom_token(user["id"], claims_for(user["role"], user.get("agencyId")))
    return AuthResultDTO(custom_token=token, user=await session_user(user))


async def revoke_sessions(uid: str, at: datetime) -> None:
    """Every token with ``auth_time`` before ``at`` is rejected (``sessionsValidAfter``)."""
    await users_repo.update_user(uid, {"sessionsValidAfter": at, "updatedAt": at})
    await fb_auth.revoke_refresh_tokens(uid)


# ── Phone status (E4) ─────────────────────────────────────────────────────────
async def phone_status(proof: PhoneProof, now: datetime) -> PhoneStatusResponse:
    await rate_limit.check("phone_proof_uid", proof.uid, now)
    idx = await users_repo.get_phone_index(proof.phone)
    invite = None
    if not idx:
        q = (
            get_db()
            .collection(C.driver_invites)
            .where(filter=FieldFilter("phone", "==", proof.phone))
            .where(filter=FieldFilter("status", "==", "pending"))
            .limit(5)
        )
        for snap in await q.get():
            inv = snap.to_dict() or {}
            exp = inv.get("expiresAt")
            if exp is None or exp > now:
                invite = InviteSummary(
                    invite_id=snap.id, agency_name=inv.get("agencyName", ""), full_name=inv.get("fullName", "")
                )
                break
    return PhoneStatusResponse(
        phone=proof.phone,
        phone_masked=mask_phone(proof.phone),
        registered=idx is not None,
        role=idx.get("role") if idx else None,
        invite=invite,
    )


# ── Signup (E5–E7) ────────────────────────────────────────────────────────────
def _new_account_docs(
    uid: str, role: str, phone: str, display_name: str, password_hash: str, now: datetime, agency_id: str | None
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    user = UserDoc(
        id=uid,
        role=role,  # type: ignore[arg-type]
        phone=phone,
        display_name=display_name,
        status="active",
        agency_id=agency_id,
        sessions_valid_after=now - timedelta(seconds=5),
        last_login_at=now,
        phone_verified_at=now,
        created_at=now,
        updated_at=now,
    ).to_firestore()
    cred = CredentialDoc(
        id=uid, password_hash=password_hash, password_changed_at=now, failed_count=0, locked_until=None, updated_at=now
    ).to_firestore()
    idx = PhoneIndexDoc(id=phone, uid=uid, role=role, created_at=now).to_firestore()  # type: ignore[arg-type]
    return user, cred, idx


async def _ensure_new_account(tx: AsyncTransaction, proof: PhoneProof) -> None:
    if await users_repo.tx_get_phone_index(tx, proof.phone) or await users_repo.tx_get_user(tx, proof.uid):
        raise AppError("account_exists")


def _write_account(tx: AsyncTransaction, user: dict[str, Any], cred: dict[str, Any], idx: dict[str, Any]) -> None:
    tx.create(doc_ref(C.users, user["id"]), user)
    tx.create(doc_ref(C.credentials, cred["id"]), cred)
    tx.create(doc_ref(C.phone_index, idx["id"]), idx)


async def _precheck_signup(proof: PhoneProof, password: str, now: datetime) -> str:
    await rate_limit.check("phone_proof_uid", proof.uid, now)
    _policy(password, proof.phone)
    if await users_repo.get_phone_index(proof.phone) or await users_repo.get_user(proof.uid):
        raise AppError("account_exists")
    return await hash_password(password, _pepper())


async def _after_signup(user: dict[str, Any]) -> AuthResultDTO:
    await _sync_claims(user["id"], user["role"], user.get("agencyId"), force=True)
    return await issue(user)


async def signup_customer(proof: PhoneProof, body: CustomerSignupBody, now: datetime) -> AuthResultDTO:
    if body.dob > ist_today(now).isoformat():
        raise AppError("invalid_request", fields={"dob": "Enter a valid date of birth"})
    if not is_adult(body.dob, ist_today(now)):
        raise AppError("underage", UNDERAGE_MESSAGE, fields={"dob": UNDERAGE_MESSAGE})
    pw_hash = await _precheck_signup(proof, body.password, now)
    created = utcnow()
    user, cred, idx = _new_account_docs(proof.uid, "customer", proof.phone, body.full_name, pw_hash, created, None)
    customer = CustomerDoc(
        id=proof.uid, full_name=body.full_name, dob=body.dob, phone=proof.phone, created_at=created, updated_at=created
    ).to_firestore()

    async def _tx(tx: AsyncTransaction) -> None:
        await _ensure_new_account(tx, proof)
        _write_account(tx, user, cred, idx)
        tx.create(doc_ref(C.customers, proof.uid), customer)

    await run_transaction(_tx)
    return await _after_signup(user)


async def signup_agency(
    proof: PhoneProof, body: AgencySignupBody, now: datetime, place: dict[str, Any]
) -> AuthResultDTO:
    """``place`` is the resolved ``PlaceRef`` of ``body.base.placeId`` (router resolves it)."""
    settings = get_settings()
    if place.get("state") not in settings.SERVICE_STATES:
        raise AppError("outside_service_area", fields={"base": "Choose a place in our service area"})
    pw_hash = await _precheck_signup(proof, body.password, now)
    created = utcnow()
    agency_id = new_id("agc")
    user, cred, idx = _new_account_docs(proof.uid, "agency", proof.phone, body.owner_name, pw_hash, created, agency_id)
    verification = new_verification()
    if settings.DEV_AUTO_VERIFY:
        verification = {
            "status": "verified",
            "submittedAt": created,
            "reviewedAt": created,
            "reviewedBy": "dev-auto",
            "reason": None,
        }
    states = list(dict.fromkeys([place["state"], *body.states_covered]))[:5]
    agency = {
        "id": agency_id,
        "ownerUid": proof.uid,
        "ownerName": body.owner_name,
        "agencyName": body.agency_name,
        "nameLower": body.agency_name.lower(),
        "searchTokens": search_tokens_for(body.agency_name, str(place.get("district") or place.get("name") or "")),
        "base": place,
        "statesCovered": states,
        "vehicleCountRange": body.vehicle_count_range,
        "phone": proof.phone,
        "photo": None,
        "identityDocument": None,
        "verification": verification,
        "stats": {"vehicles": 0, "drivers": 0, "ratingAvg": 0, "ratingCount": 0, "delivered": 0},
        "createdAt": created,
        "updatedAt": created,
        "version": 1,
    }

    async def _tx(tx: AsyncTransaction) -> None:
        await _ensure_new_account(tx, proof)
        _write_account(tx, user, cred, idx)
        tx.create(doc_ref(C.agencies, agency_id), agency)

    await run_transaction(_tx)
    return await _after_signup(user)


async def signup_driver(proof: PhoneProof, body: DriverSignupBody, now: datetime) -> AuthResultDTO:
    pw_hash = await _precheck_signup(proof, body.password, now)
    created = utcnow()
    user, cred, idx = _new_account_docs(proof.uid, "driver", proof.phone, body.full_name, pw_hash, created, None)

    async def _tx(tx: AsyncTransaction) -> None:
        await _ensure_new_account(tx, proof)
        invite: dict[str, Any] | None = None
        if body.invite_id:
            invite = await tx_get(tx, C.driver_invites, body.invite_id)
            exp = (invite or {}).get("expiresAt")
            if (
                not invite
                or invite.get("status") != "pending"
                or invite.get("phone") != proof.phone
                or (exp is not None and exp <= now)
            ):
                raise AppError(
                    "not_found",
                    "This invite is no longer valid. Choose your agency from the list instead.",
                    fields={"inviteId": "This invite is no longer valid"},
                )
            agency = await tx_get(tx, C.agencies, invite["agencyId"])
            if not agency:
                raise AppError("not_found", "This invite is no longer valid.")
            link = {
                "agencyId": agency["id"],
                "agencyName": agency.get("agencyName", ""),
                "status": "active",
                "via": "invite",
                "requestedAt": created,
                "decidedAt": created,
                "reason": None,
            }
        else:
            agency = await tx_get(tx, C.agencies, str(body.agency_id))
            if not agency or (agency.get("verification") or {}).get("status") != "verified":
                raise AppError(
                    "not_found",
                    "Choose a verified agency from the list.",
                    fields={"agencyId": "Choose a verified agency from the list"},
                )
            link = {
                "agencyId": agency["id"],
                "agencyName": agency.get("agencyName", ""),
                "status": "pending",
                "via": "request",
                "requestedAt": created,
                "decidedAt": None,
                "reason": None,
            }
        _write_account(tx, user, cred, idx)
        tx.create(
            doc_ref(C.drivers, proof.uid),
            {
                "id": proof.uid,
                "fullName": body.full_name,
                "phone": proof.phone,
                "photo": None,
                "license": None,
                "aadhaar": None,
                "agencyLink": link,
                "availability": "available",
                "verification": new_verification(),
                "stats": {"ratingAvg": 0, "ratingCount": 0, "delivered": 0},
                "createdAt": created,
                "updatedAt": created,
                "version": 1,
            },
        )
        if invite:
            tx.update(
                doc_ref(C.driver_invites, invite["id"]),
                {"status": "accepted", "driverId": proof.uid, "updatedAt": created},
            )
            stats = agency.get("stats") or {}
            tx.update(
                doc_ref(C.agencies, agency["id"]),
                {"stats.drivers": int(stats.get("drivers", 0)) + 1, "updatedAt": created},
            )
        else:
            notify_tx(
                tx,
                user_id=agency["ownerUid"],
                role="agency",
                kind="driver_link_requested",
                title="New driver request",
                body=f"{body.full_name} wants to join your agency.",
                link={"type": "driver", "id": proof.uid},
                now=created,
            )

    await run_transaction(_tx)
    return await _after_signup(user)


# ── Login (E8) ────────────────────────────────────────────────────────────────
async def _record_failure(uid: str, now: datetime) -> dict[str, Any] | None:
    async def _tx(tx: AsyncTransaction) -> dict[str, Any] | None:
        cred = await users_repo.tx_get_credentials(tx, uid)
        if not cred:
            return None
        failures = int(cred.get("failedCount", 0)) + 1
        lock = failures >= LOGIN_LOCK_MAX_FAILURES
        update = {
            "failedCount": 0 if lock else failures,
            "lockedUntil": now + timedelta(minutes=LOGIN_LOCK_MINUTES) if lock else cred.get("lockedUntil"),
            "updatedAt": now,
        }
        tx.update(doc_ref(C.credentials, uid), update)
        return update

    return await run_transaction(_tx)


def _locked_error(locked_until: datetime) -> AppError:
    return AppError(
        "account_locked",
        "Too many failed attempts. Try again in 15 minutes or reset your password.",
        details={"lockedUntil": iso_z(locked_until)},
    )


async def check_password(uid: str, password: str, now: datetime, *, field: str = "password") -> dict[str, Any]:
    """Verify a password with the lockout counters. Returns the credentials doc."""
    cred = await users_repo.get_credentials(uid)
    locked = (cred or {}).get("lockedUntil")
    if locked is not None and locked > now:
        raise _locked_error(locked)
    ok, needs_rehash = await verify_password(password, (cred or {}).get("passwordHash"), _pepper())
    if not cred or not ok:
        if cred:
            await _record_failure(uid, now)
        if field == "password":
            raise AppError("invalid_credentials")
        raise AppError("invalid_credentials", "Your password is incorrect.", fields={field: "Incorrect password"})
    update: dict[str, Any] = {}
    if cred.get("failedCount") or cred.get("lockedUntil"):
        update.update({"failedCount": 0, "lockedUntil": None})
    if needs_rehash:
        update["passwordHash"] = await hash_password(password, _pepper())
    if update:
        update["updatedAt"] = now
        await users_repo.update_credentials(uid, update)
    return cred


async def login(body: LoginBody, ip: str, now: datetime) -> AuthResultDTO:
    await rate_limit.check("login_ip", ip, now)
    await rate_limit.check("login_phone", body.phone, now)
    idx = await users_repo.get_phone_index(body.phone)
    if not idx:
        await verify_password(body.password, None, _pepper())  # timing equalisation
        raise AppError("invalid_credentials")
    uid = idx["uid"]
    await check_password(uid, body.password, now)
    user = await users_repo.get_user(uid)
    if not user:
        raise AppError("invalid_credentials")
    if user.get("status") != "active":
        raise AppError("account_disabled")
    if user["role"] != body.role:
        # Revealed only after a correct password. The hidden admin role is never named.
        details = None if user["role"] == "admin" else {"role": user["role"]}
        raise AppError("wrong_role", wrong_role_message(user["role"]), details=details)
    await users_repo.update_user(uid, {"lastLoginAt": now, "updatedAt": now})
    await _sync_claims(uid, user["role"], user.get("agencyId"))
    return await issue(user)


# ── Password reset (E9) ───────────────────────────────────────────────────────
async def reset_password(proof: PhoneProof, body: ResetPasswordBody, now: datetime) -> AuthResultDTO:
    await rate_limit.check("phone_proof_uid", proof.uid, now)
    idx = await users_repo.get_phone_index(proof.phone)
    user = await users_repo.get_user(idx["uid"]) if idx else None
    if not user:
        raise AppError("account_not_found")
    if user.get("status") != "active":
        raise AppError("account_disabled")
    _policy(body.password, user["phone"])
    pw_hash = await hash_password(body.password, _pepper())
    at = utcnow()
    await users_repo.update_credentials(
        user["id"],
        {"passwordHash": pw_hash, "passwordChangedAt": at, "failedCount": 0, "lockedUntil": None, "updatedAt": at},
    )
    await revoke_sessions(user["id"], at)
    await audit_repo.write(
        actor_uid=user["id"], action="auth.password_reset", target_type="user", target_id=user["id"], now=at
    )
    return await issue(user)


# ── Logout (E10) ──────────────────────────────────────────────────────────────
async def logout(user: CurrentUser, all_devices: bool, now: datetime) -> None:
    if all_devices:
        at = utcnow()
        await revoke_sessions(user.uid, at)
        await audit_repo.write(
            actor_uid=user.uid, action="auth.logout_all", target_type="user", target_id=user.uid, now=at
        )
    else:
        await audit_repo.write(
            actor_uid=user.uid, action="auth.logout", target_type="user", target_id=user.uid, now=now
        )


# ── Session (E11) ─────────────────────────────────────────────────────────────
async def session_from_token(token: str | None) -> SessionUserDTO | None:
    """``GET /auth/session``: ``check_revoked=True``; any invalid token gives ``None``."""
    from app.deps import user_from_claims  # local import: deps imports services lazily

    if not token:
        return None
    try:
        claims = await fb_auth.verify_id_token(token, check_revoked=True)
        current = await user_from_claims(claims)
    except AppError:
        return None
    return await session_user_for_uid(current.uid)
