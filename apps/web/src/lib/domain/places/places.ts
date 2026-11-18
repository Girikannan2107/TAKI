/**
 * Hub places that can be trip checkpoints (P2 §7.1): one per district HQ plus extra
 * commercial hubs. Each place belongs to exactly one district — the matching unit.
 * Phase 1 CityIds are all valid PlaceIds (hosur → krishnagiri, bengaluru → bengaluru-urban,
 * kochi → ernakulam).
 */
import type { DistrictId, PlaceId, StateCode } from "../model";
import { DISTRICTS, getDistrict } from "./districts";

export interface Place {
  id: PlaceId;
  name: string;
  districtId: DistrictId;
  state: StateCode;
  lat: number;
  lng: number;
  /** True for the district headquarters place. */
  isHq: boolean;
}

/** [id, name, districtId, lat, lng] */
const EXTRA_HUBS: Array<[string, string, string, number, number]> = [
  ["hosur", "Hosur", "krishnagiri", 12.7409, 77.8253],
  ["pollachi", "Pollachi", "coimbatore", 10.6589, 77.0085],
  ["mettupalayam", "Mettupalayam", "coimbatore", 11.299, 76.935],
  ["kumbakonam", "Kumbakonam", "thanjavur", 10.9617, 79.3881],
  ["karaikudi", "Karaikudi", "sivaganga", 10.073, 78.78],
  ["sriperumbudur", "Sriperumbudur", "kanchipuram", 12.9675, 79.9419],
  ["ambur", "Ambur", "tirupathur", 12.7916, 78.7166],
  ["kovilpatti", "Kovilpatti", "thoothukudi", 9.172, 77.869],
  ["palani", "Palani", "dindigul", 10.45, 77.52],
  ["hubballi", "Hubballi", "dharwad", 15.3647, 75.124],
  ["tenali", "Tenali", "guntur", 16.243, 80.64],
  ["hindupur", "Hindupur", "sri-sathya-sai", 13.829, 77.491],
  ["ramagundam", "Ramagundam", "peddapalli", 18.755, 79.474],
  ["secunderabad", "Secunderabad", "hyderabad", 17.4399, 78.4983],
];

export const PLACES: readonly Place[] = [
  ...DISTRICTS.map((d) => ({ id: d.hqPlaceId, name: d.hqName, districtId: d.id, state: d.state, lat: d.hq.lat, lng: d.hq.lng, isHq: true })),
  ...EXTRA_HUBS.map(([id, name, districtId, lat, lng]) => {
    const d = getDistrict(districtId);
    if (!d) throw new Error(`Unknown district for hub ${id}: ${districtId}`);
    return { id, name, districtId, state: d.state, lat, lng, isHq: false };
  }),
];

const BY_ID = new Map(PLACES.map((p) => [p.id, p]));

export function getPlace(id: string | null | undefined): Place | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function isPlaceId(id: unknown): id is PlaceId {
  return typeof id === "string" && BY_ID.has(id);
}

export function placeName(id: string | null | undefined): string {
  return getPlace(id)?.name ?? id ?? "";
}

/** "Hosur, Krishnagiri" style label for pickers. */
export function placeLabel(id: string | null | undefined): string {
  const p = getPlace(id);
  if (!p) return id ?? "";
  const d = getDistrict(p.districtId);
  return d && d.name !== p.name ? `${p.name}, ${d.name}` : p.name;
}

export function placesInDistrict(districtId: DistrictId): Place[] {
  return PLACES.filter((p) => p.districtId === districtId);
}

export function placesInState(state: StateCode): Place[] {
  return PLACES.filter((p) => p.state === state).sort((a, b) => a.name.localeCompare(b.name));
}
