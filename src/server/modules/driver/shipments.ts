import "server-only";
/**
 * Driver shipments (P2 §8.6): assigned list per tab, the shipment action screen and the
 * booking transitions. Every transition goes through D5 `core.bookings.*`; this module only
 * authorises the caller, validates input, handles proof uploads and projects the result.
 */
import type { z } from "zod";
import {
  DeliverFields,
  MAX_PROOF_FILES,
  type DriverShipmentDTO,
  type DriverShipmentListItem,
  type DriverShipmentTab,
  type DriverShipmentsQuery,
  type DriverEventDTO,
} from "@/lib/api/contracts/driver";
import type { Page } from "@/lib/api/contracts/common";
import { DomainError } from "@/lib/api/contracts/errors";
import type { BookingStatus } from "@/lib/domain/model";
import type { SessionContext } from "@/server/auth/guards";
import { bookings as coreBookings } from "@/server/core";
import { C, getDocStore, sub } from "@/server/db";
import type { BookingDoc, BookingEventDoc, CustomerDoc, ShipmentDoc, TripDoc } from "@/server/db/schema";
import { discardUploads, formFiles, saveUpload } from "@/server/files/uploads";
import { decodeCursor, pageOf } from "@/server/http/cursor";
import { driverMaySeeContacts, toDriverEventDTO, toDriverShipmentListItem, toDriverShipmentView } from "@/server/views/driver";
import { ctxOf, loadVisibleBooking, requireLinkedDriver } from "./access";

export const TAB_STATUSES: Record<DriverShipmentTab, readonly BookingStatus[]> = {
  pending_pickup: ["confirmed"],
  in_transit: ["picked_up", "in_transit", "out_for_delivery"],
  delivered: ["delivered"],
};

/** Load shipments for list rows (one batched read). */
export async function shipmentsFor(rows: readonly BookingDoc[]): Promise<Map<string, ShipmentDoc>> {
  const ids = [...new Set(rows.map((b) => b.shipmentId))];
  if (ids.length === 0) return new Map();
  const docs = await getDocStore().getMany<ShipmentDoc>(C.shipments, ids);
  const map = new Map<string, ShipmentDoc>();
  for (const s of docs) if (s) map.set(s.id, s);
  return map;
}

export async function toListItems(rows: readonly BookingDoc[]): Promise<DriverShipmentListItem[]> {
  const shipments = await shipmentsFor(rows);
  return rows.map((b) => toDriverShipmentListItem(b, shipments.get(b.shipmentId) ?? null));
}

export async function listShipments(session: SessionContext, q: z.output<typeof DriverShipmentsQuery>): Promise<Page<DriverShipmentListItem>> {
  await requireLinkedDriver(session);
  const statuses = TAB_STATUSES[q.tab];
  const rows = await getDocStore().query<BookingDoc>(C.bookings, {
    where: [
      ["driverId", "==", session.userId],
      statuses.length === 1 ? ["status", "==", statuses[0]] : ["status", "in", statuses],
    ],
    orderBy: [
      ["updatedAt", "desc"],
      ["__name__", "desc"],
    ],
    limit: q.limit + 1,
    startAfter: decodeCursor(q.cursor),
  });
  const page = pageOf(rows, q.limit, (b) => [b.updatedAt, b.id]);
  const items = await toListItems(page.items);
  // To pick up: earliest pickup first (what the driver needs next).
  if (q.tab === "pending_pickup") items.sort((a, b) => (a.pickup.expectedAt < b.pickup.expectedAt ? -1 : a.pickup.expectedAt > b.pickup.expectedAt ? 1 : 0));
  return { items, nextCursor: page.nextCursor };
}

async function eventsOf(bookingId: string): Promise<BookingEventDoc[]> {
  return getDocStore().query<BookingEventDoc>(sub.bookingEvents(bookingId), { orderBy: [["at", "asc"]], limit: 200 });
}

/** Full action-screen view for an assigned booking. */
export async function getShipment(session: SessionContext, bookingId: string): Promise<DriverShipmentDTO> {
  const b = await loadVisibleBooking(session, bookingId);
  return viewOf(b);
}

async function viewOf(b: BookingDoc): Promise<DriverShipmentDTO> {
  const store = getDocStore();
  const [shipment, trip, events, customer] = await Promise.all([
    store.get<ShipmentDoc>(C.shipments, b.shipmentId),
    store.get<TripDoc>(C.trips, b.tripId),
    eventsOf(b.id),
    driverMaySeeContacts(b.status) ? store.get<CustomerDoc>(C.customers, b.customerId) : Promise.resolve(null),
  ]);
  return toDriverShipmentView(b, shipment, trip, events, customer?.phone ?? null);
}

async function afterTransition(session: SessionContext, bookingId: string): Promise<DriverShipmentDTO> {
  return getShipment(session, bookingId);
}

export async function confirmPickup(
  session: SessionContext,
  bookingId: string,
  body: { otp: string; remarks?: string; clientAt?: string },
  now: Date,
): Promise<DriverShipmentDTO> {
  await requireLinkedDriver(session);
  await loadVisibleBooking(session, bookingId);
  await coreBookings.pickup(ctxOf(session, now), bookingId, body.otp, body.remarks || undefined, body.clientAt);
  return afterTransition(session, bookingId);
}

export async function refusePickup(session: SessionContext, bookingId: string, reason: string, now: Date): Promise<DriverShipmentDTO> {
  await requireLinkedDriver(session);
  await loadVisibleBooking(session, bookingId);
  await coreBookings.refusePickup(ctxOf(session, now), bookingId, reason);
  return afterTransition(session, bookingId);
}

export async function startTransit(session: SessionContext, bookingId: string, body: { remarks?: string }, now: Date): Promise<DriverShipmentDTO> {
  await requireLinkedDriver(session);
  await loadVisibleBooking(session, bookingId);
  await coreBookings.startTransit(ctxOf(session, now), bookingId, body.remarks || undefined);
  return afterTransition(session, bookingId);
}

export async function outForDelivery(session: SessionContext, bookingId: string, body: { remarks?: string }, now: Date): Promise<DriverShipmentDTO> {
  await requireLinkedDriver(session);
  await loadVisibleBooking(session, bookingId);
  await coreBookings.outForDelivery(ctxOf(session, now), bookingId, body.remarks || undefined);
  return afterTransition(session, bookingId);
}

/** Combine "received by" and free remarks into the single remarks field core stores. */
export function deliveryRemarks(receivedBy: string | undefined, remarks: string | undefined): string | undefined {
  const who = receivedBy?.trim();
  const parts = [who ? `Received by ${who}.` : "", remarks?.trim() ?? ""].filter(Boolean);
  const text = parts.join(" ");
  return text ? text.slice(0, 300) : undefined;
}

/**
 * multipart: otp, receivedBy?, remarks?, clientAt?, proof (1–3 images).
 * Proofs are uploaded BEFORE the core transaction; if it fails (wrong OTP …) they are discarded.
 * A retry after success is idempotent: an already-delivered booking is returned unchanged.
 */
export async function confirmDelivery(session: SessionContext, bookingId: string, form: FormData, now: Date): Promise<DriverShipmentDTO> {
  await requireLinkedDriver(session);
  const b = await loadVisibleBooking(session, bookingId);
  if (b.status === "delivered") return viewOf(b);
  if (b.status !== "out_for_delivery") throw new DomainError("invalid_transition", "Mark the shipment out for delivery first.");

  const fields = DeliverFields.parse({
    otp: form.get("otp") ?? undefined,
    receivedBy: form.get("receivedBy") || undefined,
    remarks: form.get("remarks") || undefined,
    clientAt: form.get("clientAt") || undefined,
  });
  const files = formFiles(form, "proof");
  if (files.length === 0) throw new DomainError("proof_required", undefined, { fields: { proof: "Add a delivery photo" } });
  if (files.length > MAX_PROOF_FILES)
    throw new DomainError("invalid_request", `Add at most ${MAX_PROOF_FILES} photos.`, { fields: { proof: `At most ${MAX_PROOF_FILES} photos` } });

  const uploaded: string[] = [];
  try {
    for (const file of files) {
      const doc = await saveUpload({ file, kind: "delivery_proof", ownerType: "booking", ownerId: bookingId, uploadedBy: session.userId, now, field: "proof" });
      uploaded.push(doc.id);
    }
    await coreBookings.deliver(ctxOf(session, now), bookingId, {
      otp: fields.otp,
      proofFileIds: uploaded,
      remarks: deliveryRemarks(fields.receivedBy, fields.remarks),
      clientAt: fields.clientAt,
    });
  } catch (e) {
    await discardUploads(uploaded, now).catch(() => undefined);
    throw e;
  }
  return afterTransition(session, bookingId);
}

export async function addRemark(session: SessionContext, bookingId: string, text: string, now: Date): Promise<DriverEventDTO> {
  await requireLinkedDriver(session);
  await loadVisibleBooking(session, bookingId);
  const ev = await coreBookings.addRemark(ctxOf(session, now), bookingId, text);
  return toDriverEventDTO(ev);
}
