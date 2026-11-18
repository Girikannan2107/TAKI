"""Admin console (E108–E128): role gate, queues, verify/reject, users, bootstrap script."""

from __future__ import annotations

import httpx
import pytest
from google.cloud.firestore_v1.base_query import FieldFilter
from scripts.create_admin import BootstrapError, create_admin

from app.repositories.base import C, doc_ref
from tests.support.app import (
    PASSWORD,
    complete_agency_documents,
    complete_driver_documents,
    login,
    make_admin,
    next_phone,
    signup_agency,
    signup_customer,
    signup_driver,
)


async def test_admin_endpoints_need_admin_role(client: httpx.AsyncClient) -> None:
    customer = await signup_customer(client)
    agency = await signup_agency(client)
    for acct in (customer, agency):
        for path in ("/api/v1/admin/overview", "/api/v1/admin/agencies", "/api/v1/admin/drivers"):
            r = await client.get(path, headers=acct.headers)
            assert r.status_code == 403, path
            assert r.json()["error"]["code"] == "forbidden"
    assert (await client.get("/api/v1/admin/overview")).status_code == 401


async def test_agency_review_flow(client: httpx.AsyncClient) -> None:
    admin = await make_admin()
    incomplete = await signup_agency(client)
    ready = await signup_agency(client)
    await complete_agency_documents(client, ready)
    ready_id = ready.body["user"]["agency"]["id"]
    incomplete_id = incomplete.body["user"]["agency"]["id"]

    overview = (await client.get("/api/v1/admin/overview", headers=admin.headers)).json()
    assert overview["agencies"] == {"awaitingReview": 1, "awaitingDocuments": 1}
    assert overview["settlements"] == {"agencies": 0, "pendingAmount": 0}  # D3 earnings read model (no earnings yet)
    assert overview["payments"] == {"refundFailed": 0, "pendingOver1h": 0}

    pending = (await client.get("/api/v1/admin/agencies", headers=admin.headers)).json()
    assert [i["id"] for i in pending["items"]] == [ready_id]
    assert pending["items"][0]["documentsComplete"] is True
    waiting = (
        await client.get("/api/v1/admin/agencies", params={"status": "not_submitted"}, headers=admin.headers)
    ).json()
    assert [i["id"] for i in waiting["items"]] == [incomplete_id]

    detail = (await client.get(f"/api/v1/admin/agencies/{ready_id}", headers=admin.headers)).json()
    assert detail["documents"][0]["numberMasked"] == "XXXXXX234F"
    assert detail["phone"].startswith("+91 ")
    assert detail["duplicateDocumentFlags"] == []
    assert detail["documents"][0]["fileUrl"]

    r = await client.post(f"/api/v1/admin/agencies/{incomplete_id}/verify", headers=admin.headers)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "invalid_transition"
    assert r.json()["error"]["details"]["missing"] == ["identityDocument", "photo"]

    r = await client.post(f"/api/v1/admin/agencies/{ready_id}/verify", headers=admin.headers)
    assert r.status_code == 200, r.text
    assert r.json()["verification"]["status"] == "verified"
    assert r.json()["verification"]["reviewedBy"] == admin.uid
    me = (await client.get("/api/v1/me", headers=ready.headers)).json()
    assert me["agency"]["verification"] == "verified"

    r = await client.post(f"/api/v1/admin/agencies/{incomplete_id}/reject", headers=admin.headers, json={"reason": ""})
    assert r.status_code == 400
    assert r.json()["error"]["fields"] == {"reason": "Give a short reason (at least 3 characters)"}
    r = await client.post(
        f"/api/v1/admin/agencies/{incomplete_id}/reject",
        headers=admin.headers,
        json={"reason": "No documents uploaded"},
    )
    assert r.status_code == 200
    assert r.json()["verification"] == {
        **r.json()["verification"],
        "status": "rejected",
        "reason": "No documents uploaded",
    }

    # suspend / reinstate
    r = await client.post(
        f"/api/v1/admin/agencies/{incomplete_id}/suspend", headers=admin.headers, json={"reason": "Fraud"}
    )
    assert r.status_code == 409
    r = await client.post(
        f"/api/v1/admin/agencies/{ready_id}/suspend", headers=admin.headers, json={"reason": "Complaints"}
    )
    assert r.json()["verification"]["status"] == "suspended"
    r = await client.post(f"/api/v1/admin/agencies/{ready_id}/reinstate", headers=admin.headers)
    assert r.json()["verification"]["status"] == "verified"

    # agency notified
    from app.repositories.base import get_db, query_docs

    notes = await query_docs(get_db().collection(C.notifications).where(filter=FieldFilter("userId", "==", ready.uid)))
    assert {n["kind"] for n in notes} >= {"agency_verified", "agency_suspended"}
    audit = await query_docs(get_db().collection(C.audit_log).where(filter=FieldFilter("actorUid", "==", admin.uid)))
    assert {a["action"] for a in audit} >= {"agency.verify", "agency.reject", "agency.suspend", "agency.reinstate"}

    assert (
        await client.get("/api/v1/admin/agencies/agc_aaaaaaaaaaaaaaaaaaaa", headers=admin.headers)
    ).status_code == 404
    assert (await client.get("/api/v1/admin/agencies/not-an-id", headers=admin.headers)).status_code == 404


async def test_driver_review_flow(client: httpx.AsyncClient) -> None:
    admin = await make_admin()
    agency = await signup_agency(client)
    agency_id = agency.body["user"]["agency"]["id"]
    await doc_ref(C.agencies, agency_id).update({"verification.status": "verified"})
    driver = await signup_driver(client, agency_id)
    r = await client.post(f"/api/v1/admin/drivers/{driver.uid}/verify", headers=admin.headers)
    assert r.status_code == 409
    assert set(r.json()["error"]["details"]["missing"]) == {"license", "aadhaar", "photo"}

    await complete_driver_documents(client, driver, valid_until="2020-01-01")
    queue = (await client.get("/api/v1/admin/drivers", headers=admin.headers)).json()
    assert [i["id"] for i in queue["items"]] == [driver.uid]
    r = await client.post(f"/api/v1/admin/drivers/{driver.uid}/verify", headers=admin.headers)
    assert r.status_code == 409  # licence expired
    assert r.json()["error"]["message"] == "This driving licence has expired."

    r = await client.post(
        f"/api/v1/admin/drivers/{driver.uid}/reject", headers=admin.headers, json={"reason": "Licence expired"}
    )
    assert r.status_code == 200
    assert r.json()["verification"]["status"] == "rejected"
    # Re-upload with a valid licence → back in the queue → verify.
    await complete_driver_documents(client, driver, valid_until="2035-01-01")
    detail = (await client.get(f"/api/v1/admin/drivers/{driver.uid}", headers=admin.headers)).json()
    assert detail["verification"]["status"] == "pending"
    assert detail["licenseValidUntil"] == "2035-01-01"
    assert [d["numberMasked"] for d in detail["documents"]] == ["XXXXXXXXXXX1234", "XXXX XXXX 2346"]
    r = await client.post(f"/api/v1/admin/drivers/{driver.uid}/verify", headers=admin.headers)
    assert r.status_code == 200, r.text
    assert r.json()["verification"]["status"] == "verified"


async def test_disable_and_enable_user(client: httpx.AsyncClient) -> None:
    admin = await make_admin()
    customer = await signup_customer(client)
    r = await client.post(
        f"/api/v1/admin/users/{customer.uid}/disable", headers=admin.headers, json={"reason": "Abuse"}
    )
    assert r.status_code == 204
    r = await client.get("/api/v1/me", headers=customer.headers)
    assert r.status_code in (401, 403)
    r = await login(client, "customer", customer.phone)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "account_disabled"
    assert (await client.post(f"/api/v1/admin/users/{customer.uid}/enable", headers=admin.headers)).status_code == 204
    assert (await login(client, "customer", customer.phone)).status_code == 200
    # Not yourself, and never the last admin.
    r = await client.post(f"/api/v1/admin/users/{admin.uid}/disable", headers=admin.headers, json={"reason": "Oops"})
    assert r.status_code == 409


async def test_settlements_empty_and_unknown_agency(client: httpx.AsyncClient) -> None:
    # D3's earnings_service is wired: nothing pending on an empty database; full flow in tests/agency.
    admin = await make_admin()
    r = await client.get("/api/v1/admin/settlements", headers=admin.headers)
    assert r.json() == {"items": [], "available": True}
    assert (await client.get("/api/v1/admin/settlements/history", headers=admin.headers)).json() == {
        "items": [],
        "nextCursor": None,
    }
    r = await client.post(
        "/api/v1/admin/settlements",
        headers=admin.headers,
        json={"agencyId": "agc_aaaaaaaaaaaaaaaaaaaa", "through": "2026-11-01", "reference": "UTR1234"},
    )
    assert r.status_code == 404
    assert (await client.get("/api/v1/admin/payments", headers=admin.headers)).json() == {
        "items": [],
        "nextCursor": None,
    }


async def test_bootstrap_admin_refuses_second_admin_without_force(client: httpx.AsyncClient) -> None:
    phone = next_phone()
    uid = await create_admin(phone, "First Admin", PASSWORD)
    assert (await login(client, "admin", phone)).status_code == 200
    with pytest.raises(BootstrapError, match="already exists"):
        await create_admin(next_phone(), "Second Admin", PASSWORD)
    second = await create_admin(next_phone(), "Second Admin", PASSWORD, force=True)
    assert second != uid
    with pytest.raises(BootstrapError, match="Password"):
        await create_admin(next_phone(), "Weak", "short", force=True)
