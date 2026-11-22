/**
 * IST (Asia/Kolkata, UTC+05:30, no DST) date helpers. Framework-free.
 * IsoDate = "YYYY-MM-DD" (IST calendar day); IsoDateTime = UTC ISO instant.
 */
import type { IsoDate } from "./model";

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

export function addDaysIso(date: IsoDate, days: number): IsoDate {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * MS_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
