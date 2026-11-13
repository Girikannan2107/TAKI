import "server-only";
import { createHmac } from "node:crypto";
import type { IdentityDocumentKind } from "@/lib/domain/model";
import { piiHashKey } from "@/server/env";

/*
 * Identity document numbers (P2 §4.3): validated, masked for display, and HMAC'd only to flag reuse across
 * accounts. The full number is never stored.
 */

// Verhoeff tables (Aadhaar check digit).
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const rev = digits.split("").reverse();
  for (let i = 0; i < rev.length; i++) c = D[c]![P[i % 8]![Number(rev[i])]!]!;
  return c === 0;
}

export interface NormalizedDocument {
  normalized: string;
  masked: string;
}

/** Returns the normalized + masked number, or a user-facing problem. */
export function normalizeDocumentNumber(kind: IdentityDocumentKind, raw: string): NormalizedDocument | { problem: string } {
  const v = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  switch (kind) {
    case "aadhaar":
      if (!/^[2-9]\d{11}$/.test(v) || !verhoeffValid(v)) return { problem: "Enter a valid 12-digit Aadhaar number." };
      return { normalized: v, masked: `XXXX XXXX ${v.slice(-4)}` };
    case "pan":
      if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(v)) return { problem: "Enter a valid PAN, e.g. ABCDE1234F." };
      return { normalized: v, masked: `XXXXXX${v.slice(-4)}` };
    case "driving_license":
      if (!/^[A-Z0-9]{10,20}$/.test(v)) return { problem: "Enter a valid driving licence number (10–20 letters and digits)." };
      return { normalized: v, masked: `${"X".repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` };
  }
}

export function documentHmac(kind: IdentityDocumentKind, normalized: string): string {
  return createHmac("sha256", piiHashKey()).update(`${kind}:${normalized}`).digest("base64url");
}
