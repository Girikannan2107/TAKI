/**
 * Approximate distances and nearest-district lookup (P2 §7.1). Pure.
 * Road km = curated table when known, otherwise haversine × road factor (1.25).
 * The UI must label these "approx. road km".
 */
import { V2 } from "../constants";
import type { PlaceId } from "../model";
import { DISTRICTS, type District } from "./districts";
import { getPlace } from "./places";

const R_KM = 6371;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

/** Curated road distances (km) between places, kept from Phase 1. */
const LEG_KM_TABLE: Array<[PlaceId, PlaceId, number]> = [
  ["coimbatore", "salem", 165],
  ["salem", "vellore", 205],
  ["vellore", "chennai", 128],
  ["coimbatore", "chennai", 498],
  ["salem", "chennai", 333],
  ["coimbatore", "vellore", 370],
  ["coimbatore", "tiruppur", 52],
  ["tiruppur", "salem", 116],
  ["coimbatore", "erode", 102],
  ["erode", "salem", 65],
  ["salem", "kanchipuram", 280],
  ["kanchipuram", "chennai", 73],
  ["coimbatore", "bengaluru", 365],
  ["salem", "krishnagiri", 115],
  ["krishnagiri", "hosur", 50],
  ["hosur", "bengaluru", 40],
  ["coimbatore", "kochi", 190],
  ["coimbatore", "palakkad", 55],
  ["palakkad", "thrissur", 70],
  ["thrissur", "kochi", 80],
  ["madurai", "tiruchirappalli", 135],
  ["tiruchirappalli", "chennai", 330],
  ["bengaluru", "chennai", 345],
  ["hyderabad", "bengaluru", 570],
  ["hyderabad", "vijayawada", 275],
  ["vijayawada", "visakhapatnam", 350],
];

const LEG_KM = new Map<string, number>();
for (const [a, b, km] of LEG_KM_TABLE) {
  LEG_KM.set(`${a}|${b}`, km);
  LEG_KM.set(`${b}|${a}`, km);
}

/** Approximate road km of one leg between two places. Throws on unknown place ids. */
export function legKm(a: PlaceId, b: PlaceId): number {
  if (a === b) return 0;
  const known = LEG_KM.get(`${a}|${b}`);
  if (known !== undefined) return known;
  const pa = getPlace(a);
  const pb = getPlace(b);
  if (!pa || !pb) throw new RangeError(`Unknown place: ${!pa ? a : b}`);
  return Math.max(1, Math.round(haversineKm(pa, pb) * V2.roadFactor));
}

/** Cumulative km from the first place for an ordered path (first = 0). */
export function cumulativeKm(path: readonly PlaceId[]): number[] {
  const out: number[] = [];
  let total = 0;
  path.forEach((id, i) => {
    if (i > 0) total += legKm(path[i - 1]!, id);
    out.push(total);
  });
  return out;
}

/** Is an agency-entered km override within ±30 % of the computed value? */
export function isKmOverrideAllowed(computedKm: number, overrideKm: number): boolean {
  if (computedKm === 0) return overrideKm === 0;
  return Math.abs(overrideKm - computedKm) <= computedKm * V2.kmOverrideTolerance;
}

/** Districts farther than this from every HQ are treated as outside the service area. */
const MAX_NEAREST_KM = 120;

/** Nearest district HQ by haversine, or null when the point is outside the 5 states' coverage. */
export function nearestDistrict(lat: number, lng: number): District | null {
  let best: District | null = null;
  let bestKm = Number.POSITIVE_INFINITY;
  for (const d of DISTRICTS) {
    const km = haversineKm({ lat, lng }, d.hq);
    if (km < bestKm) {
      bestKm = km;
      best = d;
    }
  }
  return bestKm <= MAX_NEAREST_KM ? best : null;
}

/** Rough duration at an average 55 km/h (minutes). */
export function estimateMinutes(km: number): number {
  return Math.round((km * 60) / 55);
}
