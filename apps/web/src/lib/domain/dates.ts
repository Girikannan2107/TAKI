/**
 * IST (Asia/Kolkata, UTC+05:30, no DST) date helpers. Framework-free.
 * IsoDate = "YYYY-MM-DD" (IST calendar day); IsoDateTime = UTC ISO instant.
 */
import type { IsoDate, IsoDateTime, TimeOfDay } from "./types";

export const IST_OFFSET_MINUTES = 330;
const MS_MIN = 60_000;
const MS_DAY = 86_400_000;

function toDate(now: Date | number | string): Date {
  return now instanceof Date ? now : new Date(now);
}

/** Shift an instant into "IST wall clock" so UTC getters read IST fields. */
export function istWallClock(instant: Date | number | string): Date {
  return new Date(toDate(instant).getTime() + IST_OFFSET_MINUTES * MS_MIN);
}

/** Today's calendar date in IST. */
export function todayIst(now: Date | number = Date.now()): IsoDate {
  return istWallClock(now).toISOString().slice(0, 10);
}

/** IST calendar date of an instant. */
export function isoDateFromInstant(instant: IsoDateTime | Date | number): IsoDate {
  return istWallClock(instant).toISOString().slice(0, 10);
}

/** IST "HH:mm" of an instant. */
export function timeOfDayFromInstant(instant: IsoDateTime | Date | number): TimeOfDay {
  return istWallClock(instant).toISOString().slice(11, 16);
}

/** UTC instant (ms) for an IST date + "HH:mm". */
export function istInstantMs(date: IsoDate, time: TimeOfDay = "00:00"): number {
  return Date.parse(`${date}T${time}:00+05:30`);
}

export function istInstant(date: IsoDate, time: TimeOfDay = "00:00"): IsoDateTime {
  return new Date(istInstantMs(date, time)).toISOString();
}

export function addDaysIso(date: IsoDate, days: number): IsoDate {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * MS_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

export function addMinutes(instant: IsoDateTime | Date | number, minutes: number): IsoDateTime {
  return new Date(toDate(instant).getTime() + minutes * MS_MIN).toISOString();
}

/** Negative if a < b, 0 if equal, positive if a > b (lexicographic works for YYYY-MM-DD). */
export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_DAY);
}

/** "YYYY-MM" month key (IST) of a date or instant. */
export function monthKey(dateOrInstant: IsoDate | IsoDateTime | Date | number): string {
  if (typeof dateOrInstant === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateOrInstant)) return dateOrInstant.slice(0, 7);
  return isoDateFromInstant(dateOrInstant as IsoDateTime).slice(0, 7);
}

/** Month key n months before/after `key` ("2026-11", -1 → "2026-10"). */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function firstOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

/** Departure instant of a route/trip in ms. */
export function departureMs(travelDate: IsoDate, departureTime: TimeOfDay): number {
  return istInstantMs(travelDate, departureTime);
}

/** Valid "HH:mm" 24h. */
export function isTimeOfDay(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
