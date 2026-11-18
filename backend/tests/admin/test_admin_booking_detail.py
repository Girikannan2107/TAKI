"""GET /admin/bookings/{bookingId} (support lookup). Runs on the named Firestore database
``d2-admin`` and never wipes the emulators: ids are unique per run, so it can share them with
other testers. Booking/payment/event documents are hand-written (read-only endpoint)."""

from __future__ import annotations

import json
import secrets
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.repositories import base
from app.repositories.base import C, doc_ref
from tests.support.app import build_app, client_for
from tests.support.emulator import emulators_running
from tests.support.tokens import bearer, session_token

DATABASE = "d2-admin"


@pytest.fixture
async def api() -> AsyncIterator[httpx.AsyncClient]:
    if not emulators_running():
        pytest.skip("Firebase emulators are not running")
    base.use_database(DATABASE)
    try:
        async with client_for(build_app()) as c:
            yield c
    finally:
        await base.close_named_clients()
        base.use_database(None)


async def _user(role: str, now: datetime) -> tuple[str, dict[str, str]]:
    uid = f"d2{role[:3]}{secrets.token_hex(6)}"
    await doc_ref(C.users, uid).set(
        {
            "id": uid,
            "role": role,
            "phone": f"+91700{secrets.randbelow(10**7):07d}",
            "displayName": f"D2 {role}",
            "status": "active",
            "agencyId": None,
            "sessionsValidAfter": now - timedelta(days=1),
            "createdAt": now,
            "updatedAt": now,
        }
    )
    return uid, bearer(await session_token(uid))


async def _booking(now: datetime) -> tuple[str, str, str]:
    booking_id = f"TAKI{secrets.randbelow(10**8):08d}"
    customer_id = f"d2cus{secrets.token_hex(6)}"
    agency_id = "agc_" + secrets.token_hex(10)
    await doc_ref(C.customers, customer_id).set(
        {"id": customer_id, "fullName": "Ravi Kumar", "phone": "+919876543210", "dob": "1990-01-01"}
    )
    await doc_ref(C.bookings, booking_id).set(
        {
            "id": booking_id,
            "customerId": customer_id,
            "agencyId": agency_id,
            "tripId": "trp_" + secrets.token_hex(10),
            "approvalStatus": "accepted",
            "paymentStatus": "refund_pending",
            "reservationStatus": "released",
            "fulfilmentStatus": "not_started",
            "closure": {"kind": "cancelled", "reason": "customer_cancelled", "at": now, "by": {"role": "customer"}},
            "status": "cancelled",
            "pricing": {"totalPayable": 2450},
            "display": {
                "customerName": "Ravi Kumar",
                "customerPhone": "+919876543210",
                "receiverName": "Secret Receiver",
                "agencyName": "Arun Transports",
                "routeLabel": "Coimbatore → Chennai",
            },
            "createdAt": now - timedelta(hours=2),
            "updatedAt": now,
        }
    )
    await doc_ref(C.booking_secrets, booking_id).set({"id": booking_id, "pickupOtpEnc": "cipher"})
    for i, (status, minutes) in enumerate((("failed", 90), ("refund_pending", 60))):
        pid = "pay_" + secrets.token_hex(10)
        await doc_ref(C.payments, pid).set(
            {
                "id": pid,
                "bookingId": booking_id,
                "customerId": customer_id,
                "agencyId": agency_id,
                "status": status,
                "amountPaise": 245000,
                "failureReason": "declined" if i == 0 else None,
                "cfOrderStatus": "PAID" if i else "ACTIVE",
                "refund": {"status": "pending", "amountPaise": 245000, "reason": "cancelled"} if i else None,
                "createdAt": now - timedelta(minutes=minutes),
                "updatedAt": now,
            }
        )
    events = doc_ref(C.bookings, booking_id).collection("events")
    for i, (etype, role, remarks) in enumerate(
        (("requested", "customer", None), ("accepted", "agency", None), ("cancelled", "customer", "Plans changed"))
    ):
        await events.document(f"bev_{i}{secrets.token_hex(9)}").set(
            {
                "id": f"bev_{i}",
                "bookingId": booking_id,
                "type": etype,
                "at": now - timedelta(minutes=100 - 10 * i),
                "actor": {"role": role, "userId": None},
                "remarks": remarks,
            }
        )
    return booking_id, customer_id, agency_id


async def test_admin_booking_detail(api: httpx.AsyncClient) -> None:
    now = datetime.now(UTC)
    _, admin = await _user("admin", now)
    booking_id, customer_id, agency_id = await _booking(now)

    r = await api.get(f"/api/v1/admin/bookings/{booking_id}", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == booking_id
    assert body["status"] == "cancelled"
    assert body["state"] == {
        "approvalStatus": "accepted",
        "paymentStatus": "refund_pending",
        "reservationStatus": "released",
        "fulfilmentStatus": "not_started",
        "closure": {"kind": "cancelled", "reason": "customer_cancelled"},
    }
    assert body["customer"] == {"id": customer_id, "name": "Ravi Kumar", "phoneMasked": "+91 ••••• •3210"}
    assert body["agency"] == {"id": agency_id, "name": "Arun Transports"}
    assert body["routeLabel"] == "Coimbatore → Chennai"
    assert body["totalPayable"] == 2450
    assert [p["status"] for p in body["payments"]] == ["failed", "refund_pending"]  # oldest first
    assert body["payments"][1]["amountRupees"] == 2450
    assert [(e["type"], e["byRole"], e["note"]) for e in body["events"]] == [
        ("requested", "customer", None),
        ("accepted", "agency", None),
        ("cancelled", "customer", "Plans changed"),
    ]
    assert body["createdAt"].endswith("Z")
    raw = json.dumps(body)
    for leaked in ("9876543210", "Secret Receiver", "cipher", "pickupOtp"):
        assert leaked not in raw, leaked


async def test_admin_booking_detail_access(api: httpx.AsyncClient) -> None:
    now = datetime.now(UTC)
    _, admin = await _user("admin", now)
    _, customer = await _user("customer", now)
    booking_id, _, _ = await _booking(now)
    r = await api.get(f"/api/v1/admin/bookings/{booking_id}", headers=customer)
    assert (r.status_code, r.json()["error"]["code"]) == (403, "forbidden")
    assert (await api.get(f"/api/v1/admin/bookings/{booking_id}")).status_code == 401
    missing = await api.get("/api/v1/admin/bookings/TAKI00000000", headers=admin)
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "not_found")
    assert (await api.get("/api/v1/admin/bookings/not-a-booking", headers=admin)).status_code == 404
