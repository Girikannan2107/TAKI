"""Bootstrap the first TAKI admin (P2 §5.3 "Admin bootstrap"; the ``bootstrap_admin`` step).

Creates (or reuses) the Firebase Auth user for the phone, ``users/{uid}`` with role ``admin``,
``credentials/{uid}`` (argon2id) and ``phoneIndex/{e164}``, and sets claims ``{role: "admin"}``.
Refuses when an admin already exists unless ``--force``. Never prints the password.

Usage (from ``backend/``)::

    python -m scripts.create_admin --phone +919000000001 --name "Ops Admin"
    # password: prompted, or TAKI_ADMIN_PASSWORD / --password-env NAME

Emulators: set FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST (and
FIREBASE_PROJECT_ID=demo-taki); production uses Application Default Credentials.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys
from typing import Any

from google.cloud.firestore_v1.base_query import FieldFilter

from app.core.clock import utcnow
from app.core.security import hash_password, password_problem
from app.domain.phone import to_e164
from app.integrations.firebase import auth as fb_auth
from app.models.user import CredentialDoc, PhoneIndexDoc, UserDoc
from app.repositories import audit as audit_repo
from app.repositories.base import C, count, doc_ref, get_db, run_transaction, tx_get
from app.services.auth_service import claims_for


class BootstrapError(RuntimeError):
    pass


async def create_admin(phone: str, name: str, password: str, *, force: bool = False) -> str:
    """Create the admin and return its uid."""
    from app.core.config import get_settings

    e164 = to_e164(phone)
    if not e164:
        raise BootstrapError("Enter a valid Indian mobile number (+91…).")
    name = " ".join(name.split())
    if len(name) < 2:
        raise BootstrapError("Enter the admin's name.")
    problem = password_problem(password, e164)
    if problem:
        raise BootstrapError(f"Password: {problem}.")
    if not force and await count(get_db().collection(C.users).where(filter=FieldFilter("role", "==", "admin"))) > 0:
        raise BootstrapError("An admin already exists. Use --force to add another one.")

    existing = await fb_auth.get_user_by_phone(e164)
    uid = existing.uid if existing else await fb_auth.create_user(phone_number=e164, display_name=name)
    pw_hash = await hash_password(password, get_settings().password_pepper)
    now = utcnow()

    async def _tx(tx: Any) -> None:
        idx = await tx_get(tx, C.phone_index, e164)
        if idx and idx.get("uid") != uid:
            raise BootstrapError("This phone number belongs to another TAKI account.")
        user = await tx_get(tx, C.users, uid)
        if user and user.get("role") != "admin":
            raise BootstrapError("This phone number already has a non-admin TAKI account.")
        tx.set(
            doc_ref(C.users, uid),
            UserDoc(
                id=uid,
                role="admin",
                phone=e164,
                display_name=name,
                status="active",
                agency_id=None,
                sessions_valid_after=now,
                last_login_at=None,
                phone_verified_at=now,
                created_at=(user or {}).get("createdAt", now),
                updated_at=now,
            ).to_firestore(),
        )
        tx.set(
            doc_ref(C.credentials, uid),
            CredentialDoc(
                id=uid,
                password_hash=pw_hash,
                password_changed_at=now,
                failed_count=0,
                locked_until=None,
                updated_at=now,
            ).to_firestore(),
        )
        tx.set(
            doc_ref(C.phone_index, e164), PhoneIndexDoc(id=e164, uid=uid, role="admin", created_at=now).to_firestore()
        )

    await run_transaction(_tx)
    await fb_auth.set_custom_claims(uid, claims_for("admin", None))
    await audit_repo.write(actor_uid=None, action="admin.bootstrap", target_type="user", target_id=uid, now=now)
    return uid


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Create the first TAKI admin user.")
    p.add_argument("--phone", default=os.environ.get("TAKI_ADMIN_PHONE"), help="+91XXXXXXXXXX")
    p.add_argument("--name", default=os.environ.get("TAKI_ADMIN_NAME"), help="display name")
    p.add_argument("--password-env", default="TAKI_ADMIN_PASSWORD", help="env var holding the password")
    p.add_argument("--force", action="store_true", help="create even if an admin already exists")
    args = p.parse_args(argv)
    if not args.phone or not args.name:
        p.error("--phone and --name are required (or TAKI_ADMIN_PHONE / TAKI_ADMIN_NAME)")
    password = os.environ.get(args.password_env) or getpass.getpass("Admin password: ")
    try:
        uid = asyncio.run(create_admin(args.phone, args.name, password, force=args.force))
    except BootstrapError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(f"admin created: uid={uid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
