"""D3 test builders and fixtures (P2 §15.3). Owner: D3.

Isolation: every D3 suite runs on the **named** Firestore database ``d3-data`` (``base.use_database``),
because other suites wipe ``(default)`` and the Auth emulator between tests. Authentication is
replaced by a header-driven ``get_current_user`` override (``X-Test-Uid``) that still runs D2's
``user_from_claims`` checks (role / status / revocation come from ``users/{uid}`` in ``d3-data``);
token verification itself is covered by D2's auth suites.

Accounts are written with the exact document shapes D2's ``auth_service`` signup writes
(``users``, ``agencies``, ``drivers``); everything else (vehicles, RC, trips, publish) goes through
the API. Maps is D5's deterministic fake gazetteer (place ids ``fake_<town>``).
"""

from __future__ import annotations

import io
import os
import secrets
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI, Header

from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.ids import new_id
from app.deps import get_current_user, user_from_claims
from app.repositories import base
from app.repositories.base import C, doc_ref, get_doc
from tests.support.app import build_app, client_for
from tests.support.emulator import FIRESTORE_URL, PROJECT, emulators_running

TEST_DATABASE = "d3-data"
PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"

# Fake-gazetteer place ids (D5 FakeMapsClient).
COIMBATORE, TIRUPPUR, ERODE, SALEM = "fake_coimbatore", "fake_tiruppur", "fake_erode", "fake_salem"
KRISHNAGIRI, HOSUR, BENGALURU, MUMBAI = "fake_krishnagiri", "fake_hosur", "fake_bengaluru", "fake_mumbai"

_EMU: bool | None = None


def require_emulators() -> None:
    global _EMU
    if _EMU is None:
        _EMU = emulators_running()
    if not _EMU:
        pytest.skip("Firebase emulators are not running (firebase emulators:start --project demo-taki)")


async def clear_d3_database() -> None:
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.delete(f"{FIRESTORE_URL}/emulator/v1/projects/{PROJECT}/databases/{TEST_DATABASE}/documents")
        r.raise_for_status()


def jpeg_bytes() -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (8, 8), (30, 120, 200)).save(out, format="JPEG")
    return out.getvalue()


# ── Fixtures ──────────────────────────────────────────────────────────────────
@pytest.fixture
async def d3_db() -> AsyncIterator[None]:
    require_emulators()
    base.use_database(TEST_DATABASE)
    await clear_d3_database()
    try:
        yield
    finally:
        await base.close_named_clients()
        base.use_database(None)


async def _test_user(x_test_uid: str | None = Header(default=None)) -> CurrentUser:
    if not x_test_uid:
        raise AppError("unauthenticated")
    now = int(datetime.now(UTC).timestamp())
    return await user_from_claims({"uid": x_test_uid, "auth_time": now, "firebase": {"sign_in_provider": "custom"}})


@pytest.fixture
def d3_app(d3_db: None) -> FastAPI:
    app = build_app()
    app.dependency_overrides[get_current_user] = _test_user
    return app


@pytest.fixture
async def api(d3_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with client_for(d3_app) as c:
        yield c


# ── Accounts (shapes = D2 auth_service signup) ────────────────────────────────
@dataclass
class Account:
    uid: str
    role: str
    phone: str
    name: str
    agency_id: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def headers(self) -> dict[str, str]:
        return {"X-Test-Uid": self.uid}

    @property
    def user(self) -> CurrentUser:
        return CurrentUser(uid=self.uid, role=self.role, phone=self.phone, name=self.name, agency_id=self.agency_id)


_seq = {"n": 0}


def next_phone() -> str:
    _seq["n"] += 1
    return f"+9197{secrets.randbelow(10**4):04d}{_seq['n'] % 10**4:04d}"


def _uid() -> str:
    return "u" + secrets.token_hex(10)


def _verification(status: str, now: datetime) -> dict[str, Any]:
    submitted = now if status != "not_submitted" else None
    reviewed = now if status in ("verified", "rejected", "suspended") else None
    return {
        "status": status,
        "submittedAt": submitted,
        "reviewedAt": reviewed,
        "reviewedBy": "admin" if reviewed else None,
        "reason": None,
    }


def _doc_ref(kind: str) -> dict[str, Any]:
    return {
        "kind": kind,
        "numberMasked": "XXXXXX234F" if kind == "pan" else "XXXX XXXX 2346",
        "numberHmac": secrets.token_hex(16),
        "file": {"fileId": new_id("fil")},
        "backFile": None,
        "validUntil": "2035-01-01" if kind == "driving_license" else None,
        "uploadedAt": datetime.now(UTC),
    }


async def _account(uid: str, role: str, phone: str, name: str, agency_id: str | None, now: datetime) -> None:
    await doc_ref(C.users, uid).set(
        {
            "id": uid,
            "role": role,
            "phone": phone,
            "displayName": name,
            "status": "active",
            "agencyId": agency_id,
            "sessionsValidAfter": now - timedelta(days=1),
            "lastLoginAt": None,
            "phoneVerifiedAt": now,
            "createdAt": now,
            "updatedAt": now,
        }
    )
    await doc_ref(C.phone_index, phone).set({"id": phone, "uid": uid, "role": role, "createdAt": now})


async def make_agency(name: str = "Arun Transports", verification: str = "verified") -> Account:
    now = datetime.now(UTC)
    uid, phone, agency_id = _uid(), next_phone(), new_id("agc")
    await _account(uid, "agency", phone, "Arun Kumar", agency_id, now)
    complete = verification != "not_submitted"
    await doc_ref(C.agencies, agency_id).set(
        {
            "id": agency_id,
            "ownerUid": uid,
            "ownerName": "Arun Kumar",
            "agencyName": name,
            "nameLower": name.lower(),
            "searchTokens": [t for t in name.lower().split() if len(t) >= 2],
            "base": {
                "placeId": COIMBATORE,
                "name": "Coimbatore",
                "formattedAddress": "Coimbatore, Tamil Nadu 641001, India",
                "location": {"lat": 11.0168, "lng": 76.9558},
                "locality": "Coimbatore",
                "district": "Coimbatore",
                "state": "TN",
                "stateName": "Tamil Nadu",
                "pincode": "641001",
                "geohash": "tf2yzk7",
                "geocodedAt": now,
            },
            "statesCovered": ["TN", "KL"],
            "vehicleCountRange": "1-5",
            "phone": phone,
            "photo": {"fileId": new_id("fil")} if complete else None,
            "identityDocument": _doc_ref("pan") if complete else None,
            "verification": _verification(verification, now),
            "stats": {"vehicles": 0, "drivers": 0, "ratingAvg": 0, "ratingCount": 0, "delivered": 0},
            "createdAt": now,
            "updatedAt": now,
            "version": 1,
        }
    )
    return Account(uid=uid, role="agency", phone=phone, name="Arun Kumar", agency_id=agency_id)


async def make_driver(
    agency: Account | None,
    *,
    name: str = "Selvam",
    link: str | None = "active",
    via: str = "invite",
    verification: str = "verified",
    availability: str = "available",
) -> Account:
    now = datetime.now(UTC)
    uid, phone = _uid(), next_phone()
    await _account(uid, "driver", phone, name, None, now)
    agency_doc = await get_doc(C.agencies, agency.agency_id) if agency and agency.agency_id else None
    complete = verification != "not_submitted"
    await doc_ref(C.drivers, uid).set(
        {
            "id": uid,
            "fullName": name,
            "phone": phone,
            "photo": {"fileId": new_id("fil")} if complete else None,
            "license": _doc_ref("driving_license") if complete else None,
            "aadhaar": _doc_ref("aadhaar") if complete else None,
            "agencyLink": {
                "agencyId": agency_doc["id"],
                "agencyName": agency_doc.get("agencyName", ""),
                "status": link,
                "via": via,
                "requestedAt": now,
                "decidedAt": now if link != "pending" else None,
                "reason": None,
            }
            if agency_doc and link
            else None,
            "availability": availability,
            "verification": _verification(verification, now),
            "stats": {"ratingAvg": 0, "ratingCount": 0, "delivered": 0},
            "createdAt": now,
            "updatedAt": now,
            "version": 1,
        }
    )
    if agency_doc and link == "active":
        n = int((agency_doc.get("stats") or {}).get("drivers", 0))
        await doc_ref(C.agencies, agency_doc["id"]).update({"stats.drivers": n + 1})
    return Account(uid=uid, role="driver", phone=phone, name=name)


async def make_customer(name: str = "Ravi Kumar") -> Account:
    now = datetime.now(UTC)
    uid, phone = _uid(), next_phone()
    await _account(uid, "customer", phone, name, None, now)
    await doc_ref(C.customers, uid).set(
        {
            "id": uid,
            "fullName": name,
            "dob": "1990-05-17",
            "phone": phone,
            "photo": None,
            "stats": {"bookings": 0, "delivered": 0},
            "createdAt": now,
            "updatedAt": now,
            "version": 1,
        }
    )
    return Account(uid=uid, role="customer", phone=phone, name=name)


# ── Through the API ───────────────────────────────────────────────────────────
_reg = {"n": 1000}


def next_reg() -> str:
    _reg["n"] += 1
    return f"TN{37 + _reg['n'] % 50:02d}AB{_reg['n']:04d}"


def vehicle_body(**over: Any) -> dict[str, Any]:
    body = {
        "vehicleClass": "Light Truck",
        "modelId": "tata_407",
        "makeModel": "Tata 407",
        "registrationNumber": next_reg(),
        "maxPayloadKg": 3000,
        "bodyType": "closed",
        "dimensionsFt": None,
        "acceptedGoods": ["general_goods", "textiles", "agriculture"],
        "handlingSupported": ["fragile"],
    }
    body.update(over)
    return body


async def create_vehicle(api: httpx.AsyncClient, agency: Account, *, rc: bool = True, **over: Any) -> dict[str, Any]:
    r = await api.post("/api/v1/agency/vehicles", json=vehicle_body(**over), headers=agency.headers)
    assert r.status_code == 201, r.text
    v: dict[str, Any] = r.json()
    if rc:
        r = await api.put(
            f"/api/v1/agency/vehicles/{v['id']}/documents/rc",
            headers=agency.headers,
            files={"file": ("rc.pdf", PDF_BYTES, "application/pdf")},
        )
        assert r.status_code == 200, r.text
        v = r.json()
    return v


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def checkpoints(
    stops: list[str], start: datetime, hours_per_leg: float = 2.0, dwell_min: int = 15
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    t = start
    for i, pid in enumerate(stops):
        last = i == len(stops) - 1
        arr = None if i == 0 else t
        dep = None if last else (t if i == 0 else t + timedelta(minutes=dwell_min))
        out.append(
            {
                "placeId": pid,
                "serviceRadiusKm": 10,
                "expectedArrivalAt": iso(arr) if arr else None,
                "expectedDepartureAt": iso(dep) if dep else None,
            }
        )
        if dep:
            t = dep + timedelta(hours=hours_per_leg)
    return out


def trip_body(
    vehicle_id: str,
    driver_id: str,
    *,
    stops: list[str] | None = None,
    start: datetime | None = None,
    offered_kg: int = 1000,
    publish: bool = True,
    **over: Any,
) -> dict[str, Any]:
    start = start or (datetime.now(UTC) + timedelta(days=1)).replace(microsecond=0)
    body: dict[str, Any] = {
        "vehicleId": vehicle_id,
        "driverId": driver_id,
        "offeredKg": offered_kg,
        "checkpoints": checkpoints(stops or [COIMBATORE, TIRUPPUR, ERODE, SALEM], start),
        "acceptedGoods": ["general_goods", "textiles"],
        "handlingSupported": [],
        "maxPackageKg": None,
        "goodsNotes": "No liquids",
        "ratePerKmPaise": 1500,
        "ratePerKgPaise": 100,
        "additionalCharges": [{"label": "Loading", "amountRupees": 200, "basis": "per_booking"}],
        "publish": publish,
    }
    body.update(over)
    return body


async def create_trip(
    api: httpx.AsyncClient, agency: Account, vehicle_id: str, driver_id: str, **kw: Any
) -> dict[str, Any]:
    r = await api.post("/api/v1/agency/trips", json=trip_body(vehicle_id, driver_id, **kw), headers=agency.headers)
    assert r.status_code == 201, r.text
    return dict(r.json())


@dataclass
class World:
    agency: Account
    drivers: list[Account]
    vehicles: list[dict[str, Any]]


async def make_world(api: httpx.AsyncClient, *, drivers: int = 2, vehicles: int = 2) -> World:
    agency = await make_agency()
    ds = [await make_driver(agency, name=f"Driver {i + 1}") for i in range(drivers)]
    vs = [await create_vehicle(api, agency) for _ in range(vehicles)]
    return World(agency=agency, drivers=ds, vehicles=vs)


async def raw_trip(trip_id: str) -> dict[str, Any]:
    t = await get_doc(C.trips, trip_id)
    assert t is not None
    return t


__all__ = [
    "BENGALURU",
    "COIMBATORE",
    "ERODE",
    "HOSUR",
    "KRISHNAGIRI",
    "MUMBAI",
    "PDF_BYTES",
    "SALEM",
    "TEST_DATABASE",
    "TIRUPPUR",
    "Account",
    "World",
    "api",
    "checkpoints",
    "create_trip",
    "create_vehicle",
    "d3_app",
    "d3_db",
    "iso",
    "jpeg_bytes",
    "make_agency",
    "make_customer",
    "make_driver",
    "make_world",
    "raw_trip",
    "trip_body",
    "vehicle_body",
]
_ = os
