import "server-only";
/**
 * Customer shipments (P2 §8.4, D3): the package + addresses + receiver that a customer
 * searches with and books. Role-specific CRUD only — booking state changes go through
 * D5 `core.bookings.*`.
 */
import type { Page } from "@/lib/api/contracts/common";
import { shippingDateProblem, type CreateShipmentValues, type ShipmentListItem, type ShipmentWithBookingsDTO } from "@/lib/api/contracts/customer";
import { DomainError } from "@/lib/api/contracts/errors";
import { todayIst } from "@/lib/domain/dates";
import { newId } from "@/lib/domain/ids";
import type { Address, CustomerTab } from "@/lib/domain/model";
import { districtName } from "@/lib/domain/places/districts";
import type { SessionContext } from "../../auth/guards";
import { C } from "../../db/collections";
import { getDocStore } from "../../db";
import type { AddressInput } from "@/lib/api/contracts/common";
import type { BookingDoc, ShipmentDoc, TripDoc } from "../../db/schema";
import { decodeCursor, pageOf } from "../../http/cursor";
import { toBookingListItem, toShipmentListItem } from "../../views/customer";

/** Ownership guard: a missing or foreign shipment is the same 404 (no existence leak). */
export function assertOwnShipment(session: SessionContext, s: ShipmentDoc | null): asserts s is ShipmentDoc {
  if (!s || s.customerId !== session.userId) throw new DomainError("not_found");
}

function toAddress(a: AddressInput): Address {
  return {
    line1: a.line1,
    ...(a.line2 ? { line2: a.line2 } : {}),
    ...(a.landmark ? { landmark: a.landmark } : {}),
    districtId: a.districtId,
    districtName: districtName(a.districtId),
    state: a.state,
    pincode: a.pincode,
    ...(a.location && a.source === "current_location" ? { location: { lat: a.location.lat, lng: a.location.lng } } : {}),
    source: a.source,
  };
}

function checkDate(date: string, now: Date): void {
  const problem = shippingDateProblem(date, todayIst(now));
  if (problem) throw new DomainError(problem, undefined, { fields: { shippingDate: problem === "past_date" ? "Choose today or a later date" : "Choose a date within the next 60 days" } });
}

function shipmentFields(body: CreateShipmentValues) {
  return {
    source: toAddress(body.source),
    destination: toAddress(body.destination),
    receiver: { name: body.receiver.name, phone: body.receiver.phone },
    package: {
      weightKg: body.package.weightKg,
      goodsCategory: body.package.goodsCategory,
      packageType: body.package.packageType,
      description: body.package.description,
      pieces: body.package.pieces,
      specialHandling: [...new Set(body.package.specialHandling)],
      declaredValueRupees: body.package.declaredValueRupees ?? null,
    },
    shippingDate: body.shippingDate,
  };
}

export async function createShipment(session: SessionContext, body: CreateShipmentValues, now: Date): Promise<ShipmentDoc> {
  checkDate(body.shippingDate, now);
  const at = now.toISOString();
  const doc: ShipmentDoc = {
    id: newId("shp"),
    customerId: session.userId,
    ...shipmentFields(body),
    status: "open",
    currentBookingId: null,
    bookingIds: [],
    createdAt: at,
    updatedAt: at,
  };
  await getDocStore().runTransaction(async (tx) => {
    tx.create(C.shipments, doc.id, doc);
  });
  return doc;
}

export async function getOwnShipment(session: SessionContext, shipmentId: string): Promise<ShipmentDoc> {
  const s = await getDocStore().get<ShipmentDoc>(C.shipments, shipmentId);
  assertOwnShipment(session, s);
  return s;
}

/** Edit while open with no booking (otherwise 409 shipment_has_open_booking). */
export async function updateShipment(session: SessionContext, shipmentId: string, body: CreateShipmentValues, now: Date): Promise<ShipmentDoc> {
  checkDate(body.shippingDate, now);
  return getDocStore().runTransaction(async (tx) => {
    const s = await tx.get<ShipmentDoc>(C.shipments, shipmentId);
    assertOwnShipment(session, s);
    if (s.currentBookingId) throw new DomainError("shipment_has_open_booking", "This shipment has an open booking. Cancel it before editing.", { details: { bookingId: s.currentBookingId } });
    if (s.status !== "open") throw new DomainError("invalid_transition", "This shipment can no longer be edited.");
    const next: ShipmentDoc = { ...s, ...shipmentFields(body), updatedAt: now.toISOString() };
    tx.set(C.shipments, s.id, next);
    return next;
  });
}

/** Withdraw (soft delete) an open shipment without a booking. */
export async function withdrawShipment(session: SessionContext, shipmentId: string, now: Date): Promise<void> {
  await getDocStore().runTransaction(async (tx) => {
    const s = await tx.get<ShipmentDoc>(C.shipments, shipmentId);
    assertOwnShipment(session, s);
    if (s.status === "withdrawn") return;
    if (s.currentBookingId) throw new DomainError("shipment_has_open_booking", "This shipment has an open booking. Cancel it first.", { details: { bookingId: s.currentBookingId } });
    if (s.status !== "open") throw new DomainError("invalid_transition", "This shipment can no longer be removed.");
    tx.set(C.shipments, s.id, { ...s, status: "withdrawn", updatedAt: now.toISOString() });
  });
}

async function tripsById(ids: readonly string[]): Promise<Map<string, TripDoc>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const docs = await getDocStore().getMany<TripDoc>(C.trips, unique);
  return new Map(docs.filter((t): t is TripDoc => !!t).map((t) => [t.id, t]));
}

/** Shipment + all its bookings (newest first). */
export async function getShipmentWithBookings(session: SessionContext, shipmentId: string): Promise<ShipmentWithBookingsDTO> {
  const s = await getOwnShipment(session, shipmentId);
  const store = getDocStore();
  const bookings = (await store.getMany<BookingDoc>(C.bookings, s.bookingIds)).filter((b): b is BookingDoc => !!b && b.customerId === session.userId);
  bookings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const trips = await tripsById(bookings.map((b) => b.tripId));
  const item = toShipmentListItem(s, null);
  return { ...item, bookings: bookings.map((b) => toBookingListItem(b, trips.get(b.tripId))) };
}

/**
 * GET /api/customer/shipments.
 *  - no tab → open shipments that have no booking yet ("Not booked yet"), newest first;
 *  - tab    → shipments whose current/last booking is in that tab (via the bookings index).
 */
export async function listShipments(
  session: SessionContext,
  q: { tab?: CustomerTab; cursor?: string; limit: number },
): Promise<Page<ShipmentListItem>> {
  const store = getDocStore();
  if (!q.tab) {
    const rows = await store.query<ShipmentDoc>(C.shipments, {
      where: [
        ["customerId", "==", session.userId],
        ["status", "==", "open"],
      ],
      orderBy: [
        ["createdAt", "desc"],
        ["__name__", "desc"],
      ],
      limit: q.limit + 1,
      startAfter: decodeCursor(q.cursor),
    });
    const page = pageOf(rows, q.limit, (s) => [s.createdAt, s.id]);
    return { items: page.items.filter((s) => s.currentBookingId === null).map((s) => toShipmentListItem(s, null)), nextCursor: page.nextCursor };
  }
  const rows = await store.query<BookingDoc>(C.bookings, {
    where: [
      ["customerId", "==", session.userId],
      ["tab", "==", q.tab],
    ],
    orderBy: [
      ["updatedAt", "desc"],
      ["__name__", "desc"],
    ],
    limit: q.limit + 1,
    startAfter: decodeCursor(q.cursor),
  });
  const page = pageOf(rows, q.limit, (b) => [b.updatedAt, b.id]);
  const [shipments, trips] = await Promise.all([
    store.getMany<ShipmentDoc>(C.shipments, [...new Set(page.items.map((b) => b.shipmentId))]),
    tripsById(page.items.map((b) => b.tripId)),
  ]);
  const byId = new Map(shipments.filter((s): s is ShipmentDoc => !!s).map((s) => [s.id, s]));
  const items: ShipmentListItem[] = [];
  for (const b of page.items) {
    const s = byId.get(b.shipmentId);
    if (s && s.customerId === session.userId) items.push(toShipmentListItem(s, b, trips.get(b.tripId)));
  }
  return { items, nextCursor: page.nextCursor };
}
