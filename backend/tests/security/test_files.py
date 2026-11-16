"""T3 · Files (P2 §12.2): signed-URL privacy, masked document numbers in every DTO, upload sniffing.

Uploads go through the real API to the Storage emulator; the content endpoint is called with the
signed URLs the API hands out (and tampered variants of them).
"""

from __future__ import annotations

import io
import json
import time
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import pytest
from PIL import Image

from app.core.config import get_settings
from app.core.security import file_signature
from app.repositories.base import C, doc_ref
from tests.security.conftest import auth, err
from tests.support.builders import Account, make_agency, make_customer, make_driver

pytestmark = pytest.mark.emulator

PAN = "ABCDE1234F"
AADHAAR = "234123412346"
DL = "TN0120190001234"
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def jpeg(exif_gps: bool = False) -> bytes:
    out = io.BytesIO()
    img = Image.new("RGB", (16, 16), (200, 30, 30))
    if exif_gps:
        exif = Image.Exif()
        exif[0x010F] = "T3Camera"  # Make
        exif[0x8825] = {1: "N", 2: (11.0, 1.0, 0.0), 3: "E", 4: (76.0, 57.0, 0.0)}  # GPS IFD
        img.save(out, format="JPEG", exif=exif)
    else:
        img.save(out, format="JPEG")
    return out.getvalue()


async def _admin() -> Account:
    now = datetime.now(UTC)
    uid = "t3fadm" + now.strftime("%H%M%S%f")
    await doc_ref(C.users, uid).set(
        {
            "id": uid,
            "role": "admin",
            "phone": "+917003099998",
            "displayName": "T3 Admin",
            "status": "active",
            "agencyId": None,
            "sessionsValidAfter": now - timedelta(days=1),
            "createdAt": now,
            "updatedAt": now,
        }
    )
    return Account(uid=uid, role="admin", phone="+917003099998", name="T3 Admin")


def rel(url: str) -> str:
    u = urlsplit(url)
    return f"{u.path}?{u.query}"


def with_query(url: str, **over: str) -> str:
    u = urlsplit(url)
    q = {k: v[0] for k, v in parse_qs(u.query).items()}
    q.update(over)
    return f"{u.path}?{urlencode(q)}"


def file_id_of(url: str) -> str:
    return urlsplit(url).path.split("/")[-2]


async def upload(http: httpx.AsyncClient, who: Account, kind: str, number: str, **form: str) -> httpx.Response:
    return await http.put(
        f"/api/v1/me/documents/{kind}",
        headers=auth(who),
        data={"number": number, **form},
        files={"file": ("doc.pdf", PDF, "application/pdf")},
    )


async def test_document_numbers_are_masked_in_every_dto(http: httpx.AsyncClient) -> None:
    agency = await make_agency(verification="not_submitted")
    driver = await make_driver(agency, verification="not_submitted", link="active")
    admin = await _admin()
    r = await upload(http, agency, "pan", PAN)
    assert r.status_code == 200, r.text
    assert r.json()["document"]["numberMasked"] == "XXXXXX234F"
    for kind, number, form in (("driving_license", DL, {"validUntil": "2035-01-01"}), ("aadhaar", AADHAAR, {})):
        r = await upload(http, driver, kind, number, **form)
        assert r.status_code == 200, r.text
    assert r.json()["document"]["numberMasked"] == "XXXX XXXX 2346"

    reads = [
        (agency, "/api/v1/me/profile"),
        (agency, "/api/v1/agency/profile"),
        (agency, "/api/v1/agency/verification"),
        (agency, "/api/v1/agency/drivers"),
        (agency, f"/api/v1/agency/drivers/{driver.uid}"),
        (driver, "/api/v1/me/profile"),
        (driver, "/api/v1/driver/profile"),
        (admin, "/api/v1/admin/agencies"),
        (admin, f"/api/v1/admin/agencies/{agency.agency_id}"),
        (admin, "/api/v1/admin/drivers"),
        (admin, f"/api/v1/admin/drivers/{driver.uid}"),
    ]
    leaks, seen_masked = [], 0
    for who, path in reads:
        r = await http.get(path, headers=auth(who))
        assert r.status_code == 200, (path, r.text)
        text = r.text
        for full in (PAN, AADHAAR, DL, "2341 2341 2346", "numberHmac"):
            if full in text:
                leaks.append(f"{path} ({who.role}) contains {full}")
        seen_masked += text.count("XXXX XXXX 2346") + text.count("XXXXXX234F")
    assert not leaks, "\n".join(leaks)
    assert seen_masked >= 6
    # Customers never see identity documents.
    cust = await make_customer()
    for f in await _identity_file_ids(driver):
        r = await http.get(f"/api/v1/files/{f}", headers=auth(cust))
        assert r.status_code in (403, 404), r.text


async def _identity_file_ids(driver: Account) -> list[str]:
    snap = await doc_ref(C.drivers, driver.uid).get()
    d = snap.to_dict() or {}
    return [d[k]["file"]["fileId"] for k in ("license", "aadhaar") if d.get(k)]


async def test_signed_url_privacy(http: httpx.AsyncClient) -> None:
    agency = await make_agency(verification="not_submitted")
    driver = await make_driver(agency, verification="not_submitted", link="active")
    other_agency = await make_agency(verification="not_submitted")
    cust = await make_customer()
    admin = await _admin()
    r = await upload(http, driver, "aadhaar", AADHAAR)
    assert r.status_code == 200, r.text
    url = r.json()["document"]["fileUrl"]
    fid = file_id_of(url)

    r = await http.get(rel(url))
    assert r.status_code == 200 and r.content.startswith(b"%PDF-")
    for h, v in {
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
    }.items():
        assert r.headers.get(h) == v, (h, r.headers.get(h))

    q = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
    sig = q["sig"]
    bad = {
        "tampered_sig": with_query(url, sig=("A" if sig[0] != "A" else "B") + sig[1:]),
        "no_sig": with_query(url, sig=""),
        "wrong_viewer": with_query(url, v=cust.uid),
        "longer_exp": with_query(url, exp=str(int(q["exp"]) + 60)),
        "other_file": rel(url).replace(fid, "fil_" + "b" * 20),
    }
    for name, path in bad.items():
        r = await http.get(path)
        assert r.status_code in (403, 404, 422), (name, r.status_code, r.text)
        assert r.status_code != 200, name

    # Validly signed but expired, and validly signed beyond the TTL.
    secret = get_settings().file_url_secret
    now = int(time.time())
    for exp in (now - 5, now + 3 * 3600):
        path = with_query(url, exp=str(exp), sig=file_signature(secret, fid, driver.uid, exp))
        r = await http.get(path)
        assert (r.status_code, err(r)) == (403, "forbidden"), exp

    # Re-authorisation through GET /files/{id}: owner, linked agency and admin only.
    for who, ok in ((driver, True), (agency, True), (admin, True), (other_agency, False), (cust, False)):
        r = await http.get(f"/api/v1/files/{fid}", headers=auth(who))
        assert (r.status_code == 200) is ok, (who.role, r.status_code, r.text)
        if ok:
            assert f"v={who.uid}" in r.json()["url"]

    # A replaced document's old link stops working.
    r = await upload(http, driver, "aadhaar", AADHAAR)
    assert r.status_code == 200
    r = await http.get(rel(url))
    assert r.status_code == 404, r.status_code


@pytest.mark.parametrize(
    ("name", "payload", "kind", "expect"),
    [
        ("html_as_pdf", b"<html><script>alert(1)</script></html>", "pan", (422, "file_invalid")),
        ("exe", b"MZ\x90\x00" + b"\x00" * 64, "pan", (422, "file_invalid")),
        ("svg", b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "pan", (422, "file_invalid")),
        ("empty", b"", "pan", (400, "invalid_request")),
        ("too_large", b"%PDF-" + b"0" * (5 * 1024 * 1024), "pan", (413, "file_too_large")),
    ],
)
async def test_document_upload_sniffing(
    http: httpx.AsyncClient, name: str, payload: bytes, kind: str, expect: tuple[int, str]
) -> None:
    agency = await make_agency(verification="not_submitted")
    r = await http.put(
        f"/api/v1/me/documents/{kind}",
        headers=auth(agency),
        data={"number": PAN},
        files={"file": ("doc.pdf", payload, "application/pdf")},
    )
    assert (r.status_code, err(r)) == expect, (name, r.text)


async def test_photo_rejects_pdf_and_strips_exif(http: httpx.AsyncClient) -> None:
    cust = await make_customer()
    r = await http.put("/api/v1/me/photo", headers=auth(cust), files={"photo": ("p.jpg", PDF, "image/jpeg")})
    assert (r.status_code, err(r)) == (422, "file_invalid")
    r = await http.put(
        "/api/v1/me/photo", headers=auth(cust), files={"photo": ("p.jpg", jpeg(exif_gps=True), "image/jpeg")}
    )
    assert r.status_code == 200, r.text
    content = (await http.get(rel(r.json()["photoUrl"]))).content
    img = Image.open(io.BytesIO(content))
    exif = img.getexif()
    assert 0x8825 not in exif and b"T3Camera" not in content, json.dumps({str(k): str(v) for k, v in exif.items()})


async def test_invalid_document_number_rejected(http: httpx.AsyncClient) -> None:
    driver = await make_driver(None, verification="not_submitted", link=None)
    r = await upload(http, driver, "aadhaar", "123412341234")  # fails Verhoeff
    assert (r.status_code, err(r)) == (422, "invalid_document_number")
