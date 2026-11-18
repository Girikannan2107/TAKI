/** Supported cities and leg distances (data-contract.md §11.1). */
import type { City, CityId } from "./types";

export const CITIES: readonly City[] = [
  { id: "coimbatore", name: "Coimbatore", state: "Tamil Nadu", lat: 11.0168, lng: 76.9558 },
  { id: "tiruppur", name: "Tiruppur", state: "Tamil Nadu", lat: 11.1085, lng: 77.3411 },
  { id: "erode", name: "Erode", state: "Tamil Nadu", lat: 11.341, lng: 77.7172 },
  { id: "salem", name: "Salem", state: "Tamil Nadu", lat: 11.6643, lng: 78.146 },
  { id: "namakkal", name: "Namakkal", state: "Tamil Nadu", lat: 11.2189, lng: 78.1677 },
  { id: "krishnagiri", name: "Krishnagiri", state: "Tamil Nadu", lat: 12.5266, lng: 78.215 },
  { id: "vellore", name: "Vellore", state: "Tamil Nadu", lat: 12.9165, lng: 79.1325 },
  { id: "kanchipuram", name: "Kanchipuram", state: "Tamil Nadu", lat: 12.8342, lng: 79.7036 },
  { id: "chennai", name: "Chennai", state: "Tamil Nadu", lat: 13.0827, lng: 80.2707 },
  { id: "madurai", name: "Madurai", state: "Tamil Nadu", lat: 9.9252, lng: 78.1198 },
  { id: "tiruchirappalli", name: "Tiruchirappalli", state: "Tamil Nadu", lat: 10.7905, lng: 78.7047 },
  { id: "hosur", name: "Hosur", state: "Tamil Nadu", lat: 12.7409, lng: 77.8253 },
  { id: "bengaluru", name: "Bengaluru", state: "Karnataka", lat: 12.9716, lng: 77.5946 },
  { id: "kochi", name: "Kochi", state: "Kerala", lat: 9.9312, lng: 76.2673 },
];

const BY_ID = new Map(CITIES.map((c) => [c.id, c]));

export function getCity(id: CityId | undefined | null): City | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** "Coimbatore" (falls back to the id). */
export function cityName(id: CityId | undefined | null): string {
  return getCity(id)?.name ?? (id ?? "");
}

/** "Coimbatore, Tamil Nadu" — used in form fields as on the reference. */
export function cityLabel(id: CityId | undefined | null): string {
  const c = getCity(id);
  return c ? `${c.name}, ${c.state}` : (id ?? "");
}

export function isCityId(id: string): boolean {
  return BY_ID.has(id);
}

const LEG_KM_TABLE: Array<[CityId, CityId, number]> = [
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
];

const LEG_KM = new Map<string, number>();
for (const [a, b, km] of LEG_KM_TABLE) {
  LEG_KM.set(`${a}|${b}`, km);
  LEG_KM.set(`${b}|${a}`, km);
}

function haversineKm(a: City, b: City): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Road distance of one leg: table value, else haversine × 1.25 rounded. */
export function legKm(a: CityId, b: CityId): number {
  if (a === b) return 0;
  const known = LEG_KM.get(`${a}|${b}`);
  if (known !== undefined) return known;
  const ca = getCity(a);
  const cb = getCity(b);
  if (!ca || !cb) throw new Error(`Unknown city: ${!ca ? a : b}`);
  return Math.round(haversineKm(ca, cb) * 1.25);
}

/** Cumulative km from origin for each city in an ordered path (first = 0). */
export function cumulativeKm(path: CityId[]): number[] {
  const out: number[] = [];
  let total = 0;
  path.forEach((id, i) => {
    if (i > 0) total += legKm(path[i - 1]!, id);
    out.push(total);
  });
  return out;
}

/** Sum of consecutive legs. */
export function pathDistanceKm(path: CityId[]): number {
  const cum = cumulativeKm(path);
  return cum[cum.length - 1] ?? 0;
}
