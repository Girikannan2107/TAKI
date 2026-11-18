"""Google Maps client parsing + error mapping (respx), caching, and the FAKE provider."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from app.core.errors import AppError
from app.integrations.maps import client as client_mod
from app.integrations.maps import polyline
from app.integrations.maps.cache import CachingMapsClient, InMemoryMapsCache
from app.integrations.maps.client import GEOCODE_URL, MATRIX_URL, ROUTES_URL, HttpGoogleMapsClient
from app.integrations.maps.fake import FakeMapsClient, fake_place
from app.integrations.maps.models import LatLng, Waypoint
from app.integrations.maps.place_resolver import geohash_encode, place_ref
from app.integrations.maps.settings import MapsSettings, check_maps_startup

KEY = "TEST_SERVER_KEY"

COIMBATORE_RESULT = {
    "place_id": "ChIJtRyXL69ZqDsRgtI-GB7IwS8",
    "formatted_address": "12, Avinashi Rd, Peelamedu, Coimbatore, Tamil Nadu 641004, India",
    "types": ["street_address"],
    "geometry": {"location": {"lat": 11.0267, "lng": 77.0063}},
    "address_components": [
        {"long_name": "12", "short_name": "12", "types": ["street_number"]},
        {"long_name": "Avinashi Road", "short_name": "Avinashi Rd", "types": ["route"]},
        {"long_name": "Peelamedu", "short_name": "Peelamedu", "types": ["sublocality_level_1", "sublocality"]},
        {"long_name": "Coimbatore", "short_name": "Coimbatore", "types": ["locality", "political"]},
        {"long_name": "Coimbatore", "short_name": "Coimbatore", "types": ["administrative_area_level_3", "political"]},
        {"long_name": "Tamil Nadu", "short_name": "TN", "types": ["administrative_area_level_1", "political"]},
        {"long_name": "India", "short_name": "IN", "types": ["country", "political"]},
        {"long_name": "641004", "short_name": "641004", "types": ["postal_code"]},
    ],
}


@pytest.fixture(autouse=True)
def _no_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(client_mod, "RETRY_BACKOFF_SECONDS", 0)


def _google() -> HttpGoogleMapsClient:
    return HttpGoogleMapsClient(KEY)


# ── Geocoding ───────────────────────────────────────────────────────────────────────────────


@respx.mock
async def test_forward_geocode_parses_components_and_forces_india() -> None:
    route = respx.get(GEOCODE_URL).mock(
        return_value=httpx.Response(200, json={"status": "OK", "results": [COIMBATORE_RESULT]})
    )
    place = await _google().geocode_address("12 Avinashi Road, Coimbatore 641004, Tamil Nadu")
    params = route.calls.last.request.url.params
    assert params["components"] == "country:IN" and params["key"] == KEY and params["region"] == "in"
    assert place.place_id == "ChIJtRyXL69ZqDsRgtI-GB7IwS8"
    assert (place.lat, place.lng) == (11.0267, 77.0063)
    assert (place.locality, place.district, place.state_code, place.state_name) == (
        "Coimbatore",
        "Coimbatore",
        "TN",
        "Tamil Nadu",
    )
    assert place.pincode == "641004" and place.country_code == "IN"
    assert place.name == "Avinashi Road"
    assert place.in_service_area(["TN", "KL"])
    assert not place.in_service_area(["KA"])


@respx.mock
async def test_place_id_and_reverse_lookups_use_the_right_parameters() -> None:
    route = respx.get(GEOCODE_URL).mock(
        return_value=httpx.Response(200, json={"status": "OK", "results": [COIMBATORE_RESULT]})
    )
    await _google().geocode_place_id("ChIJtRyXL69ZqDsRgtI-GB7IwS8")
    assert route.calls.last.request.url.params["place_id"] == "ChIJtRyXL69ZqDsRgtI-GB7IwS8"
    await _google().reverse_geocode(LatLng(11.0267, 77.0063))
    p = route.calls.last.request.url.params
    assert p["latlng"] == "11.026700,77.006300" and "locality" in p["result_type"]


@pytest.mark.parametrize(
    ("status", "code", "reason"),
    [
        ("ZERO_RESULTS", "address_not_found", None),
        ("OVER_QUERY_LIMIT", "maps_unavailable", "quota"),
        ("OVER_DAILY_LIMIT", "maps_unavailable", "quota"),
        ("REQUEST_DENIED", "maps_unavailable", "denied"),
        ("UNKNOWN_ERROR", "maps_unavailable", "upstream"),
    ],
)
@respx.mock
async def test_geocode_error_mapping(status: str, code: str, reason: str | None) -> None:
    respx.get(GEOCODE_URL).mock(return_value=httpx.Response(200, json={"status": status, "results": []}))
    with pytest.raises(AppError) as exc:
        await _google().geocode_address("nowhere at all")
    assert exc.value.code == code
    if reason:
        assert exc.value.details == {"reason": reason}
        assert exc.value.status == 502


@respx.mock
async def test_invalid_place_id_is_address_not_found() -> None:
    respx.get(GEOCODE_URL).mock(return_value=httpx.Response(200, json={"status": "INVALID_REQUEST"}))
    with pytest.raises(AppError) as exc:
        await _google().geocode_place_id("bogus_place_id")
    assert exc.value.code == "address_not_found" and exc.value.status == 422


@respx.mock
async def test_timeouts_and_5xx_are_retried_then_unavailable() -> None:
    route = respx.get(GEOCODE_URL).mock(
        side_effect=[httpx.ReadTimeout("t"), httpx.Response(503), httpx.ReadTimeout("t")]
    )
    with pytest.raises(AppError) as exc:
        await _google().geocode_address("Coimbatore")
    assert exc.value.code == "maps_unavailable" and route.call_count == 3


@respx.mock
async def test_http_429_is_quota() -> None:
    respx.get(GEOCODE_URL).mock(return_value=httpx.Response(429))
    with pytest.raises(AppError) as exc:
        await _google().geocode_address("Coimbatore")
    assert exc.value.details == {"reason": "quota"}


# ── Routes ──────────────────────────────────────────────────────────────────────────────────


@respx.mock
async def test_compute_route_request_and_legs() -> None:
    route = respx.post(ROUTES_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "routes": [
                    {
                        "distanceMeters": 160500,
                        "duration": "10800s",
                        "polyline": {"encodedPolyline": "abc"},
                        "legs": [
                            {"distanceMeters": 55000, "duration": "3600s", "polyline": {"encodedPolyline": "l1"}},
                            {"duration": "7200.4s", "distanceMeters": 105500, "polyline": {"encodedPolyline": "l2"}},
                        ],
                    }
                ]
            },
        )
    )
    stops = [Waypoint(place_id="A" * 12), Waypoint(location=LatLng(11.1, 77.3)), Waypoint(place_id="C" * 12)]
    r = await _google().compute_route(stops)
    req = route.calls.last.request
    assert req.headers["X-Goog-Api-Key"] == KEY
    assert "routes.legs.polyline.encodedPolyline" in req.headers["X-Goog-FieldMask"]
    body = json.loads(req.content)
    assert body["origin"] == {"placeId": "A" * 12}
    assert body["intermediates"] == [
        {"location": {"latLng": {"latitude": 11.1, "longitude": 77.3}}, "vehicleStopover": True}
    ]
    assert body["travelMode"] == "DRIVE" and body["routingPreference"] == "TRAFFIC_UNAWARE"
    assert body["regionCode"] == "in" and body["units"] == "METRIC"
    assert (r.distance_km, r.duration_min, r.polyline) == (160.5, 180, "abc")
    assert [(leg.distance_km, leg.duration_min) for leg in r.legs] == [(55.0, 60), (105.5, 120)]
    assert r.km_from_origin() == [0.0, 55.0, 160.5]


@respx.mock
async def test_route_errors() -> None:
    respx.post(ROUTES_URL).mock(return_value=httpx.Response(200, json={}))
    with pytest.raises(AppError) as exc:
        await _google().compute_route([Waypoint(place_id="A" * 12), Waypoint(place_id="B" * 12)])
    assert exc.value.code == "address_not_found"
    respx.post(ROUTES_URL).mock(return_value=httpx.Response(429, json={"error": {"status": "RESOURCE_EXHAUSTED"}}))
    with pytest.raises(AppError) as exc:
        await _google().compute_route([Waypoint(place_id="A" * 12), Waypoint(place_id="B" * 12)])
    assert exc.value.details == {"reason": "quota"}
    respx.post(ROUTES_URL).mock(return_value=httpx.Response(403, json={"error": {"status": "PERMISSION_DENIED"}}))
    with pytest.raises(AppError) as exc:
        await _google().compute_route([Waypoint(place_id="A" * 12), Waypoint(place_id="B" * 12)])
    assert exc.value.details == {"reason": "denied"}


@respx.mock
async def test_route_matrix_handles_omitted_zero_indices_and_missing_routes() -> None:
    respx.post(MATRIX_URL).mock(
        return_value=httpx.Response(
            200,
            json=[
                {"condition": "ROUTE_EXISTS", "distanceMeters": 1000, "duration": "60s"},  # 0,0 omitted
                {"destinationIndex": 1, "condition": "ROUTE_EXISTS", "distanceMeters": 2000, "duration": "120s"},
                {"originIndex": 1, "condition": "ROUTE_NOT_FOUND", "status": {}},
                {"originIndex": 1, "destinationIndex": 1, "status": {"code": 5}},
            ],
        )
    )
    o = [Waypoint(location=LatLng(11.0, 77.0)), Waypoint(location=LatLng(12.0, 78.0))]
    d = [Waypoint(location=LatLng(11.1, 77.1)), Waypoint(location=LatLng(12.1, 78.1))]
    cells = await _google().compute_route_matrix(o, d)
    assert [(c.origin_index, c.destination_index, c.distance_km) for c in cells] == [
        (0, 0, 1.0),
        (0, 1, 2.0),
        (1, 0, None),
        (1, 1, None),
    ]


# ── Cache wrapper ───────────────────────────────────────────────────────────────────────────


@respx.mock
async def test_caching_client_reuses_geocodes_and_routes() -> None:
    geo = respx.get(GEOCODE_URL).mock(
        return_value=httpx.Response(200, json={"status": "OK", "results": [COIMBATORE_RESULT]})
    )
    cache = InMemoryMapsCache()
    maps = CachingMapsClient(_google(), cache)
    a = await maps.geocode_address("Avinashi Road,  Coimbatore")
    b = await maps.geocode_address("avinashi road , coimbatore")
    c = await maps.geocode_place_id(a.place_id)
    assert a == b == c and geo.call_count == 1


async def test_caching_matrix_only_fetches_missing_pairs() -> None:
    fake = FakeMapsClient()
    maps = CachingMapsClient(fake, InMemoryMapsCache())
    cbe, tup, erd = (Waypoint(place_id=fake_place(n).place_id) for n in ("Coimbatore", "Tiruppur", "Erode"))
    first = await maps.compute_route_matrix([cbe], [tup])
    both = await maps.compute_route_matrix([cbe], [tup, erd])
    assert fake.calls.count("matrix") == 2
    assert both[0] == first[0]
    assert [(e.origin_index, e.destination_index) for e in both] == [(0, 0), (0, 1)]
    await maps.compute_route_matrix([cbe], [tup, erd])
    assert fake.calls.count("matrix") == 2  # fully cached


# ── FAKE provider + settings ────────────────────────────────────────────────────────────────


async def test_fake_maps_is_deterministic() -> None:
    fake = FakeMapsClient()
    p = await fake.geocode_address("No 4, Gandhi Street, Tirupur, Tamil Nadu 641601")
    assert p.place_id == "fake_tiruppur" and p.state_code == "TN"
    assert (await fake.geocode_address("Kovai 641001")).name == "Coimbatore"
    assert (await fake.geocode_address("somewhere 560034 Karnataka")).name == "Bengaluru"  # pincode prefix
    with pytest.raises(AppError) as exc:
        await fake.geocode_address("Atlantis")
    assert exc.value.code == "address_not_found"
    near = await fake.reverse_geocode(LatLng(11.02, 76.96))
    assert near.place_id == "fake_coimbatore"
    with pytest.raises(AppError):
        await fake.reverse_geocode(LatLng(28.6, 77.2))  # Delhi: nothing within 60 km
    mumbai = await fake.geocode_place_id("fake_mumbai")
    assert not mumbai.in_service_area(["TN", "KL", "KA", "TG", "AP"])


async def test_fake_routes_use_haversine_with_road_factor() -> None:
    fake = FakeMapsClient()
    stops = [Waypoint(place_id="fake_coimbatore"), Waypoint(place_id="fake_tiruppur"), Waypoint(place_id="fake_erode")]
    r1 = await fake.compute_route(stops)
    r2 = await fake.compute_route(stops)
    assert r1 == r2 and len(r1.legs) == 2
    assert 45 < r1.legs[0].distance_km < 55  # ~40 km straight line × 1.25
    assert abs(r1.legs[0].duration_s - r1.legs[0].distance_m / 1000 / 55 * 3600) < 60  # 55 km/h
    assert polyline.decode(r1.polyline)[0] == (11.0168, 76.9558)


async def test_fake_can_simulate_outage() -> None:
    fake = FakeMapsClient()
    fake.fail_with("quota")
    with pytest.raises(AppError) as exc:
        await fake.geocode_place_id("fake_erode")
    assert exc.value.code == "maps_unavailable"


def test_polyline_roundtrip_matches_google_reference() -> None:
    pts = [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
    assert polyline.encode(pts) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
    assert polyline.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@") == pts


def test_place_ref_shape_and_geohash() -> None:
    assert geohash_encode(57.64911, 10.40744, 11) == "u4pruydqqvj"
    ref = place_ref(fake_place("Coimbatore"))
    assert set(ref) == {
        "placeId",
        "name",
        "formattedAddress",
        "location",
        "locality",
        "district",
        "state",
        "stateName",
        "pincode",
        "geohash",
        "geocodedAt",
    }
    assert ref["state"] == "TN" and len(ref["geohash"]) == 7


def _ms(**kw: object) -> MapsSettings:
    return MapsSettings(_env_file=None, **kw)  # type: ignore[call-arg]


def test_maps_provider_selection() -> None:
    assert _ms(APP_ENV="development").use_fake
    assert _ms(APP_ENV="test", GOOGLE_MAPS_SERVER_KEY="").use_fake  # blank key = unset
    assert not _ms(APP_ENV="test", GOOGLE_MAPS_SERVER_KEY="k").use_fake
    prod = _ms(APP_ENV="production")
    assert not prod.use_fake and not prod.google_configured
    with pytest.raises(RuntimeError):
        check_maps_startup(_ms(APP_ENV="production", MAPS_PROVIDER="fake"))
    assert _ms(SERVICE_STATES="tn, kl").SERVICE_STATES == ["TN", "KL"]
