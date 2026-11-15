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

// ── TAKI v2 (P2 §5–§7) ────────────────────────────────────────────────────────
export const V2 = {
  /** Agency must respond this long before the pickup checkpoint's expected departure. */
  respondLeadMinutes: 60,
  /** After acceptance the customer has this long to pay … */
  paymentWindowMinutes: 120,
  /** … but never later than this long before the pickup departure. */
  paymentCutoffBeforeDepartureMinutes: 30,
  /** Starting a checkout extends an unpaid hold to at least now + this. */
  checkoutGraceMinutes: 15,
  /** Driver/vehicle schedule interval padding on both sides of a trip. */
  scheduleBufferMinutes: 60,
  /** A trip can be published only if it departs at least this far ahead … */
  publishMinLeadMinutes: 60,
  /** … and at most this many days ahead. */
  publishMaxDaysAhead: 60,
  /** Driver may depart checkpoint 0 from departureAt − this. */
  tripStartWindowMinutes: 120,
  /** Pickup allowed from pickup.expectedDepartureAt − this. */
  pickupWindowHours: 24,
  maxCheckpoints: 10,
  minCheckpoints: 2,
  /** Agencies may override a computed leg distance by ± this fraction. */
  kmOverrideTolerance: 0.3,
  /** Approximate road distance = haversine × this. */
  roadFactor: 1.25,
  handlingFeeRupees: { min: 0, max: 2000 },
  otpAttempts: 5,
  maxProofFiles: 3,
  maxBookingsPerTrip: 50,
  reviewCommentMax: 500,
  reasonMax: 300,
} as const;

/** Upload limits (P2 §4.7). */
export const UPLOAD_LIMITS = {
  maxRequestBytes: 20 * 1024 * 1024,
  documentBytes: 5 * 1024 * 1024,
  photoBytes: 5 * 1024 * 1024,
  proofBytes: 8 * 1024 * 1024,
} as const;

/** Job runner backoff in minutes per attempt (then `failed`). */
export const JOB_BACKOFF_MINUTES: readonly number[] = [1, 5, 15, 60, 60, 60, 60, 60];
export const JOB_MAX_ATTEMPTS = 8;
