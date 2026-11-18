/**
 * Display formatting (data-contract.md §9). Fixed locale en-IN and IST so server
 * and client render identical strings.
 */
import { cityName } from "@/lib/domain/cities";
import { istWallClock } from "@/lib/domain/dates";
import { paiseToRupeesString } from "@/lib/domain/pricing";
import type { CityId, IsoDate, IsoDateTime, Paise, TimeOfDay } from "@/lib/domain/types";

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0, minimumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** 4850 → "₹4,850"; 186200 → "₹1,86,200". */
export function formatINR(rupees: number): string {
  return INR.format(rupees);
}

/** en-IN grouping without currency: 186200 → "1,86,200". */
export function formatNumber(n: number): string {
  return NUM.format(n);
}

/** Rate in paise → "₹12", "₹0.50", "₹7.50". */
export function formatRate(paise: Paise): string {
  return `₹${paiseToRupeesString(paise)}`;
}

export function formatKg(kg: number): string {
  return `${NUM.format(kg)} kg`;
}

export function formatKm(km: number): string {
  return `${NUM.format(km)} km`;
}

/** 543 → "~9 hr"; 45 → "~45 min". */
export function formatDuration(mins: number): string {
  if (mins < 60) return `~${Math.max(1, Math.round(mins))} min`;
  return `~${Math.round(mins / 60)} hr`;
}

/** 140 → "2h 20m"; 45 → "45m"; 120 → "2h". Exact (no "~"), for scheduled times. */
export function formatHoursMinutes(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/** "2025-11-20" → "20 Nov, 2025". */
export function formatDate(date: IsoDate): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]}, ${y}`;
}

/** "2025-11-20" → "Thu, 20 Nov". */
export function formatDateShort(date: IsoDate): string {
  const dt = new Date(`${date}T00:00:00Z`);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()];
  return `${wd}, ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

/** "2026-11" → "November 2026". */
export function formatMonth(key: string): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** "2026-11" → "Nov". */
export function formatMonthShort(key: string): string {
  const m = Number(key.split("-")[1]);
  return MONTHS[m - 1] ?? key;
}

function hhmmAmPm(h: number, min: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(min).padStart(2, "0")} ${suffix}`;
}

/** "08:00" → "08:00 AM"; "21:30" → "09:30 PM". */
export function formatTime(time: TimeOfDay): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return hhmmAmPm(h, m);
}

/** Instant → "20 Nov, 09:12 AM" (IST). */
export function formatDateTime(instant: IsoDateTime): string {
  const w = istWallClock(instant);
  return `${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]}, ${hhmmAmPm(w.getUTCHours(), w.getUTCMinutes())}`;
}

/** Instant → "20 Nov, 2025" (IST). */
export function formatInstantDate(instant: IsoDateTime): string {
  const w = istWallClock(instant);
  return `${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]}, ${w.getUTCFullYear()}`;
}

/** Instant → "09:12 AM" (IST). */
export function formatInstantTime(instant: IsoDateTime): string {
  const w = istWallClock(instant);
  return hhmmAmPm(w.getUTCHours(), w.getUTCMinutes());
}

/** "+919876543210" | "9876543210" → "+91 98765 43210". */
export function formatPhone(mobile: string): string {
  const digits = mobile.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return mobile;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** Mask all but the last 4 digits: "+91 ••••• •3210". */
export function maskPhone(mobile: string): string {
  const digits = mobile.replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? `+91 ••••• •${digits.slice(6)}` : mobile;
}

/** 3 → "03". */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 12 → "+12% vs last month"; −5 → "−5% vs last month"; null → "". */
export function formatChangePct(pct: number | null, suffix = " vs last month"): string {
  if (pct === null) return "";
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct)}%${suffix}`;
}

/** "Arjun Kumar" → "Arjun K." */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1]![0]}.`;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

/** City ids → "Coimbatore → Salem → Chennai". */
export function routeLabel(cityIds: CityId[]): string {
  return cityIds.map(cityName).join(" → ");
}

/** Initials for avatars: "Arjun Kumar" → "AK". */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "")).toUpperCase();
}
