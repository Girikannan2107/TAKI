/**
 * Pincode checks (P2 §7.1): 6 digits, no leading 0, first two digits agree with the state.
 * TN 60–64 · KL 67–69 · KA 56–59 · TG 50 · AP 51–53.
 */
import type { StateCode } from "../model";

export const PINCODE_PATTERN = /^[1-9]\d{5}$/;

export const STATE_PINCODE_PREFIXES: Record<StateCode, readonly string[]> = {
  TN: ["60", "61", "62", "63", "64"],
  KL: ["67", "68", "69"],
  KA: ["56", "57", "58", "59"],
  TG: ["50"],
  AP: ["51", "52", "53"],
};

export function isValidPincode(pin: string): boolean {
  return PINCODE_PATTERN.test(pin);
}

export function pincodeMatchesState(pin: string, state: StateCode): boolean {
  return isValidPincode(pin) && STATE_PINCODE_PREFIXES[state].includes(pin.slice(0, 2));
}

/** State implied by a pincode prefix, if any. */
export function stateForPincode(pin: string): StateCode | null {
  if (!isValidPincode(pin)) return null;
  const p = pin.slice(0, 2);
  for (const [state, prefixes] of Object.entries(STATE_PINCODE_PREFIXES) as Array<[StateCode, readonly string[]]>) {
    if (prefixes.includes(p)) return state;
  }
  return null;
}
