"""T3 · Firebase rules against the running emulators (P2 §12.1, §12.2), as a browser would call them.

* Firestore (``firebase/firestore.rules``): every client read/list/write is denied, for anonymous,
  signed-in, phone-proof and admin-claim tokens, on ``(default)`` and on a named database.
* Storage (``firebase/storage.rules``): no client writes anywhere; reads only by the owner of
  ``users/{uid}/**`` and by admins (custom claim ``role == "admin"``).

The REST calls carry emulator (unsigned) ID tokens; the emulators evaluate the rules for them.
"""

from __future__ import annotations

from urllib.parse import quote

import httpx
import pytest

from app.repositories.base import C, doc_ref
from tests.security.conftest import PROJECT, auth, forge_token
from tests.support.builders import make_agency, make_customer, make_driver
from tests.support.emulator import FIRESTORE_URL, STORAGE_HOST

pytestmark = pytest.mark.emulator
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
BUCKET = f"{PROJECT}.appspot.com"
STORAGE = f"http://{STORAGE_HOST}/v0/b/{BUCKET}/o"


def _hdr(token: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


async def test_firestore_denies_every_client_operation(http: httpx.AsyncClient) -> None:
    cust = await make_customer()
    tokens = {
        "anonymous": None,
        "owner": forge_token(cust.uid),
        "owner_phone_proof": forge_token(cust.uid, provider="phone", phone=cust.phone),
        "admin_claim": forge_token(cust.uid, role="admin"),
    }
    failures = []
    async with httpx.AsyncClient(timeout=10) as c:
        for db in ("(default)", "t3-security"):
            root = f"{FIRESTORE_URL}/v1/projects/{PROJECT}/databases/{db}/documents"
            ops = [
                ("GET", f"{root}/users/{cust.uid}", None),
                ("GET", f"{root}/customers/{cust.uid}", None),
                ("GET", f"{root}/users", None),
                ("GET", f"{root}/bookings", None),
                ("GET", f"{root}/credentials/{cust.uid}", None),
                ("PATCH", f"{root}/users/{cust.uid}?updateMask.fieldPaths=role",
                 {"fields": {"role": {"stringValue": "admin"}}}),
                ("POST", f"{root}/t3RulesProbe", {"fields": {"x": {"stringValue": "y"}}}),
                ("DELETE", f"{root}/users/{cust.uid}", None),
                ("POST", f"{root}:runQuery", {"structuredQuery": {"from": [{"collectionId": "payments"}]}}),
            ]
            for name, tok in tokens.items():
                for method, url, body in ops:
                    r = await c.request(method, url, json=body, headers=_hdr(tok))
                    if r.status_code != 403:
                        failures.append(f"{db} {name}: {method} {url.split('/documents')[-1]} -> {r.status_code}")
    assert not failures, "\n".join(failures)
    snap = await doc_ref(C.users, cust.uid).get()
    assert snap.to_dict()["role"] == "customer"  # type: ignore[index]


async def _driver_aadhaar_path(http: httpx.AsyncClient) -> tuple[str, str, str]:
    agency = await make_agency(verification="not_submitted")
    driver = await make_driver(agency, verification="not_submitted", link="active")
    r = await http.put(
        "/api/v1/me/documents/aadhaar",
        headers=auth(driver),
        data={"number": "234123412346"},
        files={"file": ("a.pdf", PDF, "application/pdf")},
    )
    assert r.status_code == 200, r.text
    snap = await doc_ref(C.drivers, driver.uid).get()
    fid = snap.to_dict()["aadhaar"]["file"]["fileId"]  # type: ignore[index]
    f = (await doc_ref(C.files, fid).get()).to_dict()
    assert f is not None
    return driver.uid, driver.phone, str(f["storagePath"])


async def test_storage_rules_reads_owner_admin_only_and_no_writes(http: httpx.AsyncClient) -> None:
    uid, phone, path = await _driver_aadhaar_path(http)
    assert path.startswith(f"users/{uid}/identity/aadhaar/"), path
    url = f"{STORAGE}/{quote(path, safe='')}"
    other = await make_customer()
    expect = {
        "anonymous": (None, 403),
        "other_user": (forge_token(other.uid), 403),
        "other_user_fake_role": (forge_token(other.uid, role="agency"), 403),
        "owner": (forge_token(uid), 200),  # documented backstop
        "admin_claim": (forge_token(other.uid, role="admin"), 200),
    }
    failures = []
    async with httpx.AsyncClient(timeout=10) as c:
        for name, (tok, status) in expect.items():
            for suffix in ("", "?alt=media"):
                r = await c.get(url + suffix, headers=_hdr(tok))
                if r.status_code != status:
                    failures.append(f"read {name}{suffix}: {r.status_code} (expected {status})")
        # Listing the user folder is not allowed for other users.
        r = await c.get(STORAGE, params={"prefix": f"users/{uid}/"}, headers=_hdr(forge_token(other.uid)))
        if r.status_code != 403:
            failures.append(f"list by other user -> {r.status_code}")
        # No client writes: overwrite, new object in own folder, foreign folder, delete.
        for name, tok in (("owner", forge_token(uid)), ("admin", forge_token(other.uid, role="admin")),
                          ("anonymous", None)):
            for target in (path, f"users/{uid}/profile_photo/t3probe.jpg", "agencies/agc_x/vehicles/v/photos/p.jpg"):
                r = await c.post(
                    STORAGE, params={"name": target, "uploadType": "media"}, content=b"\xff\xd8\xffhack",
                    headers={**_hdr(tok), "Content-Type": "image/jpeg"},
                )
                if r.status_code != 403:
                    failures.append(f"write {name} {target}: {r.status_code}")
            r = await c.delete(url, headers=_hdr(tok))
            if r.status_code != 403:
                failures.append(f"delete {name}: {r.status_code}")
        r = await c.get(url + "?alt=media", headers=_hdr(forge_token(uid)))
        if r.status_code != 200 or not r.content.startswith(b"%PDF-"):
            failures.append(f"object changed or gone after write attempts: {r.status_code}")
    assert not failures, "\n".join(failures)


async def test_storage_non_user_paths_admin_only(http: httpx.AsyncClient) -> None:
    from tests.support.builders import create_vehicle

    agency = await make_agency()
    v = await create_vehicle(http, agency)  # uploads the RC under agencies/{agencyId}/vehicles/...
    rc_file = v.get("rc", {}) or {}
    fid = rc_file.get("fileId") or (rc_file.get("file") or {}).get("fileId")
    if not fid:
        vdoc = (await doc_ref(C.vehicles, v["id"]).get()).to_dict() or {}
        fid = ((vdoc.get("rc") or {}).get("file") or {}).get("fileId")
    assert fid, v
    path = str((await doc_ref(C.files, fid).get()).to_dict()["storagePath"])  # type: ignore[index]
    assert path.startswith("agencies/"), path
    url = f"{STORAGE}/{quote(path, safe='')}?alt=media"
    async with httpx.AsyncClient(timeout=10) as c:
        assert (await c.get(url)).status_code == 403
        assert (await c.get(url, headers=_hdr(forge_token(agency.uid)))).status_code == 403  # owner agency: API only
        assert (await c.get(url, headers=_hdr(forge_token("x", role="admin")))).status_code == 200


@pytest.mark.xfail(
    strict=True,
    reason="T3-3: storage.rules owner backstop accepts a phone-OTP-only token (sign_in_provider=phone): "
    "a SIM holder without the password can download the account's Aadhaar/licence/PAN directly",
)
async def test_storage_identity_documents_need_a_password_session(http: httpx.AsyncClient) -> None:
    uid, phone, path = await _driver_aadhaar_path(http)
    url = f"{STORAGE}/{quote(path, safe='')}?alt=media"
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(url, headers=_hdr(forge_token(uid, provider="phone", phone=phone)))
    assert r.status_code == 403
