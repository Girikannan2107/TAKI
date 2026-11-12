/** Business limits and constants (data-contract.md §5, §8, §10). Framework-free. */
import type { Rupees } from "./types";

export const LIMITS = {
  weightKg: { min: 10, max: 25_000 },
  capacityKg: { min: 100 },
  ratePerKmPaise: { min: 100, max: 10_000 }, // ₹1.00 – ₹100.00
  ratePerKgPaise: { min: 0, max: 2_000 }, // ₹0.00 – ₹20.00
  maxStops: 5,
  bookingWindowDays: 60,
  /** A route departing today must leave at least this long from now. */
  sameDayLeadMinutes: 60,
  /** After the partner accepts, the customer has this long to pay before the capacity hold is released. */
  paymentWindowMinutes: 120,
  minWithdrawal: 100 as Rupees,
  name: { min: 2, max: 60 },
  password: { min: 8, max: 64 },
} as const;

/** TAKI service fee slabs by shipment weight (inclusive upper bounds). */
export const SERVICE_FEE_SLABS: ReadonlyArray<{ upToKg: number; fee: Rupees }> = [
  { upToKg: 500, fee: 350 },
  { upToKg: 1000, fee: 500 },
  { upToKg: 2000, fee: 750 },
  { upToKg: Number.POSITIVE_INFINITY, fee: 1000 },
];

export const OTP = {
  length: 6,
  expirySeconds: 5 * 60,
  resendCooldownSeconds: 30,
  maxAttempts: 5,
  maxResends: 3,
} as const;

export const SESSION_TTL_DAYS = 7;
export const LOGIN_LOCK = { maxFailures: 5, lockMinutes: 15 } as const;

/** Average speed used for duration estimates (km/h). */
export const AVERAGE_SPEED_KMH = 55;

/** Example shipment used by the driver's Set Pricing preview. */
export const PRICING_PREVIEW_WEIGHT_KG = 500;

/** Password for seeded demo accounts (documented, demo only). */
export const DEMO_PASSWORD = "Taki@2025";

export const SEED_VERSION = 3;
