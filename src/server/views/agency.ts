import "server-only";
/**
 * Agency role projections (P2 §4.4). The ONLY code that turns documents into agency JSON.
 * Customer PII is gated by booking status:
 *   - customer name: always; customer phone + full addresses: from acceptance (pending_payment);
 *   - receiver name + phone: from confirmation (confirmed and later).
 * Identity documents of linked drivers are exposed masked, with access-checked file URLs only.
 */
import {
  agencyTabOf,
  type AgencyBookingDTO,
  type AgencyBookingListItem,
  type AgencyDriverDTO,
  type AgencyTripDTO,
  type AgencyTripListItem,
  type BookingTimelineEntry,
  type InviteDTO,
  type ScheduleSlotDTO,
  type TripCapacityDTO,
  type TripCheckpointDTO,
  type VehicleDTO,
} from "@/lib/api/contracts/agency";
import { fileUrl } from "@/lib/api/contracts/common";
import { isHoldActive } from "@/lib/domain/capacity";
import type { BookingStatus } from "@/lib/domain/model";
import { getDistrict } from "@/lib/domain/places/districts";
import type {
  BookingDoc,
  BookingEventDoc,
  CustomerDoc,
  DriverDoc,
  DriverInviteDoc,
  PaymentDoc,
  ScheduleDoc,
  ShipmentDoc,
  TripDoc,
  VehicleDoc,
} from "../db/schema";
import { fileRefUrl, maskPhone } from "./common";

const ACCEPTED_OR_LATER: readonly BookingStatus[] = [
  "pending_payment",
  "payment_failed",
  "confirmed",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
];
const CONFIRMED_OR_LATER: readonly BookingStatus[] = ["confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"];

/** Was the booking accepted at some point (phone/addresses shared)? Cancelled-after-accept keeps sharing off. */
export function agencySeesContact(status: BookingStatus): boolean {
  return ACCEPTED_OR_LATER.includes(status);
}
export function agencySeesReceiver(status: BookingStatus): boolean {
  return CONFIRMED_OR_LATER.includes(status);
}

// ── Vehicles ─────────────────────────────────────────────────────────────────
export function toVehicleDTO(v: VehicleDoc, activeTrips = 0): VehicleDTO {
  return {
    id: v.id,
    vehicleClass: v.vehicleClass,
    modelId: v.modelId,
    makeModel: v.makeModel,
    registrationNumber: v.registrationNumber,
    maxPayloadKg: v.maxPayloadKg,
    bodyType: v.bodyType,
    dimensionsFt: v.dimensionsFt,
    acceptedGoods: v.acceptedGoods,
    handlingSupported: v.handlingSupported,
    photos: v.photos.map((p) => ({ fileId: p.fileId, url: fileUrl(p.fileId) })),
    imageKey: v.imageKey,
    status: v.status,
    activeTrips,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

// ── Drivers ──────────────────────────────────────────────────────────────────
export function scheduleSlots(schedule: ScheduleDoc | null, now: Date): ScheduleSlotDTO[] {
  if (!schedule) return [];
  return schedule.intervals
    .filter((iv) => Date.parse(iv.to) > now.getTime())
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((iv) => ({ tripId: iv.tripId, from: iv.from, to: iv.to }));
}

export function toAgencyDriverDTO(d: DriverDoc, schedule: ScheduleDoc | null, now: Date): AgencyDriverDTO {
  const link = d.agencyLink!;
  const license = (d.license ?? null) as DriverDoc["license"] | null;
  const aadhaar = (d.aadhaar ?? null) as DriverDoc["aadhaar"] | null;
  return {
    id: d.id,
    fullName: d.fullName,
    phone: d.phone,
    phoneMasked: maskPhone(d.phone),
    photoUrl: fileRefUrl(d.photo ?? null),
    license: { numberMasked: license?.numberMasked ?? null, fileUrl: fileRefUrl(license?.file ?? null), validUntil: license?.validUntil ?? null },
    aadhaar: { numberMasked: aadhaar?.numberMasked ?? null, fileUrl: fileRefUrl(aadhaar?.file ?? null) },
    link: { status: link.status, via: link.via, requestedAt: link.requestedAt, decidedAt: link.decidedAt },
    availability: d.availability,
    verification: d.verification?.status ?? "pending",
    stats: d.stats,
    nextAssignment: scheduleSlots(schedule, now)[0] ?? null,
  };
}

export function toInviteDTO(i: DriverInviteDoc, now: Date): InviteDTO {
  const expired = i.status === "pending" && Date.parse(i.expiresAt) <= now.getTime();
  return {
    id: i.id,
    fullName: i.fullName,
    phone: i.phone,
    phoneMasked: maskPhone(i.phone),
    status: expired ? "expired" : i.status,
    expiresAt: i.expiresAt,
    createdAt: i.createdAt,
  };
}

// ── Trips ────────────────────────────────────────────────────────────────────
export function tripCapacity(t: TripDoc, now: Date): TripCapacityDTO {
  let booked = 0;
  let reserved = 0;
  for (const h of Object.values(t.holds ?? {})) {
    if (!isHoldActive(h, now)) continue;
    if (h.kind === "paid") booked += h.kg;
    else reserved += h.kg;
  }
  return {
    vehicleMaxKg: t.capacity.vehicleMaxKg,
    offeredKg: t.capacity.offeredKg,
    bookedKg: booked,
    reservedKg: reserved,
    availableKg: Math.max(0, t.capacity.offeredKg - booked - reserved),
  };
}

export function tripRouteLabel(t: Pick<TripDoc, "checkpoints">): string {
  const cps = t.checkpoints;
  if (cps.length === 0) return "";
  return `${cps[0]!.placeName} → ${cps[cps.length - 1]!.placeName}`;
}

export function toAgencyTripListItem(t: TripDoc, now: Date): AgencyTripListItem {
  return {
    id: t.id,
    status: t.status,
    routeLabel: tripRouteLabel(t),
    stops: t.checkpoints.map((c) => c.placeName),
    departureAt: t.departureAt,
    arrivalAt: t.arrivalAt,
    distanceKm: t.distanceKm,
    vehicle: {
      id: t.vehicleId,
      registrationNumber: t.vehicle.registrationNumber,
      vehicleClass: t.vehicle.vehicleClass,
      makeModel: t.vehicle.makeModel,
      imageKey: t.vehicle.imageKey,
    },
    driver: { id: t.driverId, fullName: t.driver.fullName, photoUrl: fileRefUrl(t.driver.photo) },
    capacity: tripCapacity(t, now),
    counts: t.counts,
    rates: { perKmPaise: t.rates.perKmPaise, perKgPaise: t.rates.perKgPaise, handlingFeeRupees: t.rates.handlingFeeRupees },
    departed: t.status === "published" && Date.parse(t.departureAt) <= now.getTime(),
    publishedAt: t.publishedAt,
    updatedAt: t.updatedAt,
  };
}

export function toTripCheckpointDTO(c: TripDoc["checkpoints"][number]): TripCheckpointDTO {
  return {
    index: c.index,
    placeId: c.placeId,
    placeName: c.placeName,
    districtId: c.districtId,
    districtName: c.districtName,
    state: c.state,
    kmFromOrigin: c.kmFromOrigin,
    expectedArrivalAt: c.expectedArrivalAt,
    expectedDepartureAt: c.expectedDepartureAt,
    actualArrivalAt: c.actualArrivalAt,
    actualDepartureAt: c.actualDepartureAt,
  };
}

export function toAgencyTripDTO(t: TripDoc, bookings: readonly BookingDoc[], publishBlockers: string[], now: Date): AgencyTripDTO {
  const tripById = new Map([[t.id, t]]);
  return {
    ...toAgencyTripListItem(t, now),
    checkpoints: t.checkpoints.map(toTripCheckpointDTO),
    goods: { accepted: t.goods.accepted, handlingSupported: t.goods.handlingSupported, maxPackageKg: t.goods.maxPackageKg, notes: t.goods.notes },
    cancelReason: t.cancelReason,
    cancelledAt: t.cancelledAt,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    bookings: bookings.map((b) => toAgencyBookingListItem(b, tripById, now)),
    publishBlockers,
  };
}

// ── Bookings ─────────────────────────────────────────────────────────────────
export function toAgencyBookingListItem(b: BookingDoc, trips: ReadonlyMap<string, TripDoc>, now: Date): AgencyBookingListItem {
  const trip = trips.get(b.tripId);
  let capacity: AgencyBookingListItem["capacity"] = null;
  if (b.status === "awaiting_agency" && trip) {
    const available = tripCapacity(trip, now).availableKg;
    capacity = { availableKg: available, afterAcceptKg: available - b.weightKg };
  }
  return {
    id: b.id,
    status: b.status,
    tab: agencyTabOf(b.status),
    tripId: b.tripId,
    customerName: b.display.customerName,
    pickup: { placeName: b.pickup.placeName, districtId: b.pickup.districtId, expectedDepartureAt: b.pickup.expectedDepartureAt },
    drop: { placeName: b.drop.placeName, districtId: b.drop.districtId, expectedArrivalAt: b.drop.expectedArrivalAt },
    weightKg: b.weightKg,
    goodsCategory: b.goodsCategory,
    specialHandling: b.specialHandling ?? [],
    tripDepartureAt: b.display.tripDepartureAt,
    vehicleReg: b.display.vehicleReg,
    driverName: b.display.driverName,
    routeLabel: b.display.routeLabel,
    earnings: b.pricing.transportationCharge + b.pricing.handlingFee,
    totalPayable: b.pricing.totalPayable,
    respondBy: b.respondBy,
    paymentDueAt: b.paymentDueAt,
    capacity,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function addressLine(a: ShipmentDoc["source"]): string {
  return [a.line1, a.line2, a.landmark].filter((x) => x && x.trim()).join(", ");
}

const PUBLIC_TIMELINE: ReadonlySet<string> = new Set([
  "requested",
  "accepted",
  "rejected",
  "payment_succeeded",
  "payment_failed",
  "confirmed",
  "cancelled",
  "picked_up",
  "in_transit",
  "checkpoint_arrived",
  "checkpoint_departed",
  "out_for_delivery",
  "delivered",
  "delivery_proof_added",
  "remark",
]);

export function toTimeline(events: readonly BookingEventDoc[]): BookingTimelineEntry[] {
  return [...events]
    .filter((e) => PUBLIC_TIMELINE.has(e.type))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((e) => ({ type: e.type, at: e.at, placeName: e.placeName, remarks: e.remarks, proofUrls: (e.files ?? []).map((f) => fileUrl(f.fileId)) }));
}

/** Latest payment that matters for the agency view (succeeded/refund over pending over others). */
function primaryPayment(payments: readonly PaymentDoc[]): PaymentDoc | null {
  if (payments.length === 0) return null;
  const rank = (p: PaymentDoc) => (p.status === "succeeded" || p.status.startsWith("refund") ? 3 : p.status === "pending" || p.status === "created" ? 2 : 1);
  return [...payments].sort((a, b) => rank(b) - rank(a) || b.createdAt.localeCompare(a.createdAt))[0]!;
}

export function toAgencyBookingDTO(i: {
  booking: BookingDoc;
  shipment: ShipmentDoc | null;
  trip: TripDoc | null;
  customer: CustomerDoc | null;
  payments: readonly PaymentDoc[];
  events: readonly BookingEventDoc[];
  now: Date;
}): AgencyBookingDTO {
  const { booking: b, shipment: s, trip: t, now } = i;
  const trips = new Map<string, TripDoc>(t ? [[t.id, t]] : []);
  const contact = agencySeesContact(b.status);
  const receiver = agencySeesReceiver(b.status);
  const pay = primaryPayment(i.payments);
  const addr = (a: ShipmentDoc["source"] | undefined, fallbackDistrictId: string) => ({
    line: contact && a ? addressLine(a) : null,
    districtName: a?.districtName ?? getDistrict(fallbackDistrictId)?.name ?? fallbackDistrictId,
    state: a?.state ?? getDistrict(fallbackDistrictId)?.state ?? "TN",
    pincode: contact && a ? a.pincode : null,
  });
  return {
    ...toAgencyBookingListItem(b, trips, now),
    customer: { name: b.display.customerName, phone: contact ? (i.customer?.phone ?? null) : null },
    receiver: receiver && s ? { name: s.receiver.name, phone: s.receiver.phone } : null,
    addresses: { pickup: addr(s?.source, b.pickup.districtId), drop: addr(s?.destination, b.drop.districtId) },
    package: s
      ? {
          weightKg: s.package.weightKg,
          goodsCategory: s.package.goodsCategory,
          packageType: s.package.packageType,
          description: s.package.description,
          pieces: s.package.pieces,
          specialHandling: s.package.specialHandling,
          declaredValueRupees: s.package.declaredValueRupees,
        }
      : { weightKg: b.weightKg, goodsCategory: b.goodsCategory, packageType: "other", description: "", pieces: 1, specialHandling: b.specialHandling ?? [], declaredValueRupees: null },
    shippingDate: s?.shippingDate ?? b.pickup.expectedDepartureAt.slice(0, 10),
    pricing: b.pricing,
    payment: pay
      ? {
          status: pay.status,
          amountRupees: Math.round(pay.amountPaise / 100),
          methodLabel: pay.methodLabel,
          paidAt: pay.confirmation && (pay.status === "succeeded" || pay.status.startsWith("refund")) ? pay.confirmation.at : null,
        }
      : null,
    trip: t
      ? { id: t.id, status: t.status, routeLabel: tripRouteLabel(t), departureAt: t.departureAt, vehicleReg: t.vehicle.registrationNumber, driverName: t.driver.fullName }
      : null,
    rejection: b.rejection ? { note: b.rejection.note, at: b.rejection.at } : null,
    cancellation: b.cancellation ? { reason: b.cancellation.reason, note: b.cancellation.note, at: b.cancellation.at } : null,
    timeline: toTimeline(i.events),
    sharedWithDriver: receiver,
  };
}
