"""Maps API models (contract §7, E23–E24). Owner: D5."""

from __future__ import annotations

from typing import Annotated

from pydantic import Field, model_validator
from pydantic_core import PydanticCustomError

from app.schemas.common import CamelModel, PlaceDTO, PlaceId

Lat = Annotated[float, Field(ge=-90, le=90)]
Lng = Annotated[float, Field(ge=-180, le=180)]


class GeocodeBody(CamelModel):
    place_id: PlaceId | None = None
    address: str | None = Field(None, min_length=5, max_length=300)  # free text; country=IN is forced

    @model_validator(mode="after")
    def _exactly_one(self) -> GeocodeBody:
        if (self.place_id is None) == (self.address is None):
            raise PydanticCustomError("field:placeId", "Send either a place or an address")
        return self


class ReverseGeocodeBody(CamelModel):
    lat: Lat
    lng: Lng


class GeocodeResponse(CamelModel):
    place: PlaceDTO
    in_service_area: bool


__all__ = ["GeocodeBody", "GeocodeResponse", "PlaceDTO", "ReverseGeocodeBody"]
