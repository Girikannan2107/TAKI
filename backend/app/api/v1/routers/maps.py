"""E23–E24: server-side geocoding for forms (any signed-in user). Owner: D5.

E23 (forward geocode) also accepts a fresh phone-proof token, so an agency that is still
signing up (no password yet) can resolve its typed base address when no browser Places key
is configured. Same per-uid rate limit. E24 stays session-only.

Places Autocomplete runs in the browser with the restricted browser key; there is no proxy.
Route preview for agencies is D3's E70 (it calls ``get_maps().compute_route``).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.core.context import CurrentUser, PhoneProof
from app.deps import get_current_user, get_user_or_phone_proof
from app.integrations.maps import LatLng, get_maps, get_maps_settings
from app.integrations.maps.models import GeocodedPlace
from app.middleware.rate_limit import client_ip, rate_limit
from app.schemas.errors import error_responses
from app.schemas.maps import GeocodeBody, GeocodeResponse, PlaceDTO, ReverseGeocodeBody

router = APIRouter(prefix="/maps", tags=["maps"])

UserDep = Annotated[CurrentUser, Depends(get_current_user)]
UserOrProofDep = Annotated[CurrentUser | PhoneProof, Depends(get_user_or_phone_proof)]


def _response(place: GeocodedPlace) -> GeocodeResponse:
    states = get_maps_settings().SERVICE_STATES
    return GeocodeResponse(
        place=PlaceDTO(
            place_id=place.place_id,
            name=place.name,
            formatted_address=place.formatted_address,
            lat=place.lat,
            lng=place.lng,
            locality=place.locality,
            district=place.district,
            state=place.state_code or "",
            state_name=place.state_name or "",
            pincode=place.pincode,
        ),
        in_service_area=place.in_service_area(states),
    )


def _uid_key(request: Request) -> str:
    return str(getattr(request.state, "uid", None) or client_ip(request))


@router.post("/geocode", response_model=GeocodeResponse, responses=error_responses(401, 422, 429, 502, 503))
async def geocode(
    body: GeocodeBody, user: UserOrProofDep, _rl: Annotated[None, Depends(rate_limit("maps_uid", _uid_key))]
) -> GeocodeResponse:
    maps = get_maps()
    place = await (maps.geocode_place_id(body.place_id) if body.place_id else maps.geocode_address(body.address or ""))
    return _response(place)


@router.post("/reverse-geocode", response_model=GeocodeResponse, responses=error_responses(401, 422, 429, 502, 503))
async def reverse_geocode(
    body: ReverseGeocodeBody, user: UserDep, _rl: Annotated[None, Depends(rate_limit("maps_uid", _uid_key))]
) -> GeocodeResponse:
    # The coordinates come from the user's browser (granted geolocation); they are not stored here.
    return _response(await get_maps().reverse_geocode(LatLng(body.lat, body.lng)))
