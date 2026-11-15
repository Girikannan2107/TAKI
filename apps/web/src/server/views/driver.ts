import "server-only";
/**
 * Driver projections (P2 §4.4). The ONLY code that turns booking / shipment / trip documents
 * into driver JSON. Rules:
 *  - a driver sees a booking only when it is assigned to them (`booking.driverId === viewer`)
 *    and the booking reached `confirmed` (paid);
 *  - customer + receiver phone numbers and full addresses are included only while the booking
 *    is active for the driver (confirmed … delivered). A cancelled booking keeps names only;
 *  - pricing and OTPs are never included.
 */
import { fileUrl } from "@/lib/api/contracts/common";
import type {
  DriverAddressDTO,
  DriverCheckpointBriefDTO,
  DriverEventDTO,
  DriverShipmentAction,
  DriverShipmentDTO,
  DriverShipmentListItem,
  DriverTripBookingRef,
  DriverTripDTO,
  DriverTripEventDTO,
  DriverTripListItem,
  DriverTripNextStep,
} from "@/lib/api/contracts/driver";
import { DRIVER_VISIBLE_STATUSES, statusReachedAt } from "@/lib/domain/booking-machine";
import type { Address, BookingStatus } from "@/lib/domain/model";
import { districtName } from "@/lib/domain/places/districts";
import type { BookingDoc, BookingEventDoc, ShipmentDoc, TripDoc, TripEventDoc } from "../db/schema";

/** Statuses where the driver may see contacts and full addresses. */
export function driverMaySeeContacts(status: BookingStatus): boolean {
  return DRIVER_VISIBLE_STATUSES.includes(status);
}

/** True when the booking belongs to this driver's view at all (assigned + reached confirmed). */
export function isVisibleToDriver(b: BookingDoc, driverId: string): boolean {
  if (b.driverId !== driverId) return false;
  if (DRIVER_VISIBLE_STATUSES.includes(b.status)) return true;
  // A booking cancelled after confirmation (refused pickup, customer cancel) stays visible as a record.
  return b.status === "cancelled" && b.statusHistory.some((h) => h.status === "confirmed");
}

function shortAddress(a: Address | undefined): string {
  if (!a) return "";
  const line = a.line1.length > 48 ? `${a.line1.slice(0, 47)}…` : a.line1;
  return `${line}, ${a.districtName}`;
}

export function mapsUrl(a: Address): string {
  if (a.location) return `https://www.google.com/maps/search/?api=1&query=${a.location.lat},${a.location.lng}`;
  const q = [a.line1, a.line2, a.landmark, a.districtName, a.pincode].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function toAddress(a: Address): DriverAddressDTO {
  return {
    line1: a.line1,
    line2: a.line2 ?? null,
    landmark: a.landmark ?? null,
    districtName: a.districtName,
    state: a.state,
    pincode: a.pincode,
    mapsUrl: mapsUrl(a),
  };
}

export function toDriverShipmentListItem(b: BookingDoc, s: ShipmentDoc | null): DriverShipmentListItem {
  const contacts = driverMaySeeContacts(b.status);
  return {
    bookingId: b.id,
    tripId: b.tripId,
    status: b.status,
    customerName: b.display.customerName,
    receiverName: s?.receiver.name ?? "Receiver",
    pickup: {
      checkpointIndex: b.pickup.checkpointIndex,
      placeName: b.pickup.placeName,
      districtName: districtName(b.pickup.districtId),
      district: districtName(b.pickup.districtId),
      expectedAt: b.pickup.expectedDepartureAt,
      shortAddress: contacts ? shortAddress(s?.source) : districtName(b.pickup.districtId),
    },
    drop: {
      checkpointIndex: b.drop.checkpointIndex,
      placeName: b.drop.placeName,
      districtName: districtName(b.drop.districtId),
      district: districtName(b.drop.districtId),
      expectedAt: b.drop.expectedArrivalAt,
      shortAddress: contacts ? shortAddress(s?.destination) : districtName(b.drop.districtId),
    },
    package: {
      weightKg: b.weightKg,
      pieces: s?.package.pieces ?? 1,
      packageType: s?.package.packageType ?? "other",
      goodsCategory: b.goodsCategory,
      specialHandling: b.specialHandling,
    },
    trip: { id: b.tripId, routeLabel: b.display.routeLabel, departureAt: b.display.tripDepartureAt, vehicleReg: b.display.vehicleReg },
    updatedAt: b.updatedAt,
    deliveredAt: b.status === "delivered" ? statusReachedAt(b, "delivered") : null,
  };
}

/** Which actions the driver may attempt now (the server re-checks every guard in core). */
export function allowedActions(b: BookingDoc, trip: Pick<TripDoc, "status"> | null): DriverShipmentAction[] {
  const tripRunning = !trip || trip.status === "published" || trip.status === "in_progress";
  switch (b.status) {
    case "confirmed":
      return tripRunning ? ["pickup", "refuse_pickup", "remark"] : ["remark"];
    case "picked_up":
      return ["start_transit", "remark"];
    case "in_transit":
      return ["out_for_delivery", "remark"];
    case "out_for_delivery":
      return ["deliver", "remark"];
    default:
      return [];
  }
}

export function toDriverEventDTO(e: BookingEventDoc): DriverEventDTO {
  return {
    id: e.id,
    type: e.type,
    at: e.at,
    clientAt: e.clientAt,
    placeName: e.placeName,
    remarks: e.remarks,
    fileUrls: e.files.map((f) => fileUrl(f.fileId)),
    byRole: e.actor.role,
  };
}

function checkpointBriefs(b: BookingDoc, trip: TripDoc | null): DriverCheckpointBriefDTO[] {
  if (!trip) return [];
  return trip.checkpoints
    .filter((c) => c.index >= b.pickup.checkpointIndex && c.index <= b.drop.checkpointIndex)
    .map((c) => ({
      index: c.index,
      placeName: c.placeName,
      districtName: c.districtName,
      expectedArrivalAt: c.expectedArrivalAt,
      expectedDepartureAt: c.expectedDepartureAt,
      actualArrivalAt: c.actualArrivalAt,
      actualDepartureAt: c.actualDepartureAt,
      isPickup: c.index === b.pickup.checkpointIndex,
      isDrop: c.index === b.drop.checkpointIndex,
    }));
}

/** Full shipment view for the assigned driver. Callers must check `isVisibleToDriver` first. */
export function toDriverShipmentView(
  b: BookingDoc,
  s: ShipmentDoc | null,
  trip: TripDoc | null,
  events: readonly BookingEventDoc[],
  /** From customers/{customerId}; dropped unless contacts are visible. */
  customerPhone: string | null,
): DriverShipmentDTO {
  const contacts = driverMaySeeContacts(b.status);
  const ordered = [...events].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  const deliveredEvent = [...ordered].reverse().find((e) => e.type === "delivered");
  const proofFiles = ordered.filter((e) => e.type === "delivered" || e.type === "delivery_proof_added").flatMap((e) => e.files);
  return {
    ...toDriverShipmentListItem(b, s),
    customer: { name: b.display.customerName, phone: contacts ? customerPhone : null },
    receiver: { name: s?.receiver.name ?? "Receiver", phone: contacts ? (s?.receiver.phone ?? null) : null },
    pickupAddress: contacts && s ? toAddress(s.source) : null,
    dropAddress: contacts && s ? toAddress(s.destination) : null,
    description: contacts ? (s?.package.description ?? null) : null,
    tripStatus: trip?.status ?? "published",
    vehicle: {
      registrationNumber: trip?.vehicle.registrationNumber ?? b.display.vehicleReg,
      vehicleClass: trip?.vehicle.vehicleClass ?? "",
      makeModel: trip?.vehicle.makeModel ?? "",
    },
    checkpoints: checkpointBriefs(b, trip),
    events: ordered.map(toDriverEventDTO),
    delivery:
      b.status === "delivered"
        ? {
            at: deliveredEvent?.at ?? statusReachedAt(b, "delivered") ?? b.updatedAt,
            proofUrls: [...new Set(proofFiles.map((f) => fileUrl(f.fileId)))],
            remarks: deliveredEvent?.remarks ?? null,
          }
        : null,
    cancellation: b.cancellation ? { at: b.cancellation.at, note: b.cancellation.note, reason: b.cancellation.reason } : null,
    allowedActions: allowedActions(b, trip),
  };
}

// ── Trips ────────────────────────────────────────────────────────────────────
export function nextTripStep(t: TripDoc): DriverTripNextStep | null {
  if (t.status !== "published" && t.status !== "in_progress") return null;
  const last = t.checkpoints.length - 1;
  for (const c of t.checkpoints) {
    if (c.index > 0 && !c.actualArrivalAt) return { kind: "arrive", index: c.index, placeName: c.placeName, expectedAt: c.expectedArrivalAt };
    if (c.index < last && !c.actualDepartureAt) return { kind: "depart", index: c.index, placeName: c.placeName, expectedAt: c.expectedDepartureAt };
  }
  return null;
}

function capacityOf(t: TripDoc): { offeredKg: number; bookedKg: number; reservedKg: number } {
  let bookedKg = 0;
  let reservedKg = 0;
  for (const h of Object.values(t.holds ?? {})) {
    if (h.kind === "paid") bookedKg += h.kg;
    else reservedKg += h.kg;
  }
  return { offeredKg: t.capacity.offeredKg, bookedKg, reservedKg };
}

export function toDriverTripListItem(t: TripDoc): DriverTripListItem {
  const first = t.checkpoints[0];
  const last = t.checkpoints[t.checkpoints.length - 1];
  const originName = first?.placeName ?? "";
  const destinationName = last?.placeName ?? "";
  return {
    id: t.id,
    status: t.status,
    routeLabel: `${originName} → ${destinationName}`,
    originName,
    destinationName,
    departureAt: t.departureAt,
    arrivalAt: t.arrivalAt,
    agencyName: t.agencyName,
    vehicle: { registrationNumber: t.vehicle.registrationNumber, vehicleClass: t.vehicle.vehicleClass, makeModel: t.vehicle.makeModel },
    capacity: capacityOf(t),
    checkpointCount: t.checkpoints.length,
    nextStep: nextTripStep(t),
    shipmentCount: Object.values(t.holds ?? {}).filter((h) => h.kind === "paid").length,
  };
}

function toTripEventDTO(e: TripEventDoc): DriverTripEventDTO {
  return { id: e.id, type: e.type, checkpointIndex: e.checkpointIndex, at: e.at, clientAt: e.clientAt, remarks: e.remarks };
}

/**
 * Trip run view. `bookings` = this trip's bookings (any status; filtered here to the ones the
 * driver may see), `shipments` by id for receiver names.
 */
export function toDriverTripView(
  t: TripDoc,
  bookings: readonly BookingDoc[],
  shipments: ReadonlyMap<string, ShipmentDoc>,
  events: readonly TripEventDoc[],
  driverId: string,
): DriverTripDTO {
  const visible = bookings.filter((b) => b.driverId === driverId && DRIVER_VISIBLE_STATUSES.includes(b.status));
  const ref = (b: BookingDoc): DriverTripBookingRef => ({
    bookingId: b.id,
    customerName: b.display.customerName,
    receiverName: shipments.get(b.shipmentId)?.receiver.name ?? null,
    weightKg: b.weightKg,
    status: b.status,
  });
  const last = t.checkpoints[t.checkpoints.length - 1];
  const arrivedAtEnd = !!last?.actualArrivalAt;
  const held = bookings.filter((b) => b.driverId === driverId && ["confirmed", "picked_up", "in_transit", "out_for_delivery"].includes(b.status));
  return {
    ...toDriverTripListItem(t),
    checkpoints: t.checkpoints.map((c) => ({
      index: c.index,
      placeName: c.placeName,
      districtName: c.districtName,
      state: c.state,
      kmFromOrigin: c.kmFromOrigin,
      expectedArrivalAt: c.expectedArrivalAt,
      expectedDepartureAt: c.expectedDepartureAt,
      actualArrivalAt: c.actualArrivalAt,
      actualDepartureAt: c.actualDepartureAt,
      pickups: visible.filter((b) => b.pickup.checkpointIndex === c.index).map(ref),
      drops: visible.filter((b) => b.drop.checkpointIndex === c.index).map(ref),
    })),
    events: [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map(toTripEventDTO),
    canComplete: t.status === "in_progress" && arrivedAtEnd && held.length === 0,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
  };
}
