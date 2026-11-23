"""E52–E59: fleet CRUD, registration normalisation + uniqueness, RC upload, photos, isolation."""

from __future__ import annotations

import httpx

from app.repositories.base import C, get_doc
from tests.support.builders import (
    PDF_BYTES,
    create_trip,
    create_vehicle,
    jpeg_bytes,
    make_agency,
    make_driver,
    vehicle_body,
)

V = "/api/v1/agency/vehicles"


async def test_create_normalises_and_refuses_duplicates(api: httpx.AsyncClient) -> None:
    a = await make_agency()
    r = await api.post(V, json=vehicle_body(registrationNumber="tn38zz1234"), headers=a.headers)
    assert r.status_code == 201, r.text
    v = r.json()
    assert v["registrationNumber"] == "TN 38 ZZ 1234"
    assert v["status"] == "active"
    assert v["imageKey"] == "light_cargo_lorry_taki"
    assert v["rc"] is None and v["rcVerification"]["status"] == "not_submitted"
    assert await get_doc(C.registration_index, "TN38ZZ1234")

    r = await api.post(V, json=vehicle_body(registrationNumber="TN 38 ZZ 1234"), headers=a.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "registration_taken"
    assert "registrationNumber" in r.json()["error"]["fields"]
    other = await make_agency("Other Agency")
    r = await api.post(V, json=vehicle_body(registrationNumber="tn-38-zz-1234"), headers=other.headers)
    assert r.status_code == 409

    agency = await get_doc(C.agencies, a.agency_id or "")
    assert agency and agency["stats"]["vehicles"] == 1


async def test_validation_errors(api: httpx.AsyncClient) -> None:
    a = await make_agency()
    r = await api.post(V, json=vehicle_body(registrationNumber="hello", maxPayloadKg=50), headers=a.headers)
    assert r.status_code == 400
    fields = r.json()["error"]["fields"]
    assert fields["registrationNumber"].startswith("Enter a valid registration number")
    assert "maxPayloadKg" in fields
    r = await api.post(V, json=vehicle_body(acceptedGoods=[]), headers=a.headers)
    assert r.status_code == 400 and "acceptedGoods" in r.json()["error"]["fields"]
    # BH series
    r = await api.post(V, json=vehicle_body(registrationNumber="22bh1234aa"), headers=a.headers)
    assert r.status_code == 201 and r.json()["registrationNumber"] == "22 BH 1234 AA"


async def test_edit_deactivate_remove_and_reuse_registration(api: httpx.AsyncClient) -> None:
    a = await make_agency()
    v = await create_vehicle(api, a, rc=False, registrationNumber="KA01AB1234")
    r = await api.patch(f"{V}/{v['id']}", json={"maxPayloadKg": 2500, "status": "inactive"}, headers=a.headers)
    assert r.status_code == 200, r.text
    assert r.json()["maxPayloadKg"] == 2500 and r.json()["status"] == "inactive"
    # partial PATCH keeps other fields
    assert r.json()["makeModel"] == "Tata 407"

    r = await api.patch(f"{V}/{v['id']}", json={"registrationNumber": "KA01AB9999"}, headers=a.headers)
    assert r.status_code == 200 and r.json()["registrationNumber"] == "KA 01 AB 9999"
    assert await get_doc(C.registration_index, "KA01AB1234") is None
    assert await get_doc(C.registration_index, "KA01AB9999")

    r = await api.delete(f"{V}/{v['id']}", headers=a.headers)
    assert r.status_code == 204
    r = await api.get(V, headers=a.headers)
    assert all(x["id"] != v["id"] for x in r.json()["items"])
    assert (await api.get(f"{V}/{v['id']}", headers=a.headers)).status_code == 404
    # registration released for reuse
    r = await api.post(V, json=vehicle_body(registrationNumber="KA01AB9999"), headers=a.headers)
    assert r.status_code == 201


async def test_list_filters_by_status(api: httpx.AsyncClient) -> None:
    a = await make_agency()
    v1 = await create_vehicle(api, a, rc=False)
    v2 = await create_vehicle(api, a, rc=False)
    await api.patch(f"{V}/{v2['id']}", json={"status": "inactive"}, headers=a.headers)
    act = (await api.get(V, params={"status": "active"}, headers=a.headers)).json()["items"]
    allv = (await api.get(V, headers=a.headers)).json()["items"]
    assert [x["id"] for x in act] == [v1["id"]]
    assert {x["id"] for x in allv} == {v1["id"], v2["id"]}


async def test_rc_upload_and_already_verified(api: httpx.AsyncClient) -> None:
    a = await make_agency()
    v = await create_vehicle(api, a, rc=False, registrationNumber="TN37XX4587")
    r = await api.put(
        f"{V}/{v['id']}/documents/rc",
        headers=a.headers,
        data={"validUntil": "2030-01-01"},
        files={"file": ("rc.pdf", PDF_BYTES, "application/pdf")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rcVerification"]["status"] == "pending"
    assert body["rc"]["numberMasked"] == "XXXXXX4587"
    assert body["rc"]["validUntil"] == "2030-01-01"
    assert "/files/" in body["rc"]["fileUrl"]
    # wrong type
    r = await api.put(
        f"{V}/{v['id']}/documents/rc", headers=a.headers, files={"file": ("x.txt", b"hello", "text/plain")}
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "file_invalid"
    # after admin verification the RC can't be replaced
    from app.repositories.base import doc_ref

    await doc_ref(C.vehicles, v["id"]).update({"rcVerification.status": "verified"})
    r = await api.put(
        f"{V}/{v['id']}/documents/rc", headers=a.headers, files={"file": ("rc.pdf", PDF_BYTES, "application/pdf")}
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_verified"


async def test_photos_max_five(api: httpx.AsyncClient) -> None:
    a = await make_agency()
    v = await create_vehicle(api, a, rc=False)
    for _ in range(5):
        r = await api.post(
            f"{V}/{v['id']}/photos", headers=a.headers, files={"photo": ("p.jpg", jpeg_bytes(), "image/jpeg")}
        )
        assert r.status_code == 201, r.text
    assert len(r.json()["photos"]) == 5
    r = await api.post(
        f"{V}/{v['id']}/photos", headers=a.headers, files={"photo": ("p.jpg", jpeg_bytes(), "image/jpeg")}
    )
    assert r.status_code == 409
    fid = (await api.get(f"{V}/{v['id']}", headers=a.headers)).json()["photos"][0]["fileId"]
    r = await api.delete(f"{V}/{v['id']}/photos/{fid}", headers=a.headers)
    assert r.status_code == 200 and len(r.json()["photos"]) == 4
    assert (await api.delete(f"{V}/{v['id']}/photos/{fid}", headers=a.headers)).status_code == 404


async def test_live_trip_blocks_remove_deactivate_and_payload_cut(api: httpx.AsyncClient) -> None:
    a = await make_agency()
    d = await make_driver(a)
    v = await create_vehicle(api, a)
    await create_trip(api, a, v["id"], d.uid, offered_kg=2000)
    r = await api.delete(f"{V}/{v['id']}", headers=a.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "vehicle_has_active_trips"
    r = await api.patch(f"{V}/{v['id']}", json={"status": "inactive"}, headers=a.headers)
    assert r.status_code == 409
    r = await api.patch(f"{V}/{v['id']}", json={"maxPayloadKg": 1500}, headers=a.headers)
    assert r.status_code == 409 and "maxPayloadKg" in r.json()["error"]["fields"]
    r = await api.patch(f"{V}/{v['id']}", json={"makeModel": "Tata 407 Gold"}, headers=a.headers)
    assert r.status_code == 200 and r.json()["activeTrips"] == 1
    trips = (await api.get("/api/v1/agency/trips", headers=a.headers)).json()["items"]
    assert trips[0]["vehicle"]["makeModel"] == "Tata 407 Gold"  # snapshot refreshed


async def test_isolation_and_roles(api: httpx.AsyncClient) -> None:
    a = await make_agency()
    v = await create_vehicle(api, a, rc=False)
    other = await make_agency("Other")
    assert (await api.get(f"{V}/{v['id']}", headers=other.headers)).status_code == 404
    assert (await api.patch(f"{V}/{v['id']}", json={"makeModel": "Hijack"}, headers=other.headers)).status_code == 404
    assert (await api.delete(f"{V}/{v['id']}", headers=other.headers)).status_code == 404
    d = await make_driver(a)
    r = await api.get(V, headers=d.headers)
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    assert (await api.get(V)).status_code == 401
    assert (await api.get(f"{V}/not-an-id", headers=a.headers)).status_code == 404


async def test_suspended_agency_cannot_mutate(api: httpx.AsyncClient) -> None:
    a = await make_agency(verification="suspended")
    r = await api.post(V, json=vehicle_body(), headers=a.headers)
    assert r.status_code == 403 and r.json()["error"]["code"] == "agency_suspended"
    assert (await api.get(V, headers=a.headers)).status_code == 200
