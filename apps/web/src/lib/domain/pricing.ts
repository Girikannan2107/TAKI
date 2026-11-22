/**
 * Price display helpers (help page example, Set Pricing preview, money parsing). The authoritative
 * quote is computed by the FastAPI backend (pricing.lines in every DTO); nothing here decides a price.
 */
import { AVERAGE_SPEED_KMH, SERVICE_FEE_SLABS } from "./constants";
import type { Paise, PricingBreakdown, Rupees } from "./model";

/** Integer paise → integer rupees, rounding halves up. */
export function roundHalfUp(paise: number): Rupees {
  return Math.floor((Math.round(paise) + 50) / 100);
}

export function serviceFeeFor(weightKg: number): Rupees {
  for (const slab of SERVICE_FEE_SLABS) if (weightKg <= slab.upToKg) return slab.fee;
  return SERVICE_FEE_SLABS[SERVICE_FEE_SLABS.length - 1]!.fee;
}

export interface QuoteInput {
  distanceKm: number;
  weightKg: number;
  ratePerKmPaise: Paise;
  ratePerKgPaise: Paise;
}

/** Full price breakdown for one shipment over `distanceKm`. Totals are sums of displayed lines. */
export function quote({ distanceKm, weightKg, ratePerKmPaise, ratePerKgPaise }: QuoteInput): PricingBreakdown {
  const distanceCharge = roundHalfUp(distanceKm * ratePerKmPaise);
  const weightCharge = roundHalfUp(weightKg * ratePerKgPaise);
  const transportationCharge = distanceCharge + weightCharge;
  const serviceFee = serviceFeeFor(weightKg);
  return {
    pricingVersion: 1,
    distanceKm,
    weightKg,
    ratePerKmPaise,
    ratePerKgPaise,
    distanceCharge,
    weightCharge,
    transportationCharge,
    serviceFee,
    totalPayable: transportationCharge + serviceFee,
  };
}

/** Driver-side preview (no fee): distance + weight charges and "Your Earnings (before TAKI fee)". */
export function driverEarningsPreview(input: QuoteInput): { distanceCharge: Rupees; weightCharge: Rupees; earnings: Rupees } {
  const q = quote(input);
  return { distanceCharge: q.distanceCharge, weightCharge: q.weightCharge, earnings: q.transportationCharge };
}

/** Travel time estimate at an average 55 km/h. 498 km → 543 min ("~9 hr"). */
export function estimateDurationMins(km: number): number {
  return Math.round((km * 60) / AVERAGE_SPEED_KMH);
}

/** "12" → 1200, "0.5" → 50, "7.50" → 750. Returns NaN for invalid input. Max 2 decimals. */
export function rupeesToPaise(value: string | number): Paise {
  const s = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  const [whole, frac = ""] = s.split(".") as [string, string?];
  return Number(whole) * 100 + Number((frac ?? "").padEnd(2, "0") || "0");
}

/** 1200 → "12", 50 → "0.50", 750 → "7.50" (no currency symbol). */
export function paiseToRupeesString(paise: Paise): string {
  const whole = Math.floor(paise / 100);
  const frac = paise % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}
