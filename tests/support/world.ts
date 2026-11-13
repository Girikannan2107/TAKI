/**
 * Core test world (D5): an agency with vehicles and drivers, customers, published trips and
 * shipments — built with the seed builders (`src/server/seed/builders.ts`) and written through
 * the DocStore, so it works on the MemoryDocStore and on the Firestore emulator alike.
 * Business transitions (publish, request, accept, pay…) always go through `@/server/core`.
 */
import type { SessionContext } from "@/server/core/context";
import type { Ctx } from "@/server/core/context";
import { tripsLifecycle } from "@/server/core/trips-lifecycle";
import { getDocStore } from "@/server/db";
import { C } from "@/server/db/collections";
import type { BatchOp } from "@/server/db/docstore";
import type { AgencyDoc, CustomerDoc, DriverDoc, ShipmentDoc, TripDoc, UserDoc, VehicleDoc } from "@/server/db/schema";
import { accountOps, address, agencyDoc, customerDoc, driverDoc, shipmentDoc, tripDraft, vehicleDoc, type StopInput } from "@/server/seed/builders";
import { payments } from "@/server/payments/service";
import { bookings } from "@/server/core/bookings";
import type { BookingDoc } from "@/server/db/schema";

export const HOUR = 3_600_000;
export const MIN = 60_000;

let seq = 0;
const phone = () => `+9198${String(10_000_000 + (++seq % 89_999_999)).padStart(8, "0")}`;
const fakeFile = (tag: string) => `fil_${tag.padEnd(20, "a").slice(0, 20)}`;

export function sessionOf(user: UserDoc, name: string, extra: Partial<SessionContext> = {}): SessionContext {
  return {
    userId: user.id,
    role: user.role as SessionContext["role"],
    profileId: user.role === "agency" ? (user.agencyId ?? user.id) : user.id,
    agencyId: user.agencyId,
    sessionId: `sess_${user.id}`,
    name,
    phone: user.phone,
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: user.createdAt,
    ...extra,
  };
}

export const ctxOf = (actor: SessionContext, now: Date): Ctx => ({ actor, now });

export interface World {
  now: Date;
  agency: AgencyDoc;
  owner: SessionContext;
  vehicles: VehicleDoc[];
  drivers: Array<{ doc: DriverDoc; session: SessionContext }>;
  customers: Array<{ doc: CustomerDoc; session: SessionContext }>;
}

export async function createWorld(now: Date, opts: { customers?: number; drivers?: number; vehicles?: number; agencyStatus?: "verified" | "pending" } = {}): Promise<World> {
  const ops: BatchOp[] = [];
  const agencyId = `agc_${String(++seq).padStart(20, "t")}`.slice(0, 24);
  const ownerAcc = accountOps({ role: "agency", phone: phone(), displayName: "Kavitha Raman", passwordHash: "x", now, agencyId });
  ops.push(...ownerAcc.ops);
  const agency = agencyDoc(ownerAcc.user, {
    id: agencyId,
    agencyName: "Kovai Freight Lines",
    ownerName: "Kavitha Raman",
    districtId: "coimbatore",
    statesCovered: ["KL", "KA"],
    identityFileId: fakeFile("pan"),
    verifiedStatus: opts.agencyStatus ?? "verified",
    now,
  });
  ops.push({ op: "create", col: C.agencies, id: agency.id, data: agency });

  const vehicles: VehicleDoc[] = [];
  for (let i = 0; i < (opts.vehicles ?? 2); i++) {
    const v = vehicleDoc({
      agencyId,
      vehicleClass: "Medium Truck",
      modelId: "tata_407",
      makeModel: "Tata 407",
      registrationNumber: `TN 37 AB ${String(1000 + seq * 10 + i).slice(-4)}`,
      maxPayloadKg: 5000,
      bodyType: "tarpaulin",
      acceptedGoods: ["general_goods", "agriculture", "textiles", "electronics", "furniture", "industrial", "construction", "perishables", "other"],
      handlingSupported: ["fragile", "keep_dry", "this_side_up", "temperature_sensitive"],
      imageKey: "medium_cargo_truck_taki",
      now,
    });
    vehicles.push(v);
    ops.push({ op: "create", col: C.vehicles, id: v.id, data: v });
  }

  const drivers: World["drivers"] = [];
  for (let i = 0; i < (opts.drivers ?? 2); i++) {
    const acc = accountOps({ role: "driver", phone: phone(), displayName: `Driver ${i + 1}`, passwordHash: "x", now });
    ops.push(...acc.ops);
    const doc = driverDoc(acc.user, {
      fullName: `Driver ${i + 1}`,
      agency,
      linkStatus: "active",
      via: "invite",
      photoFileId: fakeFile(`ph${i}`),
      licenseFileId: fakeFile(`dl${i}`),
      aadhaarFileId: fakeFile(`aa${i}`),
      now,
      seq: i + 1,
    });
    ops.push({ op: "create", col: C.drivers, id: doc.id, data: doc });
    drivers.push({ doc, session: sessionOf(acc.user, doc.fullName) });
  }

  const customers: World["customers"] = [];
  for (let i = 0; i < (opts.customers ?? 3); i++) {
    const acc = accountOps({ role: "customer", phone: phone(), displayName: `Customer ${i + 1}`, passwordHash: "x", now });
    ops.push(...acc.ops);
    const doc = customerDoc(acc.user, { fullName: `Customer ${i + 1}`, dob: "1990-01-01", now });
    ops.push({ op: "create", col: C.customers, id: doc.id, data: doc });
    customers.push({ doc, session: sessionOf(acc.user, doc.fullName) });
  }

  await getDocStore().batchWrite(ops);
  return { now, agency, owner: sessionOf(ownerAcc.user, "Kavitha Raman"), vehicles, drivers, customers };
}

/** Coimbatore → Tiruppur → Erode → Salem. */
export const DEFAULT_STOPS: StopInput[] = [{ placeId: "coimbatore" }, { placeId: "tiruppur", arriveAfterMin: 60 }, { placeId: "erode", arriveAfterMin: 150 }, { placeId: "salem", arriveAfterMin: 240 }];

export async function createTrip(
  w: World,
  o: { offeredKg?: number; departInMin?: number; departureAt?: Date; stops?: StopInput[]; driver?: number; vehicle?: number; publish?: boolean; now?: Date } = {},
): Promise<TripDoc> {
  const now = o.now ?? w.now;
  const draft = tripDraft({
    agency: w.agency,
    vehicle: w.vehicles[o.vehicle ?? 0]!,
    driver: w.drivers[o.driver ?? 0]!.doc,
    departureAt: o.departureAt ?? new Date(now.getTime() + (o.departInMin ?? 48 * 60) * MIN),
    stops: o.stops ?? DEFAULT_STOPS,
    offeredKg: o.offeredKg ?? 1000,
    now,
  });
  await getDocStore().batchWrite([{ op: "create", col: C.trips, id: draft.id, data: draft }]);
  if (o.publish === false) return draft;
  return tripsLifecycle.publish(ctxOf(w.owner, now), draft.id);
}

export async function createShipment(w: World, customer: number, o: { weightKg: number; from?: string; to?: string; specialHandling?: ShipmentDoc["package"]["specialHandling"] }): Promise<ShipmentDoc> {
  const s = shipmentDoc({
    customerId: w.customers[customer]!.doc.id,
    source: address(o.from ?? "coimbatore", "12 Mill Road", "641001"),
    destination: address(o.to ?? "salem", "4 Bazaar Street", "636001"),
    receiver: { name: "Receiver", phone: "+919876500000" },
    weightKg: o.weightKg,
    specialHandling: o.specialHandling,
    shippingDate: "2026-11-22",
    now: w.now,
  });
  await getDocStore().batchWrite([{ op: "create", col: C.shipments, id: s.id, data: s }]);
  return s;
}

let keySeq = 0;
export const idemKey = () => `test-key-${Date.now().toString(36)}-${++keySeq}`;

/** request → accept for a fresh shipment. */
export async function requestAndAccept(w: World, trip: TripDoc, customer: number, weightKg: number, now = w.now): Promise<BookingDoc> {
  const s = await createShipment(w, customer, { weightKg });
  const { booking } = await bookings.request(ctxOf(w.customers[customer]!.session, now), { shipmentId: s.id, tripId: trip.id, idempotencyKey: idemKey() });
  return bookings.accept(ctxOf(w.owner, now), booking.id);
}

/** Pay through the dev gateway's explicit Approve step. */
export async function payDev(w: World, customer: number, bookingId: string, now = w.now) {
  const ctx = ctxOf(w.customers[customer]!.session, now);
  const order = await payments.createOrder(ctx, bookingId, idemKey());
  if (order.checkout.kind !== "dev") throw new Error("expected dev checkout");
  const token = new URL(order.checkout.url, "http://x").searchParams.get("token")!;
  return payments.devConfirm(ctx, { paymentId: order.paymentId, outcome: "success", devToken: token });
}
