/** Indian mobile number helpers (data-contract.md §10). Framework-free. */
import type { Mobile } from "./types";

export const INDIAN_MOBILE_PATTERN = /^[6-9]\d{9}$/;

/** Strip spaces, "+91"/"91", a leading 0 → 10 digits (or null if invalid). */
export function normalizeIndianMobile(input: string): string | null {
  let digits = (input ?? "").replace(/[\s-]/g, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return INDIAN_MOBILE_PATTERN.test(digits) ? digits : null;
}

/** 10 digits → E.164 "+91XXXXXXXXXX" (or null). */
export function toE164(input: string): Mobile | null {
  const d = normalizeIndianMobile(input);
  return d ? `+91${d}` : null;
}
