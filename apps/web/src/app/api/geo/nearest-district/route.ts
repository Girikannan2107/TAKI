import type { NearestDistrictDTO } from "@/lib/api/contracts/auth";
import { NearestDistrictQuery } from "@/lib/api/contracts/auth";
import { DomainError } from "@/lib/api/contracts/errors";
import { haversineKm, nearestDistrict } from "@/lib/domain/places/geo";
import { handler } from "@/server/http/handler";

/** GET /api/geo/nearest-district?lat&lng — browser geolocation → nearest district HQ (approximate; no reverse geocoding). */
export const GET = handler({ auth: "any", query: NearestDistrictQuery }, ({ query }): NearestDistrictDTO => {
  const d = nearestDistrict(query.lat, query.lng);
  if (!d) throw new DomainError("outside_service_area");
  return { districtId: d.id, districtName: d.name, state: d.state, distanceKm: Math.round(haversineKm({ lat: query.lat, lng: query.lng }, d.hq)) };
});
