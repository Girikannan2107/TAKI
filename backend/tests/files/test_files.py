"""File privacy (E21–E22): owner/admin access, signed URL checks."""

from __future__ import annotations

import time
from urllib.parse import parse_qs, urlparse

import httpx

from app.core.config import get_settings
from app.core.security import file_signature
from app.services.file_service import sniff_content_type, storage_path_for
from tests.support.app import AADHAAR, PDF_BYTES, jpeg_bytes, make_admin, signup_agency, signup_customer


def _path_and_query(url: str) -> tuple[str, dict[str, str]]:
    u = urlparse(url)
    return u.path, {k: v[0] for k, v in parse_qs(u.query).items()}


def test_sniffing_and_paths() -> None:
    assert sniff_content_type(b"\xff\xd8\xff\xe0rest") == "image/jpeg"
    assert sniff_content_type(b"\x89PNG\r\n\x1a\nxx") == "image/png"
    assert sniff_content_type(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"
    assert sniff_content_type(b"%PDF-1.7") == "application/pdf"
    assert sniff_content_type(b"<svg") is None
    assert (
        storage_path_for(kind="aadhaar", file_id="fil_x", ext="pdf", user_uid="u1")
        == "users/u1/identity/aadhaar/fil_x.pdf"
    )
    assert (
        storage_path_for(kind="rc", file_id="fil_x", ext="pdf", agency_id="agc_1", vehicle_id="veh_1")
        == "agencies/agc_1/vehicles/veh_1/rc/fil_x.pdf"
    )


async def _agency_with_document(client: httpx.AsyncClient):  # type: ignore[no-untyped-def]
    agency = await signup_agency(client)
    r = await client.put(
        "/api/v1/me/documents/aadhaar",
        headers=agency.headers,
        data={"number": AADHAAR},
        files={"file": ("a.pdf", PDF_BYTES, "application/pdf")},
    )
    assert r.status_code == 200, r.text
    return agency, r.json()["document"]["fileUrl"]


async def test_owner_can_read_others_cannot(client: httpx.AsyncClient) -> None:
    agency, url = await _agency_with_document(client)
    path, q = _path_and_query(url)
    file_id = path.split("/")[4]

    r = await client.get(path, params=q)
    assert r.status_code == 200
    assert r.content == PDF_BYTES
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["cache-control"] == "private, max-age=300"
    assert r.headers["content-security-policy"] == "default-src 'none'"
    assert r.headers["content-disposition"] == "inline"

    meta = await client.get(f"/api/v1/files/{file_id}", headers=agency.headers)
    assert meta.status_code == 200
    assert meta.json()["kind"] == "aadhaar"
    assert meta.json()["contentType"] == "application/pdf"

    # Another user: the file is invisible (404, no existence leak).
    stranger = await signup_customer(client)
    r = await client.get(f"/api/v1/files/{file_id}", headers=stranger.headers)
    assert r.status_code == 404
    # A signed URL is bound to its viewer: swapping the viewer breaks the signature.
    r = await client.get(path, params={**q, "v": stranger.uid})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"

    # Admins can read everything.
    admin = await make_admin()
    assert (await client.get(f"/api/v1/files/{file_id}", headers=admin.headers)).status_code == 200


async def test_invalid_and_expired_signatures(client: httpx.AsyncClient) -> None:
    agency, url = await _agency_with_document(client)
    path, q = _path_and_query(url)
    file_id = path.split("/")[4]
    r = await client.get(path, params={**q, "sig": q["sig"][:-2] + "AA"})
    assert r.status_code == 403
    r = await client.get(path, params={**q, "exp": str(int(q["exp"]) + 10)})
    assert r.status_code == 403
    # Correctly signed but expired.
    exp = int(time.time()) - 5
    sig = file_signature(get_settings().file_url_secret, file_id, agency.uid, exp)
    r = await client.get(path, params={"exp": exp, "v": agency.uid, "sig": sig})
    assert r.status_code == 403
    # Missing parameters → 400 (validation).
    assert (await client.get(path)).status_code == 400


async def test_replaced_photo_is_no_longer_served(client: httpx.AsyncClient) -> None:
    customer = await signup_customer(client)
    first = await client.put(
        "/api/v1/me/photo", headers=customer.headers, files={"photo": ("a.jpg", jpeg_bytes(), "image/jpeg")}
    )
    old_path, old_q = _path_and_query(first.json()["photoUrl"])
    assert (await client.get(old_path, params=old_q)).status_code == 200
    second = await client.put(
        "/api/v1/me/photo", headers=customer.headers, files={"photo": ("b.jpg", jpeg_bytes(), "image/jpeg")}
    )
    assert second.status_code == 200
    assert (await client.get(old_path, params=old_q)).status_code == 404
    new_path, new_q = _path_and_query(second.json()["photoUrl"])
    r = await client.get(new_path, params=new_q)
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
