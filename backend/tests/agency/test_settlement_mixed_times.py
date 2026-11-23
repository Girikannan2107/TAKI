"""T1-4: earnings whose ``deliveredAt`` is an ISO string (legacy / hand-written) next to Firestore
timestamps must not break the admin overview, the settlements queue, settling or agency earnings."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.repositories.base import C, doc_ref
from tests.support.builders import _account, make_agency


def _earning(agency_id: str, n: int, delivered: Any) -> dict[str, Any]:
    bid = f"TAKI{n:08d}"
    return {
        "id": bid,
        "bookingId": bid,
        "agencyId": agency_id,
        "tripId": "trp_" + "a" * 20,
        "driverId": None,
        "customerPaid": 1850,
        "transportationCharge": 1400,
        "additionalCharges": 100,
        "platformFee": 350,
        "agencyNet": 1500,
        "routeLabel": "Coimbatore → Salem",
        "deliveredAt": delivered,
        "status": "pending",
        "settlementId": None,
        "settledAt": None,
        "createdAt": datetime.now(UTC),
        "updatedAt": datetime.now(UTC),
    }


async def test_mixed_delivered_at_types(api: httpx.AsyncClient) -> None:
    now = datetime.now(UTC).replace(microsecond=0)
    a1, a2, a3 = await make_agency("Alpha"), await make_agency("Beta"), await make_agency("Gamma")
    older = now - timedelta(days=3)
    await doc_ref(C.earnings, "TAKI00000001").set(_earning(a1.agency_id or "", 1, now - timedelta(days=1)))
    await doc_ref(C.earnings, "TAKI00000002").set(
        _earning(a2.agency_id or "", 2, older.isoformat().replace("+00:00", "Z"))
    )
    await doc_ref(C.earnings, "TAKI00000003").set(
        _earning(a3.agency_id or "", 3, (now - timedelta(days=2)).isoformat())
    )
    admin_uid = "admin" + now.strftime("%H%M%S")
    await _account(admin_uid, "admin", "+919000000003", "Ops", None, now)
    admin = {"X-Test-Uid": admin_uid}

    r = await api.get("/api/v1/admin/settlements", headers=admin)
    assert r.status_code == 200, r.text
    assert [x["agencyName"] for x in r.json()["items"]] == ["Beta", "Gamma", "Alpha"]  # oldest first
    r = await api.get("/api/v1/admin/overview", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["settlements"] == {"agencies": 3, "pendingAmount": 4500}

    r = await api.get("/api/v1/agency/earnings", headers=a2.headers)
    assert r.status_code == 200 and r.json()["summary"]["pending"] == 1500
    r = await api.get("/api/v1/agency/dashboard", headers=a2.headers)
    assert r.status_code == 200 and r.json()["revenue"]["total"] == 1500
    body = {"agencyId": a2.agency_id, "through": now.date().isoformat(), "reference": "UTR-MIXED-1"}
    r = await api.post("/api/v1/admin/settlements", json=body, headers=admin)
    assert r.status_code == 201, r.text
    assert r.json()["amount"] == 1500
