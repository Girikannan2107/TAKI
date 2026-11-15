/** Id generation (data-contract.md §1). */
import type { BookingId } from "./types";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function genId(prefix: string, rand: () => number): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return `${prefix}_${s}`;
}

/** Random public booking id "TAKI" + 6 digits, unique among `existing`. */
export function genBookingId(existing: Record<string, unknown>, rand: () => number): BookingId {
  for (let i = 0; i < 1000; i++) {
    const n = 100000 + Math.floor(rand() * 900000);
    const id = `TAKI${n}`;
    if (!(id in existing)) return id;
  }
  throw new Error("Could not allocate a booking id");
}

export const BOOKING_ID_PATTERN = /^TAKI\d{6}$/;

// ── v2 ids (P2 §4): "<prefix>_<20 base32 chars>" from a CSPRNG ───────────────
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** Known id prefixes. */
export type IdPrefix =
  | "usr" | "agc" | "veh" | "trp" | "shp" | "pay" | "ntf" | "fil" | "job" | "inv" | "otp"
  | "tev" | "bev" | "stl" | "rf" | "msg";

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** e.g. newId("trp") → "trp_k3x9…" (20 chars of base32). */
export function newId(prefix: IdPrefix): string {
  const bytes = randomBytes(20);
  let s = "";
  for (const b of bytes) s += BASE32[b & 31];
  return `${prefix}_${s}`;
}

export const ID_PATTERN = (prefix: string) => new RegExp(`^${prefix}_[a-z2-7]{20}$`);

/** `count` distinct random booking ids "TAKI" + 6 digits (checked for collisions in the transaction). */
export function bookingIdCandidates(count = 3): string[] {
  const set = new Set<string>();
  while (set.size < count) {
    const [a, b, c] = randomBytes(3);
    const n = 100000 + (((a! << 16) | (b! << 8) | c!) % 900000);
    set.add(`TAKI${n}`);
  }
  return [...set];
}
