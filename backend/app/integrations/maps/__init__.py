"""Google Maps integration (P2 §9.1). Owner: D5. The only place TAKI talks to Google Maps.

D3 (trip routes) and D4 (addresses, matching) call::

    from app.integrations.maps import get_maps, Waypoint, LatLng
    maps = get_maps()                       # raises 503 maps_not_configured when unavailable
    place = await maps.geocode_place_id(pid)
    route = await maps.compute_route([Waypoint(place_id=a), Waypoint(place_id=b)])
    cells = await maps.compute_route_matrix(origins, destinations)

Errors: ``AddressNotFound`` (422), ``MapsUnavailable`` (502, ``details.reason``), ``MapsNotConfigured`` (503).

Caching: ``configure_maps_cache(cache)`` installs a :class:`MapsCache` (D3's Firestore implementation
in ``repositories/caches.py``). Until then an in-process cache is used.
"""

from __future__ import annotations

from .cache import COORDINATE_TTL, CachingMapsClient, InMemoryMapsCache, MapsCache, cache_key
from .client import HttpGoogleMapsClient, MapsClient
from .errors import AddressNotFound, MapsNotConfigured, MapsUnavailable
from .fake import FakeMapsClient, fake_place
from .models import GeocodedPlace, LatLng, MatrixElement, RouteLeg, RouteResult, Waypoint, haversine_km
from .settings import MapsSettings, check_maps_startup, get_maps_settings

_client: MapsClient | None = None
_cache: MapsCache | None = None


def build_maps_client(settings: MapsSettings, cache: MapsCache | None = None) -> MapsClient | None:
    """The configured client, or ``None`` when Maps is not available in this environment."""
    if settings.use_fake:
        inner: MapsClient = FakeMapsClient()
    elif settings.google_configured and settings.GOOGLE_MAPS_SERVER_KEY is not None:
        inner = HttpGoogleMapsClient(
            settings.GOOGLE_MAPS_SERVER_KEY.get_secret_value(),
            region=settings.MAPS_REGION,
            language=settings.MAPS_LANGUAGE,
            timeout_seconds=settings.MAPS_TIMEOUT_SECONDS,
        )
    else:
        return None
    return CachingMapsClient(inner, cache or InMemoryMapsCache())


def maps_configured() -> bool:
    """For ``/health/ready`` and ``/meta`` (``features.mapsConfigured``)."""
    s = get_maps_settings()
    return s.use_fake or s.google_configured


def maps_is_fake() -> bool:
    return get_maps_settings().use_fake


def get_maps() -> MapsClient:
    """The Maps client for services and routers. Raises 503 ``maps_not_configured``."""
    global _client
    if _client is None:
        _client = build_maps_client(get_maps_settings(), _cache)
        if _client is None:
            raise MapsNotConfigured()
    return _client


def configure_maps_cache(cache: MapsCache | None) -> None:
    """Install the persistent cache (call once at startup, e.g. from ``main.py`` lifespan)."""
    global _cache, _client
    _cache = cache
    _client = None


def set_maps_for_tests(client: MapsClient | None) -> None:
    global _client
    _client = client


__all__ = [
    "COORDINATE_TTL",
    "AddressNotFound",
    "CachingMapsClient",
    "FakeMapsClient",
    "GeocodedPlace",
    "HttpGoogleMapsClient",
    "InMemoryMapsCache",
    "LatLng",
    "MapsCache",
    "MapsClient",
    "MapsNotConfigured",
    "MapsSettings",
    "MapsUnavailable",
    "MatrixElement",
    "RouteLeg",
    "RouteResult",
    "Waypoint",
    "build_maps_client",
    "cache_key",
    "check_maps_startup",
    "configure_maps_cache",
    "fake_place",
    "get_maps",
    "get_maps_settings",
    "haversine_km",
    "maps_configured",
    "maps_is_fake",
    "set_maps_for_tests",
]
