"""ID tokens from the Auth emulator (P2 §15.3).

* ``session_token(uid)``: Admin SDK custom token → ``accounts:signInWithCustomToken`` → ID token
  with ``sign_in_provider == "custom"`` (what the browser gets after ``signInWithCustomToken``).
* ``exchange_custom_token(token)``: the same for a custom token returned by the API.
* ``phone_proof(phone)``: ``accounts:sendVerificationCode`` → read the code from the emulator →
  ``accounts:signInWithPhoneNumber`` → ID token with ``sign_in_provider == "phone"``.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.integrations.firebase import auth as fb_auth
from tests.support.emulator import API_KEY, AUTH_URL, IDENTITY_URL, PROJECT


@dataclass(frozen=True)
class ProofToken:
    uid: str
    phone: str
    id_token: str


async def exchange_custom_token(custom_token: str) -> str:
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            f"{IDENTITY_URL}/accounts:signInWithCustomToken",
            params={"key": API_KEY},
            json={"token": custom_token, "returnSecureToken": True},
        )
        r.raise_for_status()
        return str(r.json()["idToken"])


async def session_token(uid: str, claims: dict[str, object] | None = None) -> str:
    return await exchange_custom_token(await fb_auth.create_custom_token(uid, claims))


async def phone_proof(phone: str) -> ProofToken:
    """``phone`` in E.164 (``+91…``)."""
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            f"{IDENTITY_URL}/accounts:sendVerificationCode",
            params={"key": API_KEY},
            json={"phoneNumber": phone, "recaptchaToken": "ignored-by-emulator"},
        )
        r.raise_for_status()
        session_info = r.json()["sessionInfo"]
        codes = (await c.get(f"{AUTH_URL}/emulator/v1/projects/{PROJECT}/verificationCodes")).json()
        code = next(
            v["code"] for v in reversed(codes.get("verificationCodes", [])) if v.get("sessionInfo") == session_info
        )
        r = await c.post(
            f"{IDENTITY_URL}/accounts:signInWithPhoneNumber",
            params={"key": API_KEY},
            json={"sessionInfo": session_info, "code": code},
        )
        r.raise_for_status()
        data = r.json()
        return ProofToken(uid=str(data["localId"]), phone=phone, id_token=str(data["idToken"]))


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
