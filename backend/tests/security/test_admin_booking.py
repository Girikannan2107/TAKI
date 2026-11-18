"""T3 · ``GET /api/v1/admin/bookings/{bookingId}`` (D2 afc7f92): admin only, and the support view
never carries OTPs, addresses, receiver details or the full customer phone. (The generic matrix in
``test_authz_matrix.py`` also covers it through the OpenAPI schema.)"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.core.clock import FrozenClock
from app.repositories.base import C, doc_ref
from app.tests_support.fake_cashfree import FakeCashfreeClient
from tests.bookings.support import COIMBATORE, SALEM, accept, create_shipment, customer_view, make_world, pay, request
from tests.security.conftest import auth, bearer, err, forge_token
from tests.support.builders import Account, make_agency, make_customer, make_driver

pytestmark = pytest.mark.emulator


async def _admin() -> Account:
    now = datetime.now(UTC)
    uid = "t3badm" + now.strftime("%H%M%S%f")
    await doc_ref(C.users, uid).set(
        {
            "id": uid,
            "role": "admin",
            "phone": "+917003099997",
            "displayName": "T3 Admin",
            "status": "active",
            "agencyId": None,
            "sessionsValidAfter": now - timedelta(days=1),
            "createdAt": now,
            "updatedAt": now,
        }
    )
    return Account(uid=uid, role="admin", phone="+917003099997", name="T3 Admin")


async def test_admin_booking_detail_access_and_projection(
    http: httpx.AsyncClient, clock: FrozenClock, fake_cf: FakeCashfreeClient
) -> None:
    w = await make_world(http, clock)
    s = await create_shipment(http, w, COIMBATORE, SALEM, weight=150)
    bid = (await request(http, w, s["id"])).json()["id"]
    assert (await accept(http, w, bid)).status_code == 200
    await pay(http, w, bid, fake_cf, clock)
    otps = (await customer_view(http, w, bid))["otps"]
    path = f"/api/v1/admin/bookings/{bid}"

    # AuthN / AuthZ
    r = await http.get(path)
    assert (r.status_code, err(r)) == (401, "unauthenticated")
    r = await http.get(path, headers=bearer("garbage"))
    assert r.status_code == 401
    admin = await _admin()
    r = await http.get(path, headers=bearer(forge_token(admin.uid, provider="phone", phone=admin.phone)))
    assert (r.status_code, err(r)) == (403, "password_login_required")
    other_agency = await make_agency()
    for who in (w.customer, w.agency, w.driver, await make_customer(), other_agency, await make_driver(other_agency)):
        r = await http.get(path, headers=auth(who))
        assert (r.status_code, err(r)) == (403, "forbidden"), (who.role, r.text)
    # A forged admin claim in the token is not authority: the role comes from users/{uid}.
    r = await http.get(path, headers=auth(w.customer, role="admin"))
    assert r.status_code == 403

    # Projection
    r = await http.get(path, headers=auth(admin))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == bid and body["state"]["paymentStatus"] == "paid"
    text = r.text
    leaks = [
        needle
        for needle in (
            otps["pickup"],
            otps["delivery"],
            w.customer.phone,
            w.customer.phone[3:],
            "12 Market Road",
            "641001",
            "Meena Devi",
            "9876543210",
            "98765 43210",
            "otp",
            "receiver",
            "line1",
            "pincode",
        )
        if needle and needle.lower() in text.lower()
    ]
    assert not leaks, (leaks, text[:600])
    assert body["customer"]["phoneMasked"] and body["customer"]["phoneMasked"] != w.customer.phone

    # Malformed / unknown ids → 404 (no oracle).
    for bad in ("TAKI00000000", "taki1234", "TAKI1234567A"):
        r = await http.get(f"/api/v1/admin/bookings/{bad}", headers=auth(admin))
        assert r.status_code == 404, (bad, r.status_code)
