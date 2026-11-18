"""Test app, client and account builders (accounts are created through the API, P2 §15.3)."""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import FastAPI

from app.core.config import Settings
from app.core.errors import AppError
from app.deps import get_place_resolver
from app.main import create_app
from tests.support.tokens import ProofToken, bearer, exchange_custom_token, phone_proof

PASSWORD = "Secret2026"
AADHAAR = "234123412346"  # Verhoeff-valid test number


def make_settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "APP_ENV": "test",
        "FIREBASE_PROJECT_ID": "demo-taki",
        "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080",
        "FIREBASE_AUTH_EMULATOR_HOST": "127.0.0.1:9099",
        "FIREBASE_STORAGE_EMULATOR_HOST": "127.0.0.1:9199",
        "LOG_JSON": False,
        "LOG_LEVEL": "WARNING",
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)  # type: ignore[call-arg]


# ── Fake Maps place resolver (until D5's FakeMaps lands in app/tests_support) ──
PLACES: dict[str, dict[str, Any]] = {
    "ChIJtRyXL69ZqDsRgtI-GB7IwS8": {
        "name": "Coimbatore",
        "formattedAddress": "Coimbatore, Tamil Nadu, India",
        "location": {"lat": 11.0168, "lng": 76.9558},
        "locality": "Coimbatore",
        "district": "Coimbatore",
        "state": "TN",
        "stateName": "Tamil Nadu",
        "pincode": None,
        "geohash": "tf2yzk7",
    },
    "ChIJL_P_CXMEDTkRw0ZdG-0GVvw": {
        "name": "Mumbai",
        "formattedAddress": "Mumbai, Maharashtra, India",
        "location": {"lat": 19.076, "lng": 72.8777},
        "locality": "Mumbai",
        "district": "Mumbai",
        "state": "MH",
        "stateName": "Maharashtra",
        "pincode": None,
        "geohash": "te7ud2e",
    },
}
COIMBATORE = "ChIJtRyXL69ZqDsRgtI-GB7IwS8"
MUMBAI = "ChIJL_P_CXMEDTkRw0ZdG-0GVvw"


class FakePlaceResolver:
    async def resolve_place_id(self, place_id: str) -> dict[str, Any]:
        p = PLACES.get(place_id)
        if not p:
            raise AppError("address_not_found")
        return {"placeId": place_id, **p, "geocodedAt": datetime.now(UTC)}


def build_app(**overrides: Any) -> FastAPI:
    app = create_app(make_settings(**overrides))
    app.dependency_overrides[get_place_resolver] = lambda: FakePlaceResolver()
    return app


def client_for(app: FastAPI) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


# ── Files ─────────────────────────────────────────────────────────────────────
def jpeg_bytes() -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 30)).save(out, format="JPEG")
    return out.getvalue()


PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


# ── Accounts ──────────────────────────────────────────────────────────────────
@dataclass
class Account:
    uid: str
    phone: str
    role: str
    token: str  # session ID token
    body: dict[str, Any]

    @property
    def headers(self) -> dict[str, str]:
        return bearer(self.token)


_counter = {"n": 0}


def next_phone() -> str:
    _counter["n"] += 1
    return f"+9198765{_counter['n']:05d}"


async def _finish(r: httpx.Response, proof: ProofToken, role: str) -> Account:
    assert r.status_code == 201, r.text
    body = r.json()
    token = await exchange_custom_token(body["customToken"])
    return Account(uid=proof.uid, phone=proof.phone, role=role, token=token, body=body)


async def signup_customer(c: httpx.AsyncClient, phone: str | None = None, **fields: Any) -> Account:
    proof = await phone_proof(phone or next_phone())
    payload = {
        "fullName": "Ravi Kumar",
        "dob": "1990-05-17",
        "acceptTerms": True,
        "password": PASSWORD,
        "confirmPassword": PASSWORD,
        **fields,
    }
    r = await c.post("/api/v1/auth/signup/customer", json=payload, headers=bearer(proof.id_token))
    return await _finish(r, proof, "customer")


async def signup_agency(c: httpx.AsyncClient, phone: str | None = None, **fields: Any) -> Account:
    proof = await phone_proof(phone or next_phone())
    payload = {
        "ownerName": "Arun Logistics",
        "agencyName": "Arun Transports",
        "base": {"placeId": COIMBATORE},
        "vehicleCountRange": "1-5",
        "statesCovered": ["KL"],
        "acceptTerms": True,
        "password": PASSWORD,
        "confirmPassword": PASSWORD,
        **fields,
    }
    r = await c.post("/api/v1/auth/signup/agency", json=payload, headers=bearer(proof.id_token))
    return await _finish(r, proof, "agency")


async def signup_driver(c: httpx.AsyncClient, agency_id: str, phone: str | None = None) -> Account:
    proof = await phone_proof(phone or next_phone())
    payload = {
        "fullName": "Selvam Driver",
        "agencyId": agency_id,
        "acceptTerms": True,
        "password": PASSWORD,
        "confirmPassword": PASSWORD,
    }
    r = await c.post("/api/v1/auth/signup/driver", json=payload, headers=bearer(proof.id_token))
    return await _finish(r, proof, "driver")


async def make_admin(phone: str | None = None) -> Account:
    from scripts.create_admin import create_admin

    phone = phone or next_phone()
    uid = await create_admin(phone, "Ops Admin", PASSWORD, force=True)
    from tests.support.tokens import session_token

    return Account(uid=uid, phone=phone, role="admin", token=await session_token(uid), body={})


async def login(c: httpx.AsyncClient, role: str, phone: str, password: str = PASSWORD) -> httpx.Response:
    return await c.post("/api/v1/auth/login", json={"role": role, "phone": phone, "password": password})


async def complete_agency_documents(c: httpx.AsyncClient, agency: Account) -> None:
    r = await c.put(
        "/api/v1/me/documents/pan",
        headers=agency.headers,
        data={"number": "ABCDE1234F"},
        files={"file": ("pan.pdf", PDF_BYTES, "application/pdf")},
    )
    assert r.status_code == 200, r.text
    r = await c.put("/api/v1/me/photo", headers=agency.headers, files={"photo": ("me.jpg", jpeg_bytes(), "image/jpeg")})
    assert r.status_code == 200, r.text


async def complete_driver_documents(c: httpx.AsyncClient, driver: Account, valid_until: str = "2035-01-01") -> None:
    r = await c.put(
        "/api/v1/me/documents/driving_license",
        headers=driver.headers,
        data={"number": "TN0120190001234", "validUntil": valid_until},
        files={"file": ("dl.pdf", PDF_BYTES, "application/pdf")},
    )
    assert r.status_code == 200, r.text
    r = await c.put(
        "/api/v1/me/documents/aadhaar",
        headers=driver.headers,
        data={"number": AADHAAR},
        files={"file": ("a.pdf", PDF_BYTES, "application/pdf")},
    )
    assert r.status_code == 200, r.text
    r = await c.put("/api/v1/me/photo", headers=driver.headers, files={"photo": ("me.jpg", jpeg_bytes(), "image/jpeg")})
    assert r.status_code == 200, r.text
