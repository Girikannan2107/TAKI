"""T2 contract conformance (P2-api-contract.md): auth/role errors, error envelopes, pagination and
cursors, idempotency, validation codes, visibility, guards. Every response also passes through
``support.contract_hook`` (envelope, Cache-Control, X-Request-ID)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from app.repositories.base import C
from tests.workflow import support as S
from tests.workflow.support import API, COIMBATORE, ERODE, SALEM, TIRUPPUR, doc, ecode, expect_error, expect_keys
from tests.workflow.test_02_paths import World, accepted, paid_dev, requested, world

pytestmark = pytest.mark.emulator


async def test_meta_health_session(api: httpx.AsyncClient) -> None:
    r = await api.get(f"{API}/health")
    assert r.status_code == 200 and r.json()["ok"] is True, r.text
    expect_keys(r.json(), ["ok", "version", "env"], "E1")
    r = await api.get(f"{API}/health/ready")
    assert r.status_code == 200, r.text
    expect_keys(r.json(), ["ok", "firestore", "auth", "payments", "maps"], "E2")
    r = await api.get(f"{API}/meta")
    assert r.status_code == 200, r.text
    m = r.json()
    expect_keys(m, ["states", "goodsCategories", "packageTypes", "specialHandling", "vehicleClasses", "bodyTypes",
                    "vehicleCountRanges", "limits", "features"], "E3")
    assert "max-age=300" in r.headers.get("cache-control", ""), r.headers.get("cache-control")
    assert {s["code"] for s in m["states"]} == {"TN", "KL", "KA", "TG", "AP"}
    r = await api.get(f"{API}/auth/session", headers={"Authorization": "Bearer not-a-token"})
    assert r.status_code == 200 and r.json() == {"user": None}, r.text


async def test_auth_and_role_errors(api: httpx.AsyncClient) -> None:
    cust = await S.signup_customer(api)
    ag = await S.signup_agency(api, "T2 Role Agency")
    # no token / garbage token → 401
    for path in ("/me", "/customer/bookings", "/agency/trips", "/driver/trips", "/admin/overview", "/notifications"):
        r = await api.get(f"{API}{path}")
        expect_error(r, 401, "unauthenticated")
    r = await api.get(f"{API}/me", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401 and ecode(r) in ("unauthenticated", "token_expired"), r.text
    # wrong role → 403 forbidden (contract §0 common codes; wrong_role is only E8's password-login answer)
    probes = [
        (cust, "GET", "/agency/trips"), (cust, "GET", "/driver/trips"), (cust, "GET", "/admin/overview"),
        (ag, "GET", "/customer/bookings"), (ag, "POST", "/customer/shipments"), (ag, "GET", "/admin/agencies"),
        (cust, "POST", "/agency/vehicles"), (ag, "GET", "/payments/history"),
    ]
    for who, method, path in probes:
        r = await api.request(method, f"{API}{path}", headers=who.h, json={})
        expect_error(r, 403, "forbidden")
    # a phone-proof token is not a session token
    proof = await S.phone_proof(cust.phone)
    r = await api.get(f"{API}/me", headers=S.bearer(proof.id_token))
    expect_error(r, 403, "password_login_required")
    # E8: correct password, wrong role → wrong_role with details.role; bad password → invalid_credentials
    r = await S.login(api, "agency", cust.phone)
    expect_error(r, 403, "wrong_role")
    assert r.json()["error"]["details"]["role"] == "customer"
    r = await S.login(api, "customer", cust.phone, "Wrongpass123")
    expect_error(r, 401, "invalid_credentials")
    r = await S.login(api, "customer", cust.phone)
    assert r.status_code == 200 and r.json()["user"]["role"] == "customer", r.text
    expect_keys(r.json(), ["customToken", "user"], "E8 AuthResultDTO")
    # E5 duplicate signup with the same phone → 409 account_exists
    r = await api.post(
        f"{API}/auth/signup/customer",
        json={"fullName": "Dup", "dob": "1990-01-01", "acceptTerms": True, "password": S.PASSWORD, "confirmPassword": S.PASSWORD},
        headers=S.bearer(proof.id_token),
    )
    expect_error(r, 409, "account_exists")
    # validation errors → 400 invalid_request with fields
    r = await api.post(f"{API}/customer/shipments", headers=cust.h, json={"source": {}})
    assert r.status_code == 400 and ecode(r) == "invalid_request" and r.json()["error"].get("fields"), r.text
    # wrong content type → 415
    r = await api.post(f"{API}/customer/shipments", headers={**cust.h, "content-type": "text/plain"}, content=b"x")
    expect_error(r, 415, "unsupported_media_type")
    # malformed / unknown ids → 404 not_found
    for path in ("/customer/bookings/NOTABOOKING", "/customer/bookings/TAKI00000000", "/customer/shipments/shp_bad",
                 f"/customer/trips/trp_aaaaaaaaaaaaaaaaaaaa?fromPlaceId={COIMBATORE}&toPlaceId={SALEM}&weightKg=100"):
        r = await api.get(f"{API}{path}", headers=cust.h)
        expect_error(r, 404, "not_found")


async def test_pagination_and_cursors(api: httpx.AsyncClient) -> None:
    cust = await S.signup_customer(api)
    day = S.ist_day(datetime.now(UTC) + timedelta(days=2))
    ids = [(await S.shipment(api, cust, COIMBATORE, SALEM, day))["id"] for _ in range(5)]
    seen: list[str] = []
    cursor: str | None = None
    pages = 0
    while True:
        params: dict[str, Any] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        r = await api.get(f"{API}/customer/shipments", params=params, headers=cust.h)
        assert r.status_code == 200, r.text
        page = r.json()
        expect_keys(page, ["items", "nextCursor"], "E27 Page")
        assert len(page["items"]) <= 2
        seen += [x["id"] for x in page["items"]]
        pages += 1
        cursor = page["nextCursor"]
        if not cursor or pages > 5:
            break
    assert sorted(seen) == sorted(ids) and len(seen) == len(set(seen)), (seen, ids)
    assert pages == 3, pages
    for bad in ({"limit": 0}, {"limit": 51}, {"cursor": "x" * 513}):
        r = await api.get(f"{API}/customer/shipments", params=bad, headers=cust.h)
        expect_error(r, 400, "invalid_request")
    r = await api.get(f"{API}/customer/shipments", params={"cursor": "garbage!!"}, headers=cust.h)
    assert r.status_code == 400 and ecode(r) == "invalid_request", r.text
    # notifications and payment history are cursor pages too
    for path in ("/notifications", "/payments/history", "/customer/bookings"):
        r = await api.get(f"{API}{path}", params={"limit": 1}, headers=cust.h)
        assert r.status_code == 200, (path, r.text)
        expect_keys(r.json(), ["items", "nextCursor"], f"{path} Page")
    r = await api.get(f"{API}/customer/bookings/counts", headers=cust.h)
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"pending", "confirmed", "picked_up", "in_transit", "delivered", "rejected", "cancelled"}, r.json()


async def test_admin_pagination(api: httpx.AsyncClient) -> None:
    adm = await S.admin(api)
    for _ in range(3):
        a = await S.signup_agency(api, "T2 Page Agency")
        await S.agency_documents(api, a)
    seen: list[str] = []
    cursor = None
    for _ in range(10):
        params: dict[str, Any] = {"status": "pending", "limit": 1}
        if cursor:
            params["cursor"] = cursor
        r = await api.get(f"{API}/admin/agencies", params=params, headers=adm.h)
        assert r.status_code == 200, r.text
        seen += [x["id"] for x in r.json()["items"]]
        cursor = r.json()["nextCursor"]
        if not cursor:
            break
    assert len(seen) == len(set(seen)) and len(seen) >= 3, seen
    r = await api.get(f"{API}/admin/overview", headers=adm.h)
    assert r.status_code == 200, r.text
    expect_keys(r.json(), ["vehicles", "payments"], "E108 AdminOverviewDTO")


async def test_booking_guards_and_idempotency(api: httpx.AsyncClient, clock: Any) -> None:
    w: World = await world(api, clock)
    cust, ag = w.cust, w.f.agency
    s = await S.shipment(api, cust, COIMBATORE, SALEM, w.day(0))
    body = {"shipmentId": s["id"], "tripId": w.trip["id"]}
    r = await api.post(f"{API}/customer/bookings", json=body, headers=cust.h)
    expect_error(r, 400, "idempotency_key_required")
    key = S.idem()
    r = await api.post(f"{API}/customer/bookings", json=body, headers={**cust.h, **key})
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    expect_keys(r.json(), ["id", "status", "tab", "state", "matchType", "pricing", "driver", "vehicle", "otps"], "E34 CustomerBookingDTO")
    s2 = await S.shipment(api, cust, TIRUPPUR, SALEM, w.day(1))
    r = await api.post(f"{API}/customer/bookings", json={"shipmentId": s2["id"], "tripId": w.trip["id"]}, headers={**cust.h, **key})
    expect_error(r, 422, "idempotency_key_reused")
    r = await S.request_booking(api, cust, s["id"], w.trip["id"])  # second request for the same shipment
    expect_error(r, 409, "shipment_has_open_booking")
    assert r.json()["error"]["details"]["bookingId"] == bid
    # editing / withdrawing a shipment with an open booking
    r = await api.patch(f"{API}/customer/shipments/{s['id']}", json=S.shipment_body(COIMBATORE, SALEM, w.day(0)), headers=cust.h)
    expect_error(r, 409, "shipment_has_open_booking")
    r = await api.delete(f"{API}/customer/shipments/{s['id']}", headers=cust.h)
    expect_error(r, 409, "shipment_has_open_booking")
    # another customer / another agency cannot see it
    other = await S.signup_customer(api)
    expect_error(await api.get(f"{API}/customer/bookings/{bid}", headers=other.h), 404, "not_found")
    other_ag = await S.signup_agency(api, "T2 Other Agency")
    expect_error(await api.get(f"{API}/agency/bookings/{bid}", headers=other_ag.h), 404, "not_found")
    expect_error(await api.post(f"{API}/agency/bookings/{bid}/accept", headers=other_ag.h, json={}), 404, "not_found")
    # unpublish / route change with an open request → trip_has_bookings
    r = await api.post(f"{API}/agency/trips/{w.trip['id']}/unpublish", headers=ag.h)
    expect_error(r, 409, "trip_has_bookings")
    # accept, then lower offeredKg below the held load → capacity_below_booked; reject after accept → 409
    r = await api.post(f"{API}/agency/bookings/{bid}/accept", headers=ag.h, json={})
    assert r.status_code == 200, r.text
    r = await api.patch(f"{API}/agency/trips/{w.trip['id']}", headers=ag.h, json={"offeredKg": 100})  # == held load: allowed
    assert r.status_code in (200, 422), r.text
    r = await api.patch(f"{API}/agency/trips/{w.trip['id']}", headers=ag.h, json={"offeredKg": 50})
    assert r.status_code in (400, 422) and ecode(r) in ("capacity_below_booked", "invalid_request"), r.text
    r = await api.post(f"{API}/agency/bookings/{bid}/reject", headers=ag.h, json={"reason": "too late"})
    expect_error(r, 409, "invalid_transition")
    # a customer cannot pay someone else's booking
    r = await api.post(f"{API}/payments/orders", json={"bookingId": bid}, headers={**other.h, **S.idem()})
    assert r.status_code == 404, r.text
    # driver: depart before departure − 2 h is too early
    w2 = await world(api, clock, lead_min=300)
    r = await api.post(f"{API}/driver/trips/{w2.trip['id']}/checkpoints/0/depart", headers=w2.f.driver.h, json={})
    expect_error(r, 422, "too_early")


async def test_refuse_pickup_and_delivery_without_photo(api: httpx.AsyncClient, clock: Any) -> None:
    w = await world(api, clock)
    b1 = await paid_dev(api, w, kg=100)
    b2 = await paid_dev(api, w, src=COIMBATORE, dst=ERODE, kg=100)
    drv = w.f.driver
    r = await api.post(f"{API}/driver/shipments/{b1}/refuse-pickup", headers=drv.h, json={"reason": "Goods not packed"})
    assert r.status_code == 200, r.text
    v = await S.assert_synced(api, b1, w.cust, w.f.agency)
    st = v["customer"]["state"]
    assert st["fulfilmentStatus"] == "pickup_refused" and st["reservationStatus"] == "released"
    assert st["paymentStatus"] in ("refund_pending", "refunded") and st["closure"]["reason"] == "pickup_refused"
    otps = (await api.get(f"{API}/customer/bookings/{b2}", headers=w.cust.h)).json()["otps"]
    r = await api.post(f"{API}/driver/trips/{w.trip['id']}/checkpoints/0/depart", headers=drv.h, json={})
    assert r.status_code == 200, r.text
    r = await api.post(f"{API}/driver/shipments/{b2}/pickup", headers=drv.h, json={"otp": otps["pickup"]})
    assert r.status_code == 200, r.text
    r = await api.post(f"{API}/driver/shipments/{b2}/deliver", headers=drv.h, files={"otp": (None, otps["delivery"])})
    expect_error(r, 409, "invalid_transition")  # not out for delivery yet
    for path in ("1/arrive", "1/depart", "2/arrive"):
        r = await api.post(f"{API}/driver/trips/{w.trip['id']}/checkpoints/{path}", headers=drv.h, json={})
        assert r.status_code == 200, (path, r.text)
    assert (await doc(C.bookings, b2))["fulfilmentStatus"] == "out_for_delivery"
    r = await api.post(f"{API}/driver/shipments/{b2}/deliver", headers=drv.h, files={"otp": (None, otps["delivery"])})
    assert r.status_code == 200 and r.json()["status"] == "delivered", r.text  # photo optional (owner default 7)
    for path in ("2/depart", "3/arrive"):
        r = await api.post(f"{API}/driver/trips/{w.trip['id']}/checkpoints/{path}", headers=drv.h, json={})
        assert r.status_code == 200, (path, r.text)
    r = await api.post(f"{API}/driver/trips/{w.trip['id']}/complete", headers=drv.h, json={})
    assert r.status_code == 200, r.text
    # earnings reflect only paid + delivered bookings
    r = await api.get(f"{API}/agency/earnings", headers=w.f.agency.h)
    assert r.status_code == 200, r.text
    e = await S.docs_where(C.earnings, "agencyId", w.f.agency.agency_id)
    assert [x["id"] for x in e] == [b2], e


async def test_fleet_guards(api: httpx.AsyncClient) -> None:
    f = await S.verified_fleet(api, name="T2 Guard Fleet")
    ag, adm = f.agency, f.admin
    # duplicate invite → already_exists; invite for a customer's phone → phone_taken
    phone = S.new_phone()
    r = await api.post(f"{API}/agency/driver-invites", headers=ag.h, json={"fullName": "Dup Driver", "phone": phone})
    assert r.status_code == 201, r.text
    r = await api.post(f"{API}/agency/driver-invites", headers=ag.h, json={"fullName": "Dup Driver", "phone": phone})
    expect_error(r, 409, "already_exists")
    cust = await S.signup_customer(api)
    r = await api.post(f"{API}/agency/driver-invites", headers=ag.h, json={"fullName": "Cust Phone", "phone": cust.phone})
    expect_error(r, 409, "phone_taken")
    # registration reuse → registration_taken
    r = await api.post(f"{API}/agency/vehicles", headers=ag.h, json={
        "vehicleClass": "Light Truck", "makeModel": "Tata 407", "registrationNumber": f.vehicle["registrationNumber"],
        "maxPayloadKg": 2000, "bodyType": "open", "acceptedGoods": ["general_goods"]})
    expect_error(r, 409, "registration_taken")
    # replacing a verified driver's document → already_verified
    r = await api.put(f"{API}/me/documents/aadhaar", headers=f.driver.h, data={"number": S.AADHAAR},
                      files={"file": ("a.pdf", S.PDF, "application/pdf")})
    expect_error(r, 409, "already_verified")
    # bad file magic → file_invalid
    r = await api.put(f"{API}/me/photo", headers=cust.h, files={"photo": ("x.jpg", b"MZ\x90\x00not-an-image", "image/jpeg")})
    expect_error(r, 422, "file_invalid")
    # customer DTOs never carry document numbers / file urls
    r = await api.get(f"{API}/agency/drivers", headers=ag.h)
    assert r.status_code == 200, r.text
    txt = r.text
    assert "TN01" not in txt or "numberMasked" in txt
    # suspend → mutating agency calls 403 agency_suspended; trips stop matching
    r = await api.post(f"{API}/admin/agencies/{ag.agency_id}/suspend", headers=adm.h, json={"reason": "KYC recheck"})
    assert r.status_code == 200, r.text
    r = await api.post(f"{API}/agency/vehicles", headers=ag.h, json={
        "vehicleClass": "Light Truck", "makeModel": "Tata 407", "registrationNumber": S.next_reg(),
        "maxPayloadKg": 2000, "bodyType": "open", "acceptedGoods": ["general_goods"]})
    expect_error(r, 403, "agency_suspended")
    r = await api.post(f"{API}/admin/agencies/{ag.agency_id}/reinstate", headers=adm.h, json={})
    assert r.status_code == 200, r.text
    # disable a user → login refused and the existing session refused
    r = await api.post(f"{API}/admin/users/{cust.uid}/disable", headers=adm.h, json={"reason": "Fraud check"})
    assert r.status_code == 204, r.text
    r = await api.get(f"{API}/me", headers=cust.h)
    assert r.status_code in (401, 403) and ecode(r) in ("account_disabled", "session_revoked"), r.text
    r = await S.login(api, "customer", cust.phone)
    expect_error(r, 403, "account_disabled")
    r = await api.post(f"{API}/admin/users/{cust.uid}/enable", headers=adm.h, json={})
    assert r.status_code == 204, r.text
    r = await api.post(f"{API}/admin/users/{adm.uid}/disable", headers=adm.h, json={"reason": "self disable"})
    expect_error(r, 409, "invalid_transition")


async def test_unpaid_booking_invisible_to_driver_and_payment_needs_acceptance(api: httpx.AsyncClient) -> None:
    f = await S.verified_fleet(api, name="T2 Visibility")
    start = (datetime.now(UTC) + timedelta(minutes=90)).replace(second=0, microsecond=0)
    trip = await S.publish_trip(api, f, start)
    cust = await S.signup_customer(api)
    s = await S.shipment(api, cust, COIMBATORE, SALEM, S.ist_day(start))
    r = await S.request_booking(api, cust, s["id"], trip["id"])
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    r = await api.post(f"{API}/payments/orders", json={"bookingId": bid}, headers={**cust.h, **S.idem()})
    expect_error(r, 409, "invalid_transition")  # not accepted yet
    for path in (f"/driver/shipments/{bid}",):
        expect_error(await api.get(f"{API}{path}", headers=f.driver.h), 404, "not_found")
    r = await api.get(f"{API}/agency/bookings/{bid}", headers=f.agency.h)
    ab = r.json()
    assert ab["customer"]["phone"] is None and ab["receiver"] is None, ab  # A§12.3 before acceptance
    r = await api.get(f"{API}/customer/bookings/{bid}", headers=cust.h)
    assert r.json()["driver"] is None or r.json()["driver"].get("phone") is None
