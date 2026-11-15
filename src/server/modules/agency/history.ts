import "server-only";
/**
 * Agency History search (P2 §8.5). Bookings use `searchTokens array-contains <first token>`
 * (remaining tokens filtered in memory); trips, vehicles and drivers are small agency-scoped
 * sets loaded and filtered in memory; customers are derived from the agency's bookings (name only).
 */
import { HistoryQuery, type HistoryQueryInput, type HistoryRow } from "@/lib/api/contracts/agency";
import { istInstant } from "@/lib/domain/dates";
import type { SessionContext } from "@/server/auth/guards";
import { C, getDocStore } from "@/server/db";
import type { BookingDoc, DriverDoc, TripDoc, VehicleDoc } from "@/server/db/schema";
import { decodeCursor, encodeCursor } from "@/server/http/cursor";
import { tripRouteLabel } from "@/server/views/agency";
import { agencyIdOf, pageByOffset } from "./shared";

/** Search tokens. `minLength` 2 for indexed booking search; 1 for in-memory filtering ("driver 2"). */
export function tokensOf(q: string | undefined, minLength = 2): string[] {
  return (q ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= minLength)
    .slice(0, 6);
}

/** Tokens of 2+ chars match anywhere; a single character must start a word (else "2" matches "0002"). */
function textMatches(haystack: string, tokens: readonly string[]): boolean {
  const h = haystack.toLowerCase();
  const words = h.split(/[^a-z0-9]+/);
  return tokens.every((t) => (t.length > 1 ? h.includes(t) : words.some((w) => w.startsWith(t))));
}

function tokenMatches(searchTokens: readonly string[], tokens: readonly string[]): boolean {
  return tokens.every((t) => searchTokens.some((s) => s === t || s.startsWith(t)));
}

function inRange(iso: string, fromMs: number | null, toMs: number | null): boolean {
  const t = Date.parse(iso);
  return (fromMs === null || t >= fromMs) && (toMs === null || t < toMs);
}

function bookingRow(b: BookingDoc): HistoryRow {
  return {
    type: "bookings",
    id: b.id,
    title: `${b.id} · ${b.display.customerName}`,
    subtitle: `${b.pickup.placeName} → ${b.drop.placeName} · ${b.weightKg} kg · ${b.display.vehicleReg}`,
    date: b.createdAt,
    status: b.status,
    link: { type: "booking", id: b.id },
  };
}

export async function searchHistory(session: SessionContext, raw: HistoryQueryInput): Promise<{ items: HistoryRow[]; nextCursor: string | null }> {
  const agencyId = agencyIdOf(session);
  const q = HistoryQuery.parse(raw);
  const store = getDocStore();
  const tokens = tokensOf(q.q);
  const memTokens = tokensOf(q.q, 1);
  const fromMs = q.from ? Date.parse(istInstant(q.from)) : null;
  const toMs = q.to ? Date.parse(istInstant(q.to)) + 86_400_000 : null;

  if (q.type === "bookings") {
    const where: Array<readonly [string, "==" | "array-contains" | ">=" | "<", unknown]> = [["agencyId", "==", agencyId]];
    if (tokens[0]) where.push(["searchTokens", "array-contains", tokens[0]]);
    if (fromMs !== null) where.push(["createdAt", ">=", new Date(fromMs).toISOString()]);
    if (toMs !== null) where.push(["createdAt", "<", new Date(toMs).toISOString()]);
    // Over-fetch when extra tokens are filtered in memory.
    const batch = tokens.length > 1 ? Math.min(200, q.limit * 5) : q.limit + 1;
    const rows = await store.query<BookingDoc>(C.bookings, {
      where,
      orderBy: [["createdAt", "desc"], ["__name__", "desc"]],
      limit: batch,
      startAfter: decodeCursor(q.cursor),
    });
    const matched = tokens.length > 1 ? rows.filter((b) => tokenMatches(b.searchTokens ?? [], tokens.slice(1))) : rows;
    const items = matched.slice(0, q.limit);
    const last = items[items.length - 1];
    const more = tokens.length > 1 ? rows.length === batch || matched.length > q.limit : rows.length > q.limit;
    // Cursor continues after the last *scanned* row when filtering, else after the last returned row.
    const anchor = tokens.length > 1 && matched.length <= q.limit ? rows[rows.length - 1] : last;
    return { items: items.map(bookingRow), nextCursor: more && anchor ? encodeCursor([anchor.createdAt, anchor.id]) : null };
  }

  if (q.type === "trips") {
    const trips = await store.query<TripDoc>(C.trips, { where: [["agencyId", "==", agencyId]], orderBy: [["departureAt", "desc"], ["__name__", "desc"]], limit: 500 });
    const rows = trips
      .filter((t) => inRange(t.departureAt, fromMs, toMs))
      .filter((t) => !memTokens.length || textMatches(`${t.id} ${t.checkpoints.map((c) => `${c.placeName} ${c.districtName}`).join(" ")} ${t.vehicle.registrationNumber} ${t.driver.fullName}`, memTokens))
      .map(
        (t): HistoryRow => ({
          type: "trips",
          id: t.id,
          title: tripRouteLabel(t),
          subtitle: `${t.vehicle.registrationNumber} · ${t.driver.fullName} · ${t.distanceKm} km`,
          date: t.departureAt,
          status: t.status,
          link: { type: "trip", id: t.id },
        }),
      );
    return pageByOffset(rows, q.limit, q.cursor);
  }

  if (q.type === "vehicles") {
    const vehicles = await store.query<VehicleDoc>(C.vehicles, { where: [["agencyId", "==", agencyId]], orderBy: [["createdAt", "desc"], ["__name__", "desc"]], limit: 500 });
    const rows = vehicles
      .filter((v) => inRange(v.createdAt, fromMs, toMs))
      .filter((v) => !memTokens.length || textMatches(`${v.registrationNumber} ${v.registrationNumber.replace(/\s+/g, "")} ${v.makeModel} ${v.vehicleClass}`, memTokens))
      .map(
        (v): HistoryRow => ({
          type: "vehicles",
          id: v.id,
          title: v.registrationNumber,
          subtitle: `${v.makeModel} · ${v.vehicleClass} · ${v.maxPayloadKg.toLocaleString("en-IN")} kg`,
          date: v.createdAt,
          status: v.status,
          link: v.status === "removed" ? null : { type: "vehicle", id: v.id },
        }),
      );
    return pageByOffset(rows, q.limit, q.cursor);
  }

  if (q.type === "drivers") {
    const drivers = await store.query<DriverDoc>(C.drivers, { where: [["agencyLink.agencyId", "==", agencyId]], limit: 500 });
    const rows = drivers
      .filter((d) => inRange(d.agencyLink?.requestedAt ?? d.createdAt, fromMs, toMs))
      .filter((d) => !memTokens.length || textMatches(`${d.fullName} ${d.phone.slice(-4)}`, memTokens))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map(
        (d): HistoryRow => ({
          type: "drivers",
          id: d.id,
          title: d.fullName,
          subtitle: `${d.stats?.delivered ?? 0} deliveries · ${d.agencyLink?.via === "invite" ? "Invited" : "Requested to join"}`,
          date: d.agencyLink?.requestedAt ?? d.createdAt,
          status: d.agencyLink?.status ?? null,
          link: { type: "driver", id: d.id },
        }),
      );
    return pageByOffset(rows, q.limit, q.cursor);
  }

  // customers: grouped from the agency's recent bookings (name only — no contact details here).
  const bookings = await store.query<BookingDoc>(C.bookings, { where: [["agencyId", "==", agencyId]], orderBy: [["createdAt", "desc"], ["__name__", "desc"]], limit: 500 });
  const byCustomer = new Map<string, { name: string; count: number; latest: BookingDoc }>();
  for (const b of bookings) {
    if (!inRange(b.createdAt, fromMs, toMs)) continue;
    const cur = byCustomer.get(b.customerId);
    if (cur) cur.count += 1;
    else byCustomer.set(b.customerId, { name: b.display.customerName, count: 1, latest: b });
  }
  const rows = [...byCustomer.entries()]
    .filter(([, c]) => !memTokens.length || textMatches(c.name, memTokens))
    .map(
      ([customerId, c]): HistoryRow => ({
        type: "customers",
        id: customerId,
        title: c.name,
        subtitle: `${c.count} ${c.count === 1 ? "booking" : "bookings"} · latest ${c.latest.id}`,
        date: c.latest.createdAt,
        status: null,
        link: { type: "booking", id: c.latest.id },
      }),
    );
  return pageByOffset(rows, q.limit, q.cursor);
}
