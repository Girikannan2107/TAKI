"""Profile (E12–E18): read/edit, documents (masked numbers), photo, phone change."""

from __future__ import annotations

import asyncio
import json

import httpx

from app.repositories.base import C, get_doc
from tests.support.app import (
    AADHAAR,
    COIMBATORE,
    PASSWORD,
    PDF_BYTES,
    complete_agency_documents,
    jpeg_bytes,
    next_phone,
    signup_agency,
    signup_customer,
    signup_driver,
)
from tests.support.tokens import bearer, exchange_custom_token, phone_proof


async def test_customer_profile_read_and_edit(client: httpx.AsyncClient) -> None:
    acct = await signup_customer(client)
    p = (await client.get("/api/v1/me/profile", headers=acct.headers)).json()
    assert p["role"] == "customer"
    assert p["fullName"] == "Ravi Kumar"
    assert p["dob"] == "1990-05-17"
    assert p["phone"] == acct.phone
    assert p["createdAt"].endswith("Z")

    r = await client.patch("/api/v1/me/profile", headers=acct.headers, json={"fullName": "  Ravi   K  "})
    assert r.status_code == 200, r.text
    assert r.json()["fullName"] == "Ravi K"
    assert (await client.get("/api/v1/me", headers=acct.headers)).json()["name"] == "Ravi K"

    # A body for another role is refused.
    r = await client.patch(
        "/api/v1/me/profile",
        headers=acct.headers,
        json={
            "ownerName": "X Y",
            "agencyName": "Z",
            "base": {"placeId": COIMBATORE},
            "statesCovered": ["TN"],
            "vehicleCountRange": "1-5",
        },
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_request"


async def test_agency_documents_are_masked_and_queue_review(client: httpx.AsyncClient) -> None:
    agency = await signup_agency(client)
    r = await client.put(
        "/api/v1/me/documents/aadhaar",
        headers=agency.headers,
        data={"number": "1234 5678 9012"},
        files={"file": ("a.pdf", PDF_BYTES, "application/pdf")},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_document_number"

    r = await client.put(
        "/api/v1/me/documents/aadhaar",
        headers=agency.headers,
        data={"number": AADHAAR},
        files={"file": ("a.pdf", PDF_BYTES, "application/pdf")},
    )
    assert r.status_code == 200, r.text
    doc = r.json()["document"]
    assert doc["numberMasked"] == f"XXXX XXXX {AADHAAR[-4:]}"
    assert "/api/v1/files/fil_" in doc["fileUrl"]
    assert r.json()["verification"] == "not_submitted"  # photo still missing

    agency_id = agency.body["user"]["agency"]["id"]
    raw = json.dumps(await get_doc(C.agencies, agency_id), default=str)
    assert AADHAAR not in raw

    r = await client.put(
        "/api/v1/me/photo", headers=agency.headers, files={"photo": ("p.jpg", jpeg_bytes(), "image/jpeg")}
    )
    assert r.status_code == 200, r.text
    assert r.json()["photoUrl"].startswith("http://localhost:8000/api/v1/files/")
    profile = (await client.get("/api/v1/me/profile", headers=agency.headers)).json()
    assert profile["verification"]["status"] == "pending"
    assert profile["verification"]["submittedAt"]
    assert profile["documents"][0]["status"] == "pending"
    body = json.dumps(profile)
    assert AADHAAR not in body


async def test_upload_rules(client: httpx.AsyncClient) -> None:
    agency = await signup_agency(client)
    # Disguised file: wrong magic bytes.
    r = await client.put(
        "/api/v1/me/photo", headers=agency.headers, files={"photo": ("x.jpg", b"<svg/>", "image/jpeg")}
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "file_invalid"
    # PDF is not a photo.
    r = await client.put(
        "/api/v1/me/photo", headers=agency.headers, files={"photo": ("x.jpg", PDF_BYTES, "image/jpeg")}
    )
    assert r.status_code == 422
    # Too large (> 5 MB) but under the 20 MB request limit.
    big = b"\xff\xd8\xff" + b"0" * (5 * 1024 * 1024 + 1)
    r = await client.put("/api/v1/me/photo", headers=agency.headers, files={"photo": ("x.jpg", big, "image/jpeg")})
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "file_too_large"
    # Customers have no identity documents.
    customer = await signup_customer(client)
    r = await client.put(
        "/api/v1/me/documents/pan",
        headers=customer.headers,
        data={"number": "ABCDE1234F"},
        files={"file": ("p.pdf", PDF_BYTES, "application/pdf")},
    )
    assert r.status_code == 403


async def test_driver_needs_licence_aadhaar_photo_and_no_pan(client: httpx.AsyncClient) -> None:
    agency = await signup_agency(client)
    from app.repositories.base import doc_ref

    agency_id = agency.body["user"]["agency"]["id"]
    await doc_ref(C.agencies, agency_id).update({"verification.status": "verified"})
    driver = await signup_driver(client, agency_id)
    r = await client.put(
        "/api/v1/me/documents/pan",
        headers=driver.headers,
        data={"number": "ABCDE1234F"},
        files={"file": ("p.pdf", PDF_BYTES, "application/pdf")},
    )
    assert r.status_code == 403
    r = await client.put(
        "/api/v1/me/documents/driving_license",
        headers=driver.headers,
        data={"number": "TN01 2019 0001234", "validUntil": "2035-01-01"},
        files={"file": ("dl.pdf", PDF_BYTES, "application/pdf")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["document"]["numberMasked"] == "XXXXXXXXXXX1234"
    assert r.json()["document"]["validUntil"] == "2035-01-01"
    profile = (await client.get("/api/v1/me/profile", headers=driver.headers)).json()
    assert [d["status"] for d in profile["documents"]] == ["pending", "missing"]
    assert profile["verification"]["status"] == "not_submitted"


async def test_agency_profile_patch(client: httpx.AsyncClient) -> None:
    agency = await signup_agency(client)
    await complete_agency_documents(client, agency)
    r = await client.patch(
        "/api/v1/me/profile",
        headers=agency.headers,
        json={
            "ownerName": "New Owner",
            "agencyName": "Arun Cargo",
            "base": {"placeId": COIMBATORE},
            "statesCovered": ["KA", "KA"],
            "vehicleCountRange": "6-10",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["agencyName"] == "Arun Cargo"
    assert r.json()["statesCovered"] == ["TN", "KA"]


async def test_change_phone(client: httpx.AsyncClient) -> None:
    acct = await signup_customer(client)
    other = await signup_customer(client)
    await asyncio.sleep(1.1)

    taken = await phone_proof(other.phone)
    r = await client.post(
        "/api/v1/me/phone",
        headers={**acct.headers, "X-Phone-Proof": taken.id_token},
        json={"currentPassword": PASSWORD},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "phone_taken"

    r = await client.post("/api/v1/me/phone", headers=acct.headers, json={"currentPassword": PASSWORD})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "phone_proof_required"

    new_phone = next_phone()
    proof = await phone_proof(new_phone)
    r = await client.post(
        "/api/v1/me/phone",
        headers={**acct.headers, "X-Phone-Proof": proof.id_token},
        json={"currentPassword": "Nope12345"},
    )
    assert r.status_code == 401
    r = await client.post(
        "/api/v1/me/phone",
        headers={**acct.headers, "X-Phone-Proof": proof.id_token},
        json={"currentPassword": PASSWORD},
    )
    assert r.status_code == 200, r.text
    token = await exchange_custom_token(r.json()["customToken"])
    profile = (await client.get("/api/v1/me/profile", headers=bearer(token))).json()
    assert profile["phone"] == new_phone
    assert (await get_doc(C.phone_index, acct.phone)) is None
    assert (await get_doc(C.phone_index, new_phone))["uid"] == acct.uid  # type: ignore[index]
    assert (await client.get("/api/v1/me", headers=acct.headers)).json()["error"]["code"] == "session_revoked"
    login = await client.post("/api/v1/auth/login", json={"role": "customer", "phone": new_phone, "password": PASSWORD})
    assert login.status_code == 200
