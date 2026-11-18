import "server-only";
/** Shared helpers for the agency module (D2). */
import { DomainError } from "@/lib/api/contracts/errors";
import type { SessionContext } from "@/server/auth/guards";
import { C, getDocStore } from "@/server/db";
import type { AgencyDoc, DriverDoc, TripDoc, VehicleDoc } from "@/server/db/schema";
import { encodeCursor } from "@/server/http/cursor";

/** The caller's agency id (403 for anyone else). */
export function agencyIdOf(session: SessionContext): string {
  if (session.role !== "agency" || !session.agencyId) throw new DomainError("forbidden");
  return session.agencyId;
}

export async function loadAgency(agencyId: string): Promise<AgencyDoc> {
  const a = await getDocStore().get<AgencyDoc>(C.agencies, agencyId);
  if (!a) throw new DomainError("not_found");
  return a;
}

/** Vehicle owned by the agency and not removed (404 otherwise — no existence leak). */
export async function ownedVehicle(agencyId: string, vehicleId: string, opts: { includeRemoved?: boolean } = {}): Promise<VehicleDoc> {
  const v = await getDocStore().get<VehicleDoc>(C.vehicles, vehicleId);
  if (!v || v.agencyId !== agencyId || (!opts.includeRemoved && v.status === "removed")) throw new DomainError("not_found");
  return v;
}

/** Driver linked (any link status) to the agency. */
export async function linkedDriver(agencyId: string, driverId: string): Promise<DriverDoc> {
  const d = await getDocStore().get<DriverDoc>(C.drivers, driverId);
  if (!d || !d.agencyLink || d.agencyLink.agencyId !== agencyId) throw new DomainError("not_found");
  return d;
}

export async function ownedTrip(agencyId: string, tripId: string): Promise<TripDoc> {
  const t = await getDocStore().get<TripDoc>(C.trips, tripId);
  if (!t || t.agencyId !== agencyId) throw new DomainError("not_found");
  return t;
}

/** In-memory pagination for small agency-scoped lists: cursor = base64url([offset]). */
export function pageByOffset<T>(rows: readonly T[], limit: number, cursor: string | undefined): { items: T[]; nextCursor: string | null } {
  let offset = 0;
  if (cursor) {
    try {
      const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
      if (Array.isArray(v) && typeof v[0] === "number" && v[0] >= 0) offset = v[0];
      else throw new Error("bad");
    } catch {
      throw new DomainError("invalid_request", "Invalid cursor.", { fields: { cursor: "Invalid cursor" } });
    }
  }
  const items = rows.slice(offset, offset + limit);
  return { items, nextCursor: offset + limit < rows.length ? encodeCursor([offset + limit]) : null };
}

/** Field error helper. */
export function fieldError(code: ConstructorParameters<typeof DomainError>[0], field: string, message: string, details?: Record<string, unknown>): DomainError {
  return new DomainError(code, message, { fields: { [field]: message }, details });
}

/** Statuses during which a vehicle/driver is "in use" by a trip. */
export const LIVE_TRIP_STATUSES = ["published", "in_progress"] as const;
