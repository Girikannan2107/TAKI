/**
 * Customer API contract (P2 §8.4, D3). Isomorphic: zod schemas are used by the route
 * handlers AND by the customer forms; DTO interfaces are what the endpoints return.
 */
import { z } from "zod";
import { LIMITS, V2 } from "@/lib/domain/constants";
import { addDaysIso, isIsoDate } from "@/lib/domain/dates";
import { OFFER_SORTS, type OfferBadge, type OfferProblem, type OfferSort } from "@/lib/domain/matching";
import type {
  Address,
  BodyType,
  BookingStatus,
  CancelReason,
  CustomerTab,
  GoodsCategory,
  IsoDate,
  IsoDateTime,
  PackageType,
  PricingBreakdownV2,
  RejectReason,
  SpecialHandling,
  StateCode,
  TrackingEventType,
  VehicleClass,
  VehicleImageKey,
} from "@/lib/domain/model";
import { CUSTOMER_TABS } from "@/lib/domain/model";
import {
  AddressSchema,
  BookingIdSchema,
  CursorQuery,
  DistrictIdSchema,
  GoodsCategorySchema,
  IdSchema,
  PackageTypeSchema,
  PhoneSchema,
  QueryBool,
  SpecialHandlingSchema,
  VehicleClassSchema,
  type NotificationDTO,
  type PaymentSummaryDTO,
  type ReviewDTO,
} from "./common";

export type { OfferBadge, OfferProblem, OfferSort };

// ── Request schemas ──────────────────────────────────────────────────────────

export const ShipmentPackageSchema = z.object({
  weightKg: z
    .number({ error: "Enter the weight in kg" })
    .int("Enter a whole number of kg")
    .min(LIMITS.weightKg.min, `Minimum ${LIMITS.weightKg.min} kg`)
    .max(LIMITS.weightKg.max, `Maximum ${LIMITS.weightKg.max.toLocaleString("en-IN")} kg`),
  goodsCategory: GoodsCategorySchema,
  packageType: PackageTypeSchema,
  description: z.string().trim().min(3, "Describe the goods (at least 3 characters)").max(300, "Use at most 300 characters"),
  pieces: z.number().int().min(1, "At least 1 piece").max(500, "At most 500 pieces"),
  specialHandling: z.array(SpecialHandlingSchema).max(4).default([]),
  declaredValueRupees: z.number().int().min(0).max(10_000_000).nullable().default(null),
  prohibitedItemsDeclaration: z.literal(true, { error: "Confirm that the shipment has no prohibited items" }),
});

export const CreateShipmentBody = z
  .object({
    source: AddressSchema,
    destination: AddressSchema,
    receiver: z.object({
      name: z.string().trim().min(2, "Enter the receiver's name").max(60),
      phone: PhoneSchema,
    }),
    package: ShipmentPackageSchema,
    /** IST calendar date; today .. today + 60 days (checked server-side against the clock). */
    shippingDate: z.iso.date("Choose a shipping date"),
  })
  .refine((s) => s.source.districtId !== s.destination.districtId, {
    path: ["destination", "districtId"],
    message: "Source and destination must be in different districts",
  });
export type CreateShipmentInput = z.input<typeof CreateShipmentBody>;
export type CreateShipmentValues = z.output<typeof CreateShipmentBody>;

/** Only while the shipment is open and has no booking. */
export const UpdateShipmentBody = CreateShipmentBody;

export const ShipmentIdParams = z.object({ shipmentId: IdSchema("shp") });
export const TripIdParams = z.object({ tripId: IdSchema("trp") });
export const BookingIdParams = z.object({ bookingId: BookingIdSchema });

const arrayParam = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined || v === "" ? undefined : Array.isArray(v) ? v : String(v).split(",").filter(Boolean)), z.array(item).optional());

/** Filters + sort shared by the shipment offers endpoint and the guest search. */
export const OfferFiltersQuery = z.object({
  sort: z.enum(OFFER_SORTS as unknown as [OfferSort, ...OfferSort[]]).default("price_asc"),
  vehicleClass: arrayParam(VehicleClassSchema),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().positive().optional(),
  minCapacityKg: z.coerce.number().int().positive().optional(),
  /** Overrides the shipping date ("try another date"). */
  date: z.iso.date().optional(),
});
export type OfferFilters = z.output<typeof OfferFiltersQuery>;

export const OffersQuery = OfferFiltersQuery;

/** Guest search (no shipment saved yet): district-level route + package basics. */
export const GuestSearchQuery = OfferFiltersQuery.extend({
  from: DistrictIdSchema,
  to: DistrictIdSchema,
  weightKg: z.coerce.number().int().min(LIMITS.weightKg.min).max(LIMITS.weightKg.max),
  goods: GoodsCategorySchema.default("general_goods"),
  handling: arrayParam(SpecialHandlingSchema),
}).refine((q) => q.from !== q.to, { path: ["to"], message: "Source and destination must be in different districts" });
export type GuestSearchInput = z.output<typeof GuestSearchQuery>;

/** Vehicle details: either a saved shipment (signed in) or the guest search params. */
export const TripDetailsQuery = z.object({
  shipmentId: IdSchema("shp").optional(),
  from: DistrictIdSchema.optional(),
  to: DistrictIdSchema.optional(),
  weightKg: z.coerce.number().int().min(LIMITS.weightKg.min).max(LIMITS.weightKg.max).optional(),
  goods: GoodsCategorySchema.optional(),
  handling: arrayParam(SpecialHandlingSchema),
});

export const RequestBookingBody = z.object({ shipmentId: IdSchema("shp"), tripId: IdSchema("trp") }); // + Idempotency-Key header
export const CancelBookingBody = z.object({ reason: z.string().trim().max(V2.reasonMax).optional() });
export const ReviewBody = z.object({
  rating: z.number().int().min(1, "Choose a rating").max(5),
  comment: z.string().trim().max(V2.reviewCommentMax, `Use at most ${V2.reviewCommentMax} characters`).optional(),
});
export const RegenerateOtpBody = z.object({ which: z.enum(["pickup", "delivery"]) });

export const CustomerTabSchema = z.enum(CUSTOMER_TABS as unknown as [CustomerTab, ...CustomerTab[]]);
export const ShipmentsQuery = CursorQuery.extend({ tab: CustomerTabSchema.optional() });
export const BookingsQuery = CursorQuery.extend({ tab: CustomerTabSchema.optional(), active: QueryBool });

/** Shipping-date window check (IST): "past_date" | "date_too_far" | null. */
export function shippingDateProblem(date: IsoDate, today: IsoDate): "past_date" | "date_too_far" | null {
  if (!isIsoDate(date) || date < today) return "past_date";
  if (date > addDaysIso(today, LIMITS.bookingWindowDays)) return "date_too_far";
  return null;
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

export type AddressDTO = Address;

export interface ShipmentDTO {
  id: string;
  status: "open" | "booked" | "completed" | "withdrawn";
  source: AddressDTO;
  destination: AddressDTO;
  receiver: { name: string; phone: string };
  package: {
    weightKg: number;
    goodsCategory: GoodsCategory;
    packageType: PackageType;
    description: string;
    pieces: number;
    specialHandling: SpecialHandling[];
    declaredValueRupees: number | null;
  };
  shippingDate: IsoDate;
  currentBookingId: string | null;
  /** Editable / withdrawable (open, no booking). */
  editable: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface RouteStopDTO {
  index: number;
  placeName: string;
  districtName: string;
  state: StateCode;
  /** Approximate coordinates of the hub town (for the illustrative map only). */
  lat: number | null;
  lng: number | null;
  kmFromOrigin: number;
  expectedArrivalAt: IsoDateTime | null;
  expectedDepartureAt: IsoDateTime | null;
  /** Between (and including) the customer's pickup and drop. */
  inSegment: boolean;
  role: "pickup" | "drop" | null;
}

export interface TripOfferDTO {
  tripId: string;
  agency: { id: string; name: string; ratingAvg: number; ratingCount: number; verified: boolean };
  /** Name / photo / phone only after acceptance (see CustomerBookingDTO.driver). */
  driver: { ratingAvg: number; ratingCount: number; deliveries: number };
  vehicle: { vehicleClass: VehicleClass; makeModel: string; bodyType: BodyType; photoUrl: string | null; imageKey: VehicleImageKey };
  pickup: { checkpointIndex: number; placeName: string; districtName: string; expectedDepartureAt: IsoDateTime };
  drop: { checkpointIndex: number; placeName: string; districtName: string; expectedArrivalAt: IsoDateTime };
  route: RouteStopDTO[];
  tripDepartureAt: IsoDateTime;
  tripArrivalAt: IsoDateTime;
  segmentKm: number;
  availableCapacityKg: number;
  offeredCapacityKg: number;
  goods: { accepted: GoodsCategory[]; handlingSupported: SpecialHandling[]; maxPackageKg: number | null; notes: string | null };
  rates: { perKmPaise: number; perKgPaise: number; handlingFeeRupees: number };
  pricing: PricingBreakdownV2;
  badge?: OfferBadge;
}

export interface OffersResponse {
  items: TripOfferDTO[];
  /** Trips on the route that were hidden only for lack of space. */
  excludedForCapacity: number;
  /** Trips on the route that were hidden because of goods / handling restrictions. */
  excludedForRestrictions: number;
  /** The date that was searched (IST). */
  date: IsoDate;
}

export interface TripDetailsDTO extends TripOfferDTO {
  reviews: ReviewDTO[];
  agencyInfo: { districtName: string; statesCovered: StateCode[]; memberSince: IsoDate; delivered: number };
  /** Why this trip can't be requested for the shipment (null = bookable). */
  problem: OfferProblem | null;
  problemMessage: string | null;
  /** Set when the caller's shipment already has an open booking (link to it instead of requesting). */
  existingBookingId: string | null;
}

export interface BookingPartyDTO {
  name: string;
  photoUrl: string | null;
  /** E.164; only from `confirmed`. */
  phone: string | null;
  ratingAvg: number;
  ratingCount: number;
}

export interface CustomerBookingListItem {
  id: string;
  status: BookingStatus;
  tab: CustomerTab;
  shipmentId: string;
  pickup: { placeName: string; districtName: string; expectedDepartureAt: IsoDateTime };
  drop: { placeName: string; districtName: string; expectedArrivalAt: IsoDateTime };
  weightKg: number;
  goodsCategory: GoodsCategory;
  totalPayable: number;
  agencyName: string;
  vehicleClass: VehicleClass | null;
  paymentDueAt: IsoDateTime | null;
  reviewed: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ShipmentListItem extends ShipmentDTO {
  currentBooking: CustomerBookingListItem | null;
}

export interface ShipmentWithBookingsDTO extends ShipmentDTO {
  bookings: CustomerBookingListItem[];
}

export interface CustomerBookingDTO {
  id: string;
  status: BookingStatus;
  tab: CustomerTab;
  shipment: ShipmentDTO;
  trip: TripOfferDTO;
  /** The locked quote (re-locked at accept); equals trip.pricing. */
  pricing: PricingBreakdownV2;
  respondBy: IsoDateTime;
  acceptedAt: IsoDateTime | null;
  paymentDueAt: IsoDateTime | null;
  paidAt: IsoDateTime | null;
  payment: PaymentSummaryDTO | null;
  /** From `pending_payment` on. */
  driver: BookingPartyDTO | null;
  /** Registration from `pending_payment` on. */
  vehicle: { vehicleClass: VehicleClass; makeModel: string; registrationNumber: string; bodyType: BodyType; imageKey: VehicleImageKey; photoUrl: string | null } | null;
  /** Customer-only codes, from `confirmed` until delivered. A used code is null with its `*Used` flag set. */
  otps: { pickup: string | null; delivery: string | null; pickupUsed: boolean; deliveryUsed: boolean; pickupLocked: boolean; deliveryLocked: boolean } | null;
  rejection: { reason: RejectReason; note: string | null; at: IsoDateTime } | null;
  cancellation: { reason: CancelReason; note: string | null; at: IsoDateTime; byRole: string } | null;
  statusHistory: Array<{ status: BookingStatus; at: IsoDateTime }>;
  canCancel: boolean;
  canPay: boolean;
  canReview: boolean;
  review: ReviewDTO | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface TrackingStageDTO {
  key: "booking" | "confirmation" | "pickup" | "in_transit" | "checkpoint" | "out_for_delivery" | "delivered" | "rejected" | "cancelled";
  label: string;
  state: "done" | "current" | "upcoming" | "skipped";
  at: IsoDateTime | null;
  checkpointIndex: number | null;
  placeName: string | null;
  expectedAt: IsoDateTime | null;
  departedAt: IsoDateTime | null;
  note: string | null;
}

export interface TrackingEventDTO {
  id: string;
  type: TrackingEventType;
  at: IsoDateTime;
  placeName: string | null;
  remarks: string | null;
  actorRole: string;
  fileUrls: string[];
}

export interface TrackingDTO {
  bookingId: string;
  status: BookingStatus;
  stages: TrackingStageDTO[];
  events: TrackingEventDTO[];
  proofUrls: string[];
  /** Always null: no GPS is collected and nothing is interpolated. */
  liveLocation: null;
}

export interface CustomerDashboardDTO {
  firstName: string;
  counts: Record<CustomerTab, number>;
  active: CustomerBookingListItem[];
  openShipments: ShipmentListItem[];
  recentActivity: NotificationDTO[];
}

export interface PaymentHistoryItem {
  id: string;
  bookingId: string;
  status: PaymentSummaryDTO["status"];
  provider: PaymentSummaryDTO["provider"];
  amountRupees: number;
  methodLabel: string | null;
  createdAt: IsoDateTime;
  paidAt: IsoDateTime | null;
  refund: PaymentSummaryDTO["refund"];
  routeLabel: string | null;
}
