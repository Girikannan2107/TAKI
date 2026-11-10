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
