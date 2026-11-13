import "server-only";
/**
 * Customer projections (P2 §4.4, D3). The ONLY code that turns documents into customer
 * JSON. Visibility rules:
 *  - driver name / photo and vehicle registration from `pending_payment`; driver phone from `confirmed`;
 *  - pickup / delivery OTPs to the customer only, from `confirmed` until each is used;
 *  - agency and driver ratings at search time; vehicle photos only for signed-in viewers
 *    (the files route requires a session), otherwise the illustrative image key.
 */
import type {
  CustomerBookingDTO,
  CustomerBookingListItem,
  PaymentHistoryItem,
  RouteStopDTO,
  ShipmentDTO,
  ShipmentListItem,
  TrackingDTO,
  TrackingStageDTO,
  TripDetailsDTO,
  TripOfferDTO,
} from "@/lib/api/contracts/customer";
import type { NotificationDTO, ReviewDTO } from "@/lib/api/contracts/common";
import { CANCELLABLE_STATUSES, PAYABLE_STATUSES } from "@/lib/domain/booking-machine";
import { effectiveAvailableKg } from "@/lib/domain/capacity";
import { V2 } from "@/lib/domain/constants";
import { isoDateFromInstant } from "@/lib/domain/dates";
import { OFFER_PROBLEM_MESSAGE, type OfferBadge, type OfferProblem, type TripMatch } from "@/lib/domain/matching";
import type { BookingStatus, PricingBreakdownV2 } from "@/lib/domain/model";
import { districtName } from "@/lib/domain/places/districts";
import { getPlace } from "@/lib/domain/places/places";
import type { TrackingStage } from "../core/tracking";
import type {
  AgencyDoc,
  BookingDoc,
  BookingEventDoc,
  BookingSecretsDoc,
  DriverDoc,
  NotificationDoc,
  PaymentDoc,
  ReviewDoc,
  ShipmentDoc,
  TripDoc,
} from "../db/schema";
import { fileRefUrl, toNotificationDTO, toPaymentSummaryDTO, toReviewDTO } from "./common";

/** Statuses after the agency accepted (driver identity and registration are shared). */
const ACCEPTED_ON: readonly BookingStatus[] = ["pending_payment", "payment_failed", "confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"];
/** Statuses after payment (driver phone shared). */
const CONFIRMED_ON: readonly BookingStatus[] = ["confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"];
/** Statuses where the customer holds OTP codes. */
const OTP_STATUSES: readonly BookingStatus[] = ["confirmed", "picked_up", "in_transit", "out_for_delivery"];

// ── Shipments ────────────────────────────────────────────────────────────────

export function toShipmentDTO(s: ShipmentDoc): ShipmentDTO {
  return {
    id: s.id,
    status: s.status,
    source: s.source,
    destination: s.destination,
    receiver: { name: s.receiver.name, phone: s.receiver.phone },
    package: {
      weightKg: s.package.weightKg,
      goodsCategory: s.package.goodsCategory,
      packageType: s.package.packageType,
      description: s.package.description,
      pieces: s.package.pieces,
      specialHandling: [...s.package.specialHandling],
      declaredValueRupees: s.package.declaredValueRupees,
    },
    shippingDate: s.shippingDate,
    currentBookingId: s.currentBookingId,
    editable: s.status === "open" && s.currentBookingId === null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function toShipmentListItem(s: ShipmentDoc, currentBooking: BookingDoc | null, trip?: TripDoc | null): ShipmentListItem {
  return { ...toShipmentDTO(s), currentBooking: currentBooking ? toBookingListItem(currentBooking, trip) : null };
}

// ── Bookings (list) ──────────────────────────────────────────────────────────

export function toBookingListItem(b: BookingDoc, trip?: TripDoc | null): CustomerBookingListItem {
  const pickupCp = trip?.checkpoints[b.pickup.checkpointIndex];
  const dropCp = trip?.checkpoints[b.drop.checkpointIndex];
  return {
    id: b.id,
    status: b.status,
    tab: b.tab,
    shipmentId: b.shipmentId,
    pickup: { placeName: b.pickup.placeName, districtName: pickupCp?.districtName ?? b.pickup.placeName, expectedDepartureAt: b.pickup.expectedDepartureAt },
    drop: { placeName: b.drop.placeName, districtName: dropCp?.districtName ?? b.drop.placeName, expectedArrivalAt: b.drop.expectedArrivalAt },
    weightKg: b.weightKg,
    goodsCategory: b.goodsCategory,
    totalPayable: b.pricing.totalPayable,
    agencyName: b.display.agencyName,
    vehicleClass: trip?.vehicle.vehicleClass ?? null,
    paymentDueAt: b.paymentDueAt,
    reviewed: b.reviewed,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

// ── Trips / offers ───────────────────────────────────────────────────────────

export interface OfferContext {
  agency: AgencyDoc | null;
  driver: DriverDoc | null;
  /** Vehicle photos are served by the session-checked files route. */
  signedIn: boolean;
  badge?: OfferBadge;
  now: Date;
}

export interface SegmentInfo {
  pickupIndex: number;
  dropIndex: number;
  pickupDepartureAt: string;
  dropArrivalAt: string;
  segmentKm: number;
}

function routeStops(trip: TripDoc, seg: Pick<SegmentInfo, "pickupIndex" | "dropIndex">): RouteStopDTO[] {
  return trip.checkpoints.map((c) => {
    const place = getPlace(c.placeId);
    return {
      index: c.index,
      placeName: c.placeName,
      districtName: c.districtName,
      state: c.state,
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
      kmFromOrigin: c.kmFromOrigin,
      expectedArrivalAt: c.expectedArrivalAt,
      expectedDepartureAt: c.expectedDepartureAt,
      inSegment: c.index >= seg.pickupIndex && c.index <= seg.dropIndex,
      role: c.index === seg.pickupIndex ? "pickup" : c.index === seg.dropIndex ? "drop" : null,
    };
  });
}

export function toTripOfferDTO(trip: TripDoc, seg: SegmentInfo, pricing: PricingBreakdownV2, ctx: OfferContext): TripOfferDTO {
  const pickup = trip.checkpoints[seg.pickupIndex]!;
  const drop = trip.checkpoints[seg.dropIndex]!;
  return {
    tripId: trip.id,
    agency: {
      id: trip.agencyId,
      name: ctx.agency?.agencyName ?? trip.agencyName,
      ratingAvg: ctx.agency?.stats.ratingAvg ?? 0,
      ratingCount: ctx.agency?.stats.ratingCount ?? 0,
      verified: ctx.agency ? ctx.agency.verification.status === "verified" : false,
    },
    driver: {
      ratingAvg: ctx.driver?.stats.ratingAvg ?? trip.driver.ratingAvg,
      ratingCount: ctx.driver?.stats.ratingCount ?? trip.driver.ratingCount,
      deliveries: ctx.driver?.stats.delivered ?? 0,
    },
    vehicle: {
      vehicleClass: trip.vehicle.vehicleClass,
      makeModel: trip.vehicle.makeModel,
      bodyType: trip.vehicle.bodyType,
      photoUrl: ctx.signedIn ? fileRefUrl(trip.vehicle.photo) : null,
      imageKey: trip.vehicle.imageKey,
    },
    pickup: { checkpointIndex: pickup.index, placeName: pickup.placeName, districtName: pickup.districtName, expectedDepartureAt: seg.pickupDepartureAt },
    drop: { checkpointIndex: drop.index, placeName: drop.placeName, districtName: drop.districtName, expectedArrivalAt: seg.dropArrivalAt },
    route: routeStops(trip, seg),
    tripDepartureAt: trip.departureAt,
    tripArrivalAt: trip.arrivalAt,
    segmentKm: seg.segmentKm,
    availableCapacityKg: effectiveAvailableKg(trip, ctx.now),
    offeredCapacityKg: trip.capacity.offeredKg,
    goods: { accepted: [...trip.goods.accepted], handlingSupported: [...trip.goods.handlingSupported], maxPackageKg: trip.goods.maxPackageKg, notes: trip.goods.notes },
    rates: { ...trip.rates },
    pricing,
    ...(ctx.badge ? { badge: ctx.badge } : {}),
  };
}

export function offerFromMatch(trip: TripDoc, match: TripMatch, ctx: OfferContext): TripOfferDTO {
  return toTripOfferDTO(trip, match, match.pricing, ctx);
}

export function toTripDetailsDTO(
  trip: TripDoc,
  match: TripMatch,
  ctx: OfferContext & { reviews: ReviewDoc[]; problem: OfferProblem | null; existingBookingId: string | null },
): TripDetailsDTO {
  const agency = ctx.agency;
  return {
    ...offerFromMatch(trip, match, ctx),
    reviews: ctx.reviews.map(toReviewDTO),
    agencyInfo: {
      districtName: agency ? districtName(agency.districtId) : "",
      statesCovered: agency ? [...agency.statesCovered] : [],
      memberSince: agency ? isoDateFromInstant(agency.createdAt) : isoDateFromInstant(trip.createdAt),
      delivered: agency?.stats.delivered ?? 0,
    },
    problem: ctx.problem,
    problemMessage: ctx.problem ? OFFER_PROBLEM_MESSAGE[ctx.problem] : null,
    existingBookingId: ctx.existingBookingId,
  };
}

// ── Booking (full) ───────────────────────────────────────────────────────────

export interface BookingViewInput {
  booking: BookingDoc;
  shipment: ShipmentDoc;
  trip: TripDoc;
  agency: AgencyDoc | null;
  driver: DriverDoc | null;
  payment: PaymentDoc | null;
  secrets: BookingSecretsDoc | null;
  review: ReviewDoc | null;
  now: Date;
}

/** `toCustomerBookingView` (P2 §4.4). */
export function toCustomerBookingView(i: BookingViewInput): CustomerBookingDTO {
  const { booking: b, trip, now } = i;
  const accepted = ACCEPTED_ON.includes(b.status);
  const confirmed = CONFIRMED_ON.includes(b.status);
  const seg: SegmentInfo = {
    pickupIndex: b.pickup.checkpointIndex,
    dropIndex: b.drop.checkpointIndex,
    pickupDepartureAt: b.pickup.expectedDepartureAt,
    dropArrivalAt: b.drop.expectedArrivalAt,
    segmentKm: b.pricing.distanceKm,
  };
  const tripView = toTripOfferDTO(trip, seg, b.pricing, { agency: i.agency, driver: i.driver, signedIn: true, now });

  let otps: CustomerBookingDTO["otps"] = null;
  if (OTP_STATUSES.includes(b.status) && i.secrets) {
    const s = i.secrets;
    const pickupUsed = s.pickupUsedAt !== null || b.status !== "confirmed";
    const deliveryUsed = s.deliveryUsedAt !== null;
    otps = {
      pickup: pickupUsed ? null : s.pickupOtp,
      delivery: deliveryUsed ? null : s.deliveryOtp,
      pickupUsed,
      deliveryUsed,
      pickupLocked: !pickupUsed && s.pickupAttempts >= V2.otpAttempts,
      deliveryLocked: !deliveryUsed && s.deliveryAttempts >= V2.otpAttempts,
    };
  }

  const windowOpen = b.paymentDueAt === null || Date.parse(b.paymentDueAt) > now.getTime();
  return {
    id: b.id,
    status: b.status,
    tab: b.tab,
    shipment: toShipmentDTO(i.shipment),
    trip: tripView,
    pricing: b.pricing,
    respondBy: b.respondBy,
    acceptedAt: b.acceptedAt,
    paymentDueAt: b.paymentDueAt,
    paidAt: b.paidAt,
    payment: i.payment ? toPaymentSummaryDTO(i.payment) : null,
    driver:
      accepted && i.driver
        ? {
            name: i.driver.fullName,
            photoUrl: fileRefUrl(i.driver.photo),
            phone: confirmed ? i.driver.phone : null,
            ratingAvg: i.driver.stats.ratingAvg,
            ratingCount: i.driver.stats.ratingCount,
          }
        : accepted
          ? { name: b.display.driverName || trip.driver.fullName, photoUrl: fileRefUrl(trip.driver.photo), phone: null, ratingAvg: trip.driver.ratingAvg, ratingCount: trip.driver.ratingCount }
          : null,
    vehicle: accepted
      ? {
          vehicleClass: trip.vehicle.vehicleClass,
          makeModel: trip.vehicle.makeModel,
          registrationNumber: trip.vehicle.registrationNumber,
          bodyType: trip.vehicle.bodyType,
          imageKey: trip.vehicle.imageKey,
          photoUrl: fileRefUrl(trip.vehicle.photo),
        }
      : null,
    otps,
    rejection: b.rejection,
    cancellation: b.cancellation ? { reason: b.cancellation.reason, note: b.cancellation.note, at: b.cancellation.at, byRole: b.cancellation.by.role } : null,
    statusHistory: b.statusHistory.map((h) => ({ status: h.status, at: h.at })),
    canCancel: CANCELLABLE_STATUSES.includes(b.status),
    canPay: PAYABLE_STATUSES.includes(b.status) && windowOpen,
    canReview: b.status === "delivered" && !b.reviewed,
    review: i.review ? toReviewDTO(i.review) : null,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

// ── Tracking ─────────────────────────────────────────────────────────────────

export function toTrackingDTO(b: BookingDoc, stages: readonly TrackingStage[], events: readonly BookingEventDoc[]): TrackingDTO {
  const proofUrls = events.flatMap((e) => (e.type === "delivered" || e.type === "delivery_proof_added" ? e.files.map((f) => fileRefUrl(f)!) : []));
  return {
    bookingId: b.id,
    status: b.status,
    stages: stages.map(
      (s): TrackingStageDTO => ({
        key: s.key,
        label: s.label,
        state: s.state,
        at: s.at,
        checkpointIndex: s.checkpointIndex,
        placeName: s.placeName,
        expectedAt: s.expectedAt,
        departedAt: s.departedAt,
        note: s.note,
      }),
    ),
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      at: e.at,
      placeName: e.placeName,
      remarks: e.remarks,
      actorRole: e.actor.role,
      fileUrls: e.files.map((f) => fileRefUrl(f)!),
    })),
    proofUrls,
    liveLocation: null,
  };
}

// ── Payments / reviews / notifications ───────────────────────────────────────

export function toPaymentHistoryItem(p: PaymentDoc, booking: BookingDoc | null): PaymentHistoryItem {
  const s = toPaymentSummaryDTO(p);
  return {
    id: p.id,
    bookingId: p.bookingId,
    status: s.status,
    provider: s.provider,
    amountRupees: s.amountRupees,
    methodLabel: s.methodLabel,
    createdAt: p.createdAt,
    paidAt: s.paidAt,
    refund: s.refund,
    routeLabel: booking ? `${booking.pickup.placeName} → ${booking.drop.placeName}` : null,
  };
}

export function toCustomerReview(r: ReviewDoc): ReviewDTO {
  return toReviewDTO(r);
}

export function toCustomerNotification(n: NotificationDoc): NotificationDTO {
  return toNotificationDTO(n);
}
