/**
 * Pricing contract (data-contract.md §5). All arithmetic is integer:
 * rates in paise, outputs in whole rupees, each line rounded half-up.
 */
import { AVERAGE_SPEED_KMH, SERVICE_FEE_SLABS } from "./constants";
import type { PricingBreakdownV2, PricingLine, SpecialHandling } from "./model";
import type { Paise, PricingBreakdown, Rupees } from "./types";

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

// ── Pricing v2 (P2 §7.3) ──────────────────────────────────────────────────────

export interface QuoteV2Input {
  /** drop.kmFromOrigin − pickup.kmFromOrigin */
  segmentKm: number;
  weightKg: number;
  ratePerKmPaise: Paise;
  ratePerKgPaise: Paise;
  /** Trip's flat handling fee, charged only when the shipment needs special handling. */
  handlingFeeRupees: Rupees;
  specialHandling: readonly SpecialHandling[];
}

/**
 * Transparent v2 quote: per-km × segment km + per-kg × weight + handling fee (if any
 * special handling) + TAKI service fee. Every line is in `lines[]`, and
 * `totalPayable` is exactly their sum. GST is not itemised (P3 Q5).
 */
export function quoteV2(i: QuoteV2Input): PricingBreakdownV2 {
  const distanceCharge = roundHalfUp(i.segmentKm * i.ratePerKmPaise);
  const weightCharge = roundHalfUp(i.weightKg * i.ratePerKgPaise);
  const transportationCharge = distanceCharge + weightCharge;
  const handlingFee = i.specialHandling.length > 0 ? i.handlingFeeRupees : 0;
  const serviceFee = serviceFeeFor(i.weightKg);
  const lines: PricingLine[] = [
    { code: "distance", label: `Distance (${i.segmentKm} km × ₹${paiseToRupeesString(i.ratePerKmPaise)}/km)`, amount: distanceCharge },
    { code: "weight", label: `Weight (${i.weightKg} kg × ₹${paiseToRupeesString(i.ratePerKgPaise)}/kg)`, amount: weightCharge },
  ];
  if (handlingFee > 0) lines.push({ code: "handling", label: "Special handling", amount: handlingFee });
  lines.push({ code: "service_fee", label: "TAKI service fee", amount: serviceFee });
  return {
    pricingVersion: 2,
    distanceKm: i.segmentKm,
    weightKg: i.weightKg,
    ratePerKmPaise: i.ratePerKmPaise,
    ratePerKgPaise: i.ratePerKgPaise,
    distanceCharge,
    weightCharge,
    transportationCharge,
    handlingFee,
    serviceFee,
    totalPayable: lines.reduce((s, l) => s + l.amount, 0),
    lines,
  };
}

/** Segment distance between two checkpoints of a trip. */
export function segmentKm(checkpoints: ReadonlyArray<{ kmFromOrigin: number }>, pickupIndex: number, dropIndex: number): number {
  const a = checkpoints[pickupIndex];
  const b = checkpoints[dropIndex];
  if (!a || !b || dropIndex <= pickupIndex) throw new RangeError("Invalid segment");
  return b.kmFromOrigin - a.kmFromOrigin;
}

/** Agency earning for a booking (what TAKI settles): transportation + handling. */
export function agencyNetOf(p: Pick<PricingBreakdownV2, "transportationCharge" | "handlingFee">): Rupees {
  return p.transportationCharge + p.handlingFee;
}

/** Whole rupees → integer paise for the payment gateway. */
export function rupeesToPaiseInt(rupees: Rupees): Paise {
  return Math.round(rupees * 100);
}
