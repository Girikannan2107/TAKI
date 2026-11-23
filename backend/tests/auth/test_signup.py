"""Signup (E4–E7) and phone-proof token scope."""

from __future__ import annotations

from datetime import UTC, datetime

import httpx

from app.core.constants import UNDERAGE_MESSAGE
from app.core.time import ist_today
from app.services.auth_service import is_adult, max_dob
from tests.support.app import (
    MUMBAI,
    PASSWORD,
    next_phone,
    signup_agency,
    signup_customer,
    signup_driver,
)
from tests.support.tokens import bearer, phone_proof, session_token


def test_age_rule_uses_ist_calendar() -> None:
    # 2026-11-14T19:00Z is already 2026-11-15 in IST.
    now = datetime(2026, 11, 14, 19, 0, tzinfo=UTC)
    today = ist_today(now)
    assert today.isoformat() == "2026-11-15"
    assert max_dob(today).isoformat() == "2008-11-15"
    assert is_adult("2008-11-15", today)
    assert not is_adult("2008-11-16", today)
    # Feb 29 → Feb 28 in non-leap target years
    assert max_dob(datetime(2028, 2, 29).date()).isoformat() == "2010-02-28"


async def test_customer_signup_creates_account_and_session(client: httpx.AsyncClient) -> None:
    acct = await signup_customer(client)
    assert acct.body["user"]["role"] == "customer"
    assert acct.body["user"]["name"] == "Ravi Kumar"
    assert acct.body["user"]["phoneMasked"].endswith(acct.phone[-4:])
    assert acct.body["user"]["claimsVersion"] == 1
    me = await client.get("/api/v1/me", headers=acct.headers)
    assert me.status_code == 200, me.text
    assert me.json()["id"] == acct.uid
    session = await client.get("/api/v1/auth/session", headers=acct.headers)
    assert session.json()["user"]["id"] == acct.uid
    assert (await client.get("/api/v1/auth/session")).json() == {"user": None}

    status = await client.post("/api/v1/auth/phone/status", headers=bearer((await phone_proof(acct.phone)).id_token))
    assert status.status_code == 200
    assert status.json()["registered"] is True
    assert status.json()["role"] == "customer"


async def test_signup_twice_is_account_exists(client: httpx.AsyncClient) -> None:
    phone = next_phone()
    await signup_customer(client, phone)
    proof = await phone_proof(phone)
    r = await client.post(
        "/api/v1/auth/signup/customer",
        headers=bearer(proof.id_token),
        json={
            "fullName": "Again",
            "dob": "1990-01-01",
            "acceptTerms": True,
            "password": PASSWORD,
            "confirmPassword": PASSWORD,
        },
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "account_exists"


async def test_customer_signup_validation(client: httpx.AsyncClient) -> None:
    proof = await phone_proof(next_phone())
    r = await client.post(
        "/api/v1/auth/signup/customer",
        headers=bearer(proof.id_token),
        json={
            "fullName": " A ",
            "dob": "17-05-1990",
            "acceptTerms": False,
            "password": "short",
            "confirmPassword": "x",
        },
    )
    assert r.status_code == 400
    fields = r.json()["error"]["fields"]
    assert fields["fullName"] == "Enter your full name"
    assert fields["dob"] == "Enter your date of birth"
    assert fields["acceptTerms"] == "Accept the Terms to continue"
    assert fields["password"] == "Use at least 8 characters"

    r = await client.post(
        "/api/v1/auth/signup/customer",
        headers=bearer(proof.id_token),
        json={
            "fullName": "Ravi",
            "dob": "1990-01-01",
            "acceptTerms": True,
            "password": "Secret2026",
            "confirmPassword": "Other2026",
        },
    )
    assert r.json()["error"]["fields"] == {"confirmPassword": "Passwords don't match"}

    # The phone number itself is not a valid password.
    digits = proof.phone[-10:]
    r = await client.post(
        "/api/v1/auth/signup/customer",
        headers=bearer(proof.id_token),
        json={
            "fullName": "Ravi",
            "dob": "1990-01-01",
            "acceptTerms": True,
            "password": digits,
            "confirmPassword": digits,
        },
    )
    assert r.status_code == 400  # "Include a letter" from the schema


async def test_under_18_is_rejected(client: httpx.AsyncClient) -> None:
    proof = await phone_proof(next_phone())
    dob = max_dob(ist_today(datetime.now(UTC))).replace(day=1)
    year_younger = dob.replace(year=dob.year + 1).isoformat()
    r = await client.post(
        "/api/v1/auth/signup/customer",
        headers=bearer(proof.id_token),
        json={
            "fullName": "Young One",
            "dob": year_younger,
            "acceptTerms": True,
            "password": PASSWORD,
            "confirmPassword": PASSWORD,
        },
    )
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "underage"
    assert err["fields"] == {"dob": UNDERAGE_MESSAGE}


async def test_signup_requires_phone_proof(client: httpx.AsyncClient) -> None:
    body = {
        "fullName": "Ravi",
        "dob": "1990-01-01",
        "acceptTerms": True,
        "password": PASSWORD,
        "confirmPassword": PASSWORD,
    }
    r = await client.post("/api/v1/auth/signup/customer", json=body)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "phone_proof_required"
    # A normal session token is not a phone proof.
    acct = await signup_customer(client)
    r = await client.post("/api/v1/auth/signup/customer", json=body, headers=acct.headers)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "phone_proof_required"


async def test_phone_proof_token_refused_on_normal_endpoints(client: httpx.AsyncClient) -> None:
    acct = await signup_customer(client)
    proof = await phone_proof(acct.phone)
    for method, path in (("GET", "/api/v1/me"), ("GET", "/api/v1/me/profile"), ("POST", "/api/v1/auth/logout")):
        r = await client.request(method, path, headers=bearer(proof.id_token))
        assert r.status_code == 403, path
        assert r.json()["error"]["code"] == "password_login_required"
    # GET /auth/session never errors, it just has no user.
    assert (await client.get("/api/v1/auth/session", headers=bearer(proof.id_token))).json() == {"user": None}


async def test_session_token_without_account_is_unauthenticated(client: httpx.AsyncClient) -> None:
    token = await session_token("ghostUser123")
    r = await client.get("/api/v1/me", headers=bearer(token))
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"


async def test_agency_signup(client: httpx.AsyncClient) -> None:
    acct = await signup_agency(client)
    user = acct.body["user"]
    assert user["role"] == "agency"
    assert user["agency"]["verification"] == "not_submitted"
    profile = (await client.get("/api/v1/me/profile", headers=acct.headers)).json()
    assert profile["districtName"] == "Coimbatore"
    assert profile["state"] == "TN"
    assert profile["statesCovered"] == ["TN", "KL"]  # home state is always covered
    assert profile["base"]["placeId"]

    proof = await phone_proof(next_phone())
    r = await client.post(
        "/api/v1/auth/signup/agency",
        headers=bearer(proof.id_token),
        json={
            "ownerName": "Owner",
            "agencyName": "Far Away",
            "base": {"placeId": MUMBAI},
            "vehicleCountRange": "1-5",
            "statesCovered": ["TN"],
            "acceptTerms": True,
            "password": PASSWORD,
            "confirmPassword": PASSWORD,
        },
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "outside_service_area"
    r = await client.post(
        "/api/v1/auth/signup/agency",
        headers=bearer(proof.id_token),
        json={
            "ownerName": "Owner",
            "agencyName": "Nowhere",
            "base": {"placeId": "ChIJunknownplace000"},
            "vehicleCountRange": "1-5",
            "statesCovered": ["TN"],
            "acceptTerms": True,
            "password": PASSWORD,
            "confirmPassword": PASSWORD,
        },
    )
    assert r.json()["error"]["code"] == "address_not_found"


async def test_driver_signup_needs_a_verified_agency(client: httpx.AsyncClient) -> None:
    agency = await signup_agency(client)
    agency_id = agency.body["user"]["agency"]["id"]
    proof = await phone_proof(next_phone())
    body = {
        "fullName": "Selvam",
        "agencyId": agency_id,
        "acceptTerms": True,
        "password": PASSWORD,
        "confirmPassword": PASSWORD,
    }
    r = await client.post("/api/v1/auth/signup/driver", headers=bearer(proof.id_token), json=body)
    assert r.status_code == 404
    assert r.json()["error"]["fields"] == {"agencyId": "Choose a verified agency from the list"}

    r = await client.post("/api/v1/auth/signup/driver", headers=bearer(proof.id_token), json={**body, "agencyId": None})
    assert r.status_code == 400
    assert r.json()["error"]["fields"] == {"agencyId": "Choose your agency"}

    # verify the agency directly in Firestore (admin flow is covered in tests/admin)
    from app.repositories.base import C, doc_ref

    await doc_ref(C.agencies, agency_id).update({"verification.status": "verified"})
    driver = await signup_driver(client, agency_id)
    link = driver.body["user"]["driver"]["agencyLink"]
    assert link == {"agencyId": agency_id, "agencyName": "Arun Transports", "status": "pending"}
    public = (await client.get("/api/v1/public/agencies", params={"q": "arun"})).json()
    assert [a["id"] for a in public["items"]] == [agency_id]
