"""T2 helpers: real-auth actors, Firestore readers, soft contract checks. Owner: T2."""

from __future__ import annotations

import io
import re
import secrets
import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import httpx

from app.integrations.cashfree.gateway import CashfreeGateway, DevGateway, GatewayRegistry
from app.integrations.cashfree.settings import PaymentSettings
from app.repositories.base import get_doc, query_docs, col
from app.tests_support.fake_cashfree import TEST_SECRET, FakeCashfreeClient, signed_webhook
from tests.support.emulator import FIRESTORE_URL, PROJECT
from tests.support.tokens import bearer, exchange_custom_token, phone_proof

TEST_DATABASE = "t2-workflow"
PASSWORD = "T2secret2026"
AADHAAR = "234123412346"  # Verhoeff-valid test number
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
API = "/api/v1"
IST = timedelta(hours=5, minutes=30)

COIMBATORE, TIRUPPUR, ERODE, SALEM = "fake_coimbatore", "fake_tiruppur", "fake_erode", "fake_salem"
NAMAKKAL, MUMBAI, KARUR = "fake_namakkal", "fake_mumbai", "fake_karur"
STOPS = [COIMBATORE, TIRUPPUR, ERODE, SALEM]

CONTRACT_NOTES: set[str] = set()


# ── database ──────────────────────────────────────────────────────────────────
def wipe_named_database_sync() -> None:
    url = f"{FIRESTORE_URL}/emulator/v1/projects/{PROJECT}/databases/{TEST_DATABASE}/documents"
    for attempt in range(20):
        r = httpx.delete(url, timeout=30)
        if r.status_code != 409:
            r.raise_for_status()
            return
        time.sleep(2)
    r.raise_for_status()


async def doc(collection: str, doc_id: str) -> dict[str, Any]:
    d = await get_doc(collection, doc_id)
    assert d is not None, f"{collection}/{doc_id} missing"
    return d


async def docs_where(collection: str, field_name: str, value: Any) -> list[dict[str, Any]]:
    from google.cloud.firestore_v1.base_query import FieldFilter

    return await query_docs(col(collection).where(filter=FieldFilter(field_name, "==", value)).limit(200))


# ── payments ──────────────────────────────────────────────────────────────────
class SwitchableRegistry(GatewayRegistry):
    """Both gateways in one registry; ``mode`` picks the gateway for *new* orders. Refunds and
    webhooks resolve by the payment's provider exactly as in production."""

    mode: str = "dev"

    def _active(self) -> Any:
        return self._dev if self.mode == "dev" else self._cashfree

    @property
    def provider(self) -> Any:
        return "dev" if self.mode == "dev" else "cashfree"


def make_registry(fake_cf: FakeCashfreeClient) -> SwitchableRegistry:
    s = PaymentSettings(  # type: ignore[call-arg]
        _env_file=None,
        APP_ENV="test",
        PAYMENT_PROVIDER="dev",
        CASHFREE_APP_ID="TEST_APP",
        CASHFREE_SECRET_KEY=TEST_SECRET,
        CASHFREE_ENV="sandbox",
        APP_ORIGIN="http://localhost:3000",
        PUBLIC_API_BASE_URL="http://localhost:8000",
    )
    return SwitchableRegistry(s, cashfree=CashfreeGateway(fake_cf, "sandbox"), dev=DevGateway("t2-dev-secret"))


def idem() -> dict[str, str]:
    return {"Idempotency-Key": "t2-" + secrets.token_hex(8)}


async def cashfree_webhook(
    api: httpx.AsyncClient, fake_cf: FakeCashfreeClient, pid: str, amount: int, *, ok: bool = True, now: datetime
) -> httpx.Response:
    payment = fake_cf.mark_paid(pid) if ok else fake_cf.mark_failed(pid)
    ts = str(int(now.timestamp() * 1000))
    event = "PAYMENT_SUCCESS_WEBHOOK" if ok else "PAYMENT_FAILED_WEBHOOK"
    body, headers = signed_webhook(event, pid, payment=payment, amount_rupees=amount, timestamp=ts)
    return await api.post(f"{API}/payments/cashfree/webhook", content=body, headers=headers)


# ── contract soft checks ──────────────────────────────────────────────────────
_ID_PATTERNS = [
    (re.compile(r"TAKI\d{8}"), "{bookingId}"),
    (re.compile(r"\b(agc|veh|trp|shp|inv|fil|ntf|pay|stl)_[a-z0-9]{20}\b"), r"{\1Id}"),
]


def path_template(url: str, uids: set[str] | None = None) -> str:
    p = httpx.URL(url).path
    for rx, rep in _ID_PATTERNS:
        p = rx.sub(rep, p)
    for uid in list(ACTOR_UIDS):
        p = p.replace(f"/{uid}", "/{uid}")
    return p


ACTOR_UIDS: set[str] = set()


async def contract_hook(response: httpx.Response) -> None:
    req = response.request
    where = f"{req.method} {path_template(str(req.url))} -> {response.status_code}"
    if response.status_code >= 400:
        await response.aread()
        try:
            body = response.json()
        except ValueError:
            CONTRACT_NOTES.add(f"{where}: error body is not JSON")
            return
        err = body.get("error") if isinstance(body, dict) else None
        if not isinstance(err, dict) or not isinstance(err.get("code"), str) or not isinstance(err.get("message"), str):
            CONTRACT_NOTES.add(f"{where}: error envelope mismatch {str(body)[:120]}")
        elif "fields" in err and err["fields"] is not None and not isinstance(err["fields"], dict):
            CONTRACT_NOTES.add(f"{where}: error.fields is not an object")
    if "/files/" not in req.url.path and "/meta" not in req.url.path:
        cc = response.headers.get("cache-control", "")
        if "no-store" not in cc:
            CONTRACT_NOTES.add(f"{where}: Cache-Control is {cc!r}, contract says no-store")
    if not response.headers.get("x-request-id"):
        CONTRACT_NOTES.add(f"{where}: X-Request-ID not echoed")


def expect_keys(dto: dict[str, Any], keys: list[str], where: str) -> None:
    """Soft contract check: records missing keys instead of failing."""
    missing = [k for k in keys if k not in dto]
    if missing:
        CONTRACT_NOTES.add(f"{where}: missing {missing}")


def ecode(r: httpx.Response) -> str | None:
    try:
        return str(r.json()["error"]["code"])
    except (ValueError, KeyError, TypeError):
        return None


def expect_error(r: httpx.Response, status: int, code: str) -> None:
    assert (r.status_code, ecode(r)) == (status, code), r.text


# ── time ──────────────────────────────────────────────────────────────────────
def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def ist_day(dt: datetime) -> str:
    return (dt.astimezone(UTC) + IST).date().isoformat()


def ist_today(now: datetime) -> date:
    return (now.astimezone(UTC) + IST).date()


def years_ago(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year - years)
    except ValueError:  # Feb 29
        return d.replace(year=d.year - years, day=28)


def half_up(x: Decimal) -> int:
    return int(x.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def checkpoints(stops: list[str], start: datetime, hours_per_leg: float = 2.0, dwell_min: int = 15) -> list[dict[str, Any]]:
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


# ── actors (real auth) ────────────────────────────────────────────────────────
_used_phones: set[str] = set()


def new_phone() -> str:
    while True:
        p = f"+9170020{secrets.randbelow(10**5):05d}"
        if p not in _used_phones:
            _used_phones.add(p)
            return p


@dataclass
class Actor:
    uid: str
    phone: str
    role: str
    token: str
    body: dict[str, Any] = field(default_factory=dict)
    agency_id: str | None = None

    @property
    def h(self) -> dict[str, str]:
        return bearer(self.token)


async def _finish(r: httpx.Response, uid: str, phone: str, role: str) -> Actor:
    assert r.status_code == 201, r.text
    body = r.json()
    token = await exchange_custom_token(body["customToken"])
    ACTOR_UIDS.add(uid)
    a = Actor(uid=uid, phone=phone, role=role, token=token, body=body)
    if role == "agency":
        a.agency_id = (body["user"].get("agency") or {}).get("id")
    return a


async def login(api: httpx.AsyncClient, role: str, phone: str, password: str = PASSWORD) -> httpx.Response:
    return await api.post(f"{API}/auth/login", json={"role": role, "phone": phone, "password": password})


async def admin(api: httpx.AsyncClient) -> Actor:
    from scripts.create_admin import create_admin

    phone = new_phone()
    uid = await create_admin(phone, "T2 Ops Admin", PASSWORD, force=True)
    r = await login(api, "admin", phone)
    assert r.status_code == 200, r.text
    ACTOR_UIDS.add(uid)
    return Actor(uid=uid, phone=phone, role="admin", token=await exchange_custom_token(r.json()["customToken"]), body=r.json())


async def signup_customer(api: httpx.AsyncClient, dob: str = "1990-05-17", name: str = "Ravi Kumar") -> Actor:
    phone = new_phone()
    proof = await phone_proof(phone)
    r = await api.post(
        f"{API}/auth/signup/customer",
        json={"fullName": name, "dob": dob, "acceptTerms": True, "password": PASSWORD, "confirmPassword": PASSWORD},
        headers=bearer(proof.id_token),
    )
    return await _finish(r, proof.uid, phone, "customer")


async def signup_agency(api: httpx.AsyncClient, name: str = "T2 Roadways") -> Actor:
    phone = new_phone()
    proof = await phone_proof(phone)
    r = await api.post(f"{API}/auth/phone/status", headers=bearer(proof.id_token))
    assert r.status_code == 200 and r.json()["registered"] is False, r.text
    r = await api.post(
        f"{API}/auth/signup/agency",
        json={
            "ownerName": "Arun Kumar",
            "agencyName": name,
            "base": {"placeId": COIMBATORE},
            "vehicleCountRange": "1-5",
            "statesCovered": ["TN", "KL"],
            "acceptTerms": True,
            "password": PASSWORD,
            "confirmPassword": PASSWORD,
        },
        headers=bearer(proof.id_token),
    )
    return await _finish(r, proof.uid, phone, "agency")


def jpeg() -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (8, 8), (secrets.randbelow(255), 90, 40)).save(out, format="JPEG")
    return out.getvalue()


async def agency_documents(api: httpx.AsyncClient, a: Actor) -> dict[str, Any]:
    r = await api.put(
        f"{API}/me/documents/pan", headers=a.h, data={"number": "ABCDE1234F"}, files={"file": ("pan.pdf", PDF, "application/pdf")}
    )
    assert r.status_code == 200, r.text
    r = await api.put(f"{API}/me/photo", headers=a.h, files={"photo": ("me.jpg", jpeg(), "image/jpeg")})
    assert r.status_code == 200, r.text
    return dict(r.json())


async def driver_documents(api: httpx.AsyncClient, d: Actor, dl: str = "TN0120190001234") -> None:
    r = await api.put(
        f"{API}/me/documents/driving_license",
        headers=d.h,
        data={"number": dl, "validUntil": "2035-01-01"},
        files={"file": ("dl.pdf", PDF, "application/pdf")},
    )
    assert r.status_code == 200, r.text
    r = await api.put(
        f"{API}/me/documents/aadhaar", headers=d.h, data={"number": AADHAAR}, files={"file": ("a.pdf", PDF, "application/pdf")}
    )
    assert r.status_code == 200, r.text
    r = await api.put(f"{API}/me/photo", headers=d.h, files={"photo": ("me.jpg", jpeg(), "image/jpeg")})
    assert r.status_code == 200, r.text


async def invite_and_signup_driver(api: httpx.AsyncClient, agency: Actor, name: str = "Selvam Driver") -> Actor:
    phone = new_phone()
    r = await api.post(f"{API}/agency/driver-invites", headers=agency.h, json={"fullName": name, "phone": phone})
    assert r.status_code == 201, r.text
    invite = r.json()
    proof = await phone_proof(phone)
    r = await api.post(f"{API}/auth/phone/status", headers=bearer(proof.id_token))
    assert r.status_code == 200, r.text
    st = r.json()
    assert st["registered"] is False and st["invite"] and st["invite"]["inviteId"] == invite["id"], st
    r = await api.post(
        f"{API}/auth/signup/driver",
        json={"fullName": name, "inviteId": invite["id"], "acceptTerms": True, "password": PASSWORD, "confirmPassword": PASSWORD},
        headers=bearer(proof.id_token),
    )
    return await _finish(r, proof.uid, phone, "driver")


_reg = {"n": secrets.randbelow(9000)}


def next_reg() -> str:
    _reg["n"] += 1
    return f"TN{37 + _reg['n'] % 50:02d}T{chr(65 + _reg['n'] % 26)}{_reg['n'] % 10000:04d}"


async def vehicle(api: httpx.AsyncClient, agency: Actor, max_kg: int = 3000) -> dict[str, Any]:
    body = {
        "vehicleClass": "Light Truck",
        "modelId": "tata_407",
        "makeModel": "Tata 407",
        "registrationNumber": next_reg(),
        "maxPayloadKg": max_kg,
        "bodyType": "closed",
        "dimensionsFt": None,
        "acceptedGoods": ["general_goods", "textiles", "agriculture"],
        "handlingSupported": ["fragile"],
    }
    r = await api.post(f"{API}/agency/vehicles", json=body, headers=agency.h)
    assert r.status_code == 201, r.text
    v = r.json()
    r = await api.put(
        f"{API}/agency/vehicles/{v['id']}/documents/rc", headers=agency.h, files={"file": ("rc.pdf", PDF, "application/pdf")}
    )
    assert r.status_code == 200, r.text
    return dict(r.json())


def trip_body(vehicle_id: str, driver_id: str, start: datetime, *, stops: list[str] | None = None, offered_kg: int = 500,
              publish: bool = False, **over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "vehicleId": vehicle_id,
        "driverId": driver_id,
        "offeredKg": offered_kg,
        "checkpoints": checkpoints(stops or STOPS, start),
        "acceptedGoods": ["general_goods", "textiles", "agriculture"],  # no perishables
        "handlingSupported": ["fragile"],
        "maxPackageKg": None,
        "goodsNotes": "No perishables, no liquids",
        "ratePerKmPaise": 1500,
        "ratePerKgPaise": 100,
        "additionalCharges": [
            {"label": "Loading", "amountRupees": 50, "basis": "per_booking"},
            {"label": "Fragile care", "amountRupees": 100, "basis": "special_handling_only"},
        ],
        "publish": publish,
    }
    body.update(over)
    return body


def address(place_id: str, state: str = "TN", line1: str = "12 Market Road") -> dict[str, Any]:
    return {"line1": line1, "pincode": "641001", "state": state, "source": "autocomplete", "placeId": place_id}


def shipment_body(src: str, dst: str, day: str, weight: int = 100, **pkg: Any) -> dict[str, Any]:
    package = {
        "weightKg": weight,
        "goodsCategory": "general_goods",
        "packageType": "box",
        "description": "Cotton bales",
        "pieces": 2,
        "specialHandling": [],
        "declaredValueRupees": 25000,
        "prohibitedItemsDeclaration": True,
    }
    package.update(pkg)
    return {
        "source": address(src),
        "destination": address(dst),
        "receiver": {"name": "Meena Devi", "phone": "98765 43210"},
        "package": package,
        "shippingDate": day,
    }


@dataclass
class Fleet:
    admin: Actor
    agency: Actor
    driver: Actor
    vehicle: dict[str, Any]


async def verified_fleet(api: httpx.AsyncClient, adm: Actor | None = None, name: str = "T2 Fleet") -> Fleet:
    """Agency + driver + vehicle, all through the API and verified by an admin."""
    adm = adm or await admin(api)
    ag = await signup_agency(api, name)
    await agency_documents(api, ag)
    r = await api.get(f"{API}/agency/verification", headers=ag.h)
    if r.json()["status"] == "not_submitted":
        r = await api.post(f"{API}/agency/verification", headers=ag.h, json={})
        assert r.status_code == 200, r.text
    r = await api.post(f"{API}/admin/agencies/{ag.agency_id}/verify", headers=adm.h, json={})
    assert r.status_code == 200, r.text
    v = await vehicle(api, ag)
    d = await invite_and_signup_driver(api, ag)
    await driver_documents(api, d, dl=f"TN01{secrets.randbelow(10**11):011d}")
    r = await api.post(f"{API}/admin/drivers/{d.uid}/verify", headers=adm.h, json={})
    assert r.status_code == 200, r.text
    return Fleet(adm, ag, d, v)


async def publish_trip(api: httpx.AsyncClient, f: Fleet, start: datetime, **kw: Any) -> dict[str, Any]:
    r = await api.post(f"{API}/agency/trips", json=trip_body(f.vehicle["id"], f.driver.uid, start, publish=True, **kw), headers=f.agency.h)
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["status"] == "published", t
    return dict(t)


async def shipment(api: httpx.AsyncClient, c: Actor, src: str, dst: str, day: str, **kw: Any) -> dict[str, Any]:
    r = await api.post(f"{API}/customer/shipments", json=shipment_body(src, dst, day, **kw), headers=c.h)
    assert r.status_code == 201, r.text
    return dict(r.json())


async def request_booking(api: httpx.AsyncClient, c: Actor, shipment_id: str, trip_id: str) -> httpx.Response:
    return await api.post(f"{API}/customer/bookings", json={"shipmentId": shipment_id, "tripId": trip_id}, headers={**c.h, **idem()})


async def dev_pay(api: httpx.AsyncClient, c: Actor, booking_id: str, outcome: str = "success") -> tuple[str, httpx.Response]:
    r = await api.post(f"{API}/payments/orders", json={"bookingId": booking_id}, headers={**c.h, **idem()})
    assert r.status_code in (200, 201), r.text
    order = r.json()
    r2 = await api.post(
        f"{API}/payments/dev/confirm",
        json={"paymentId": order["paymentId"], "outcome": outcome, "devToken": order["checkout"]["devToken"]},
        headers=c.h,
    )
    return order["paymentId"], r2


async def views(api: httpx.AsyncClient, bid: str, c: Actor, ag: Actor, d: Actor | None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    r = await api.get(f"{API}/customer/bookings/{bid}", headers=c.h)
    assert r.status_code == 200, r.text
    out["customer"] = r.json()
    r = await api.get(f"{API}/agency/bookings/{bid}", headers=ag.h)
    assert r.status_code == 200, r.text
    out["agency"] = r.json()
    if d is not None:
        r = await api.get(f"{API}/driver/shipments/{bid}", headers=d.h)
        out["driver"] = r.json() if r.status_code == 200 else None
        out["driver_status"] = r.status_code
    return out


async def assert_synced(api: httpx.AsyncClient, bid: str, c: Actor, ag: Actor, d: Actor | None = None) -> dict[str, Any]:
    """Status and the four state fields identical in every role's view and in Firestore."""
    from app.repositories.base import C

    v = await views(api, bid, c, ag, d)
    fs = await doc(C.bookings, bid)
    fs_state = {k: fs[k] for k in ("approvalStatus", "paymentStatus", "reservationStatus", "fulfilmentStatus")}
    for role in ("customer", "agency", "driver"):
        dto = v.get(role)
        if not dto:
            continue
        st = {k: dto["state"][k] for k in fs_state}
        assert st == fs_state, (role, st, fs_state)
        assert dto["status"] == fs["status"], (role, dto["status"], fs["status"])
    assert v["customer"]["tab"] == fs["tab"]
    return v
