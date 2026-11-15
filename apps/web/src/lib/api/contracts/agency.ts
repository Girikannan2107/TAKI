/**
 * Agency API contracts (P2 §8.5). Isomorphic: zod bodies are used by the route handlers AND the
 * agency forms; DTO interfaces describe every JSON response under /api/agency/**. Owner: D2.
 */
import { z } from "zod";
import {
  BodyTypeSchema,
  CursorQuery,
  GoodsCategorySchema,
  IdSchema,
  PhoneSchema,
  PlaceIdSchema,
  SpecialHandlingSchema,
  VehicleClassSchema,
  type NotificationDTO,
  type ReviewDTO,
} from "./common";
import { capacityIssues, checkpointIssues } from "@/lib/domain/trip-rules";
import type {
  BodyType,
  BookingStatus,
  DriverLinkStatus,
  GoodsCategory,
  IsoDate,
  IsoDateTime,
  NotificationLink,
  PaymentStatus,
  PricingBreakdownV2,
  SpecialHandling,
  StateCode,
  TrackingEventType,
  TripStatus,
  VehicleClass,
  VerificationStatus,
} from "@/lib/domain/model";
import type { VehicleImageKey, VehicleModelId } from "@/lib/domain/types";

// ── Shared helpers ────────────────────────────────────────────────────────────
const REG_RE = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/;
const BH_RE = /^(\d{2})BH(\d{4})([A-Z]{1,2})$/;

/** "tn37xx4587" → "TN 37 XX 4587"; BH series "22BH1234AA" → "22 BH 1234 AA". Unknown shapes are upper-cased. */
export function normalizeReg(input: string): string {
  const compact = (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const bh = BH_RE.exec(compact);
  if (bh) return `${bh[1]} BH ${bh[2]} ${bh[3]}`;
  const m = REG_RE.exec(compact);
  if (!m) return (input ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  return [m[1], m[2]!.padStart(2, "0"), m[3], m[4]!.padStart(4, "0")].filter(Boolean).join(" ");
}

export function isValidReg(normalized: string): boolean {
  const compact = normalized.replace(/\s+/g, "");
  return BH_RE.test(compact) || (REG_RE.test(compact) && compact.length >= 6);
}

/** registrationIndex document id: normalised registration without spaces. */
export function regKey(normalized: string): string {
  return normalized.replace(/\s+/g, "");
}

const RegistrationSchema = z
  .string()
  .trim()
  .min(1, "Enter the registration number")
  .transform(normalizeReg)
  .refine(isValidReg, "Enter a valid registration number, e.g. TN 37 XX 4587");

const ReasonSchema = z.string().trim().min(3, "Give a short reason (at least 3 characters)").max(300, "Keep it under 300 characters");

// ── Vehicles ──────────────────────────────────────────────────────────────────
const VEHICLE_MODEL_IDS = ["tata_ace", "mahindra_bolero_pickup", "tata_407", "eicher_pro", "ashok_leyland_ecomet"] as const;

export const DimensionsSchema = z.object({
  length: z.number().positive("Enter a length").max(60),
  width: z.number().positive("Enter a width").max(12),
  height: z.number().positive("Enter a height").max(15),
});

export const VehicleBody = z.object({
  vehicleClass: VehicleClassSchema,
  modelId: z.enum(VEHICLE_MODEL_IDS).nullable().default(null),
  makeModel: z.string().trim().min(2, "Enter the make and model").max(60),
  registrationNumber: RegistrationSchema,
  maxPayloadKg: z.number().int("Use whole kilograms").min(100, "At least 100 kg").max(40_000, "At most 40,000 kg"),
  bodyType: BodyTypeSchema,
  dimensionsFt: DimensionsSchema.nullable().default(null),
  acceptedGoods: z.array(GoodsCategorySchema).min(1, "The vehicle must be able to carry at least one goods category"),
  handlingSupported: z.array(SpecialHandlingSchema).default([]),
});
export type VehicleInput = z.input<typeof VehicleBody>;

export const VehiclePatchBody = VehicleBody.partial().extend({ status: z.enum(["active", "inactive"]).optional() });
export type VehiclePatchInput = z.input<typeof VehiclePatchBody>;

export const VehicleListQuery = z.object({ status: z.enum(["active", "inactive", "all"]).default("all") });

// ── Drivers & invites ────────────────────────────────────────────────────────
export const DriverInviteBody = z.object({
  fullName: z.string().trim().min(2, "Enter the driver's name").max(60),
  phone: PhoneSchema,
});
export type DriverInviteInput = z.input<typeof DriverInviteBody>;

export const DriverPatchBody = z.object({ availability: z.enum(["available", "unavailable"]) });
export const DriverRejectBody = z.object({ reason: z.string().trim().max(300).optional() });
export const DriverListQuery = z.object({ status: z.enum(["active", "pending", "removed"]).default("active") });

// ── Trips ─────────────────────────────────────────────────────────────────────
export const CheckpointInput = z.object({
  placeId: PlaceIdSchema,
  kmFromOrigin: z.number().int().min(0).max(5000).nullable().optional(),
  expectedArrivalAt: z.iso.datetime({ offset: true }).nullable(),
  expectedDepartureAt: z.iso.datetime({ offset: true }).nullable(),
});
export type CheckpointInputValue = z.input<typeof CheckpointInput>;

const CheckpointsSchema = z
  .array(CheckpointInput)
  .min(2, "Add a source and a destination")
  .max(10, "At most 10 stops")
  .superRefine((cps, ctx) => {
    for (const issue of checkpointIssues(cps)) {
      const path = issue.path.split(".").slice(1).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
      ctx.addIssue({ code: "custom", path, message: issue.message });
    }
  });

/** Trip fields without defaults: PATCH must not fill in omitted fields (Zod 4 `.partial()` keeps `.default()`). */
const TripFieldsBase = z.object({
  vehicleId: IdSchema("veh"),
  driverId: IdSchema("usr"),
  /** Trip max capacity (≤ vehicle payload). Defaults to the vehicle payload. */
  maxCapacityKg: z.number().int().min(100).max(40_000).nullable().optional(),
  offeredKg: z.number().int("Use whole kilograms").min(100, "Offer at least 100 kg").max(40_000),
  checkpoints: CheckpointsSchema,
  acceptedGoods: z.array(GoodsCategorySchema).min(1, "Choose at least one goods category"),
  handlingSupported: z.array(SpecialHandlingSchema),
  maxPackageKg: z.number().int().positive().max(40_000).nullable(),
  goodsNotes: z.string().trim().max(300).nullable(),
  ratePerKmPaise: z.number().int().min(100, "At least ₹1/km").max(10_000, "At most ₹100/km").optional(),
  ratePerKgPaise: z.number().int().min(0).max(2_000, "At most ₹20/kg").optional(),
  handlingFeeRupees: z.number().int().min(0).max(2000),
});

const TripFields = TripFieldsBase.extend({
  handlingSupported: TripFieldsBase.shape.handlingSupported.default([]),
  maxPackageKg: TripFieldsBase.shape.maxPackageKg.default(null),
  goodsNotes: TripFieldsBase.shape.goodsNotes.default(null),
  handlingFeeRupees: TripFieldsBase.shape.handlingFeeRupees.default(0),
});

function capacityRefine(v: { offeredKg?: number; maxCapacityKg?: number | null }, ctx: z.RefinementCtx) {
  if (v.offeredKg === undefined) return;
  const max = v.maxCapacityKg ?? 40_000;
  for (const issue of capacityIssues({ offeredKg: v.offeredKg, maxCapacityKg: v.maxCapacityKg, vehiclePayloadKg: max }))
    if (issue.path === "offeredKg") ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
}

/** POST /api/agency/trips. `publish: false` = save draft. Rates are required to publish (defaults apply to drafts). */
export const TripBody = TripFields.extend({ publish: z.boolean().default(false) })
  .superRefine(capacityRefine)
  .superRefine((v, ctx) => {
    if (v.publish && v.ratePerKmPaise === undefined) ctx.addIssue({ code: "custom", path: ["ratePerKmPaise"], message: "Enter your per-km rate" });
    if (v.publish && v.ratePerKgPaise === undefined) ctx.addIssue({ code: "custom", path: ["ratePerKgPaise"], message: "Enter your per-kg rate" });
  });
export type TripInput = z.input<typeof TripBody>;
export type TripInputParsed = z.output<typeof TripBody>;

/** PATCH /api/agency/trips/[id]. Drafts: any field. Published: rates, capacity, package limit, notes, handling fee only. */
export const TripPatchBody = TripFieldsBase.partial().superRefine(capacityRefine);
export type TripPatchInput = z.input<typeof TripPatchBody>;

export const TripPreviewBody = z.object({
  checkpoints: z.array(CheckpointInput.pick({ placeId: true, kmFromOrigin: true })).min(2).max(10),
  ratePerKmPaise: z.number().int().min(0).max(10_000).default(0),
  ratePerKgPaise: z.number().int().min(0).max(2_000).default(0),
  sampleWeightKg: z.number().int().min(1).max(40_000).default(500),
});
export type TripPreviewInput = z.input<typeof TripPreviewBody>;

export const TripListQuery = CursorQuery.extend({
  tab: z.enum(["upcoming", "active", "completed", "cancelled", "drafts"]).default("upcoming"),
});
export type AgencyTripsTabValue = z.output<typeof TripListQuery>["tab"];

export const TripFormOptionsQuery = z.object({
  departureAt: z.iso.datetime({ offset: true }).optional(),
  arrivalAt: z.iso.datetime({ offset: true }).optional(),
  excludeTripId: IdSchema("trp").optional(),
});

export const CancelTripBody = z.object({ reason: ReasonSchema });
export const ReassignDriverBody = z.object({ driverId: IdSchema("usr") });

// ── Bookings ─────────────────────────────────────────────────────────────────
export const AGENCY_BOOKING_TABS = ["pending", "accepted", "confirmed", "rejected", "cancelled"] as const;
export type AgencyBookingTab = (typeof AGENCY_BOOKING_TABS)[number];

/** Statuses shown under each agency Bookings tab. */
export const AGENCY_TAB_STATUSES: Record<AgencyBookingTab, readonly BookingStatus[]> = {
  pending: ["awaiting_agency"],
  accepted: ["pending_payment", "payment_failed"],
  confirmed: ["confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"],
  rejected: ["rejected"],
  cancelled: ["cancelled"],
};

export function agencyTabOf(s: BookingStatus): AgencyBookingTab {
  for (const t of AGENCY_BOOKING_TABS) if (AGENCY_TAB_STATUSES[t].includes(s)) return t;
  return "pending";
}

export const BookingListQuery = CursorQuery.extend({
  tab: z.enum(AGENCY_BOOKING_TABS).default("pending"),
  tripId: IdSchema("trp").optional(),
});

export const REJECT_REASONS = ["No space left", "Goods not accepted", "Schedule change", "Other"] as const;
export const RejectBookingBody = z.object({ reason: ReasonSchema });

// ── History / earnings ───────────────────────────────────────────────────────
export const HISTORY_TYPES = ["bookings", "trips", "vehicles", "drivers", "customers"] as const;
export type HistoryType = (typeof HISTORY_TYPES)[number];
export const HistoryQuery = CursorQuery.extend({
  q: z.string().trim().max(60).optional(),
  type: z.enum(HISTORY_TYPES).default("bookings"),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type HistoryQueryInput = z.input<typeof HistoryQuery>;

export const EarningsQuery = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });

// ── Verification upload (multipart text fields) ──────────────────────────────
export const VerificationFields = z.object({
  kind: z.enum(["aadhaar", "pan", "driving_license"]),
  number: z.string().trim().min(8, "Enter the document number").max(24),
});

// ═════════════════════════════════════ DTOs ═════════════════════════════════════

export interface VehicleDTO {
  id: string;
  vehicleClass: VehicleClass;
  modelId: VehicleModelId | null;
  makeModel: string;
  registrationNumber: string;
  maxPayloadKg: number;
  bodyType: BodyType;
  dimensionsFt: { length: number; width: number; height: number } | null;
  acceptedGoods: GoodsCategory[];
  handlingSupported: SpecialHandling[];
  photos: Array<{ fileId: string; url: string }>;
  /** Illustration fallback when there is no photo. */
  imageKey: VehicleImageKey;
  status: "active" | "inactive" | "removed";
  /** Published / in-progress trips using this vehicle (blocks removal). */
  activeTrips: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ScheduleSlotDTO {
  tripId: string;
  from: IsoDateTime;
  to: IsoDateTime;
}

export interface AgencyDriverDTO {
  id: string;
  fullName: string;
  /** Full number — the agency may contact its own drivers. */
  phone: string;
  phoneMasked: string;
  photoUrl: string | null;
  license: { numberMasked: string | null; fileUrl: string | null; validUntil: IsoDate | null };
  aadhaar: { numberMasked: string | null; fileUrl: string | null };
  link: { status: DriverLinkStatus; via: "invite" | "request"; requestedAt: IsoDateTime; decidedAt: IsoDateTime | null };
  availability: "available" | "unavailable";
  verification: VerificationStatus;
  stats: { ratingAvg: number; ratingCount: number; delivered: number };
  /** Current or next busy interval from the driver's schedule. */
  nextAssignment: ScheduleSlotDTO | null;
}

export interface AgencyDriverDetailDTO extends AgencyDriverDTO {
  trips: AgencyTripListItem[];
  reviews: ReviewDTO[];
  schedule: ScheduleSlotDTO[];
}

export interface InviteDTO {
  id: string;
  fullName: string;
  phone: string;
  phoneMasked: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: IsoDateTime;
  createdAt: IsoDateTime;
}

export interface TripCheckpointDTO {
  index: number;
  placeId: string;
  placeName: string;
  districtId: string;
  districtName: string;
  state: StateCode;
  kmFromOrigin: number;
  expectedArrivalAt: IsoDateTime | null;
  expectedDepartureAt: IsoDateTime | null;
  actualArrivalAt: IsoDateTime | null;
  actualDepartureAt: IsoDateTime | null;
}

export interface TripCapacityDTO {
  vehicleMaxKg: number;
  offeredKg: number;
  /** Paid holds. */
  bookedKg: number;
  /** Accepted, awaiting payment (unexpired). */
  reservedKg: number;
  availableKg: number;
}

export interface AgencyTripListItem {
  id: string;
  status: TripStatus;
  routeLabel: string;
  stops: string[];
  departureAt: IsoDateTime;
  arrivalAt: IsoDateTime;
  distanceKm: number;
  vehicle: { id: string; registrationNumber: string; vehicleClass: VehicleClass; makeModel: string; imageKey: VehicleImageKey };
  driver: { id: string; fullName: string; photoUrl: string | null };
  capacity: TripCapacityDTO;
  counts: { awaiting: number; held: number; delivered: number };
  rates: { perKmPaise: number; perKgPaise: number; handlingFeeRupees: number };
  /** Departure has passed while still published (driver hasn't started). */
  departed: boolean;
  publishedAt: IsoDateTime | null;
  updatedAt: IsoDateTime;
}

export interface AgencyTripDTO extends AgencyTripListItem {
  checkpoints: TripCheckpointDTO[];
  goods: { accepted: GoodsCategory[]; handlingSupported: SpecialHandling[]; maxPackageKg: number | null; notes: string | null };
  cancelReason: string | null;
  cancelledAt: IsoDateTime | null;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  bookings: AgencyBookingListItem[];
  /** Why publishing is blocked right now (drafts only; empty = ready). */
  publishBlockers: string[];
}

export interface TripListResponse {
  items: AgencyTripListItem[];
  nextCursor: string | null;
  counts: Record<"upcoming" | "active" | "completed" | "cancelled" | "drafts", number>;
}

export interface TripFormVehicleOption {
  id: string;
  label: string;
  registrationNumber: string;
  maxPayloadKg: number;
  acceptedGoods: GoodsCategory[];
  handlingSupported: SpecialHandling[];
  status: "active" | "inactive";
  /** Overlapping published trip in the requested window. */
  busy: ScheduleSlotDTO | null;
}

export interface TripFormDriverOption {
  id: string;
  fullName: string;
  availability: "available" | "unavailable";
  busy: ScheduleSlotDTO | null;
}

export interface TripFormOptionsDTO {
  vehicles: TripFormVehicleOption[];
  drivers: TripFormDriverOption[];
  verification: VerificationStatus;
}

export interface TripPreviewDTO {
  checkpoints: Array<{ placeId: string; placeName: string; km: number; computedKm: number }>;
  distanceKm: number;
  durationMins: number;
  sampleWeightKg: number;
  earningsPreview: { distanceCharge: number; weightCharge: number; earnings: number };
}

export interface AgencyBookingListItem {
  id: string;
  status: BookingStatus;
  tab: AgencyBookingTab;
  tripId: string;
  customerName: string;
  pickup: { placeName: string; districtId: string; expectedDepartureAt: IsoDateTime };
  drop: { placeName: string; districtId: string; expectedArrivalAt: IsoDateTime };
  weightKg: number;
  goodsCategory: GoodsCategory;
  specialHandling: SpecialHandling[];
  tripDepartureAt: IsoDateTime;
  vehicleReg: string;
  driverName: string;
  routeLabel: string;
  /** Agency net (transportation + handling). */
  earnings: number;
  totalPayable: number;
  respondBy: IsoDateTime;
  paymentDueAt: IsoDateTime | null;
  /** Pending requests only: trip space left now and after accepting. */
  capacity: { availableKg: number; afterAcceptKg: number } | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface BookingTimelineEntry {
  type: TrackingEventType;
  at: IsoDateTime;
  placeName: string | null;
  remarks: string | null;
  proofUrls: string[];
}

export interface AgencyBookingDTO extends AgencyBookingListItem {
  /** Phone only from acceptance (pending_payment) on. */
  customer: { name: string; phone: string | null };
  /** Receiver only from confirmation on. */
  receiver: { name: string; phone: string } | null;
  /** Full addresses only from acceptance on; districts always. */
  addresses: {
    pickup: { line: string | null; districtName: string; state: StateCode; pincode: string | null };
    drop: { line: string | null; districtName: string; state: StateCode; pincode: string | null };
  };
  package: { weightKg: number; goodsCategory: GoodsCategory; packageType: string; description: string; pieces: number; specialHandling: SpecialHandling[]; declaredValueRupees: number | null };
  shippingDate: IsoDate;
  pricing: PricingBreakdownV2;
  payment: { status: PaymentStatus; amountRupees: number; methodLabel: string | null; paidAt: IsoDateTime | null } | null;
  trip: { id: string; status: TripStatus; routeLabel: string; departureAt: IsoDateTime; vehicleReg: string; driverName: string } | null;
  rejection: { note: string | null; at: IsoDateTime } | null;
  cancellation: { reason: string; note: string | null; at: IsoDateTime } | null;
  timeline: BookingTimelineEntry[];
  /** Whether customer & receiver details are shared with the assigned driver (from confirmed). */
  sharedWithDriver: boolean;
}

export interface BookingListResponse {
  items: AgencyBookingListItem[];
  nextCursor: string | null;
  counts: Record<AgencyBookingTab, number>;
}

export interface HistoryRow {
  type: HistoryType;
  id: string;
  title: string;
  subtitle: string;
  date: IsoDateTime;
  status: string | null;
  link: { type: "booking" | "trip" | "vehicle" | "driver"; id: string } | null;
}

export interface AgencyDashboardDTO {
  agency: { id: string; name: string; ownerName: string; verification: VerificationStatus; verificationReason: string | null };
  totals: { vehicles: number; drivers: number; pendingDrivers: number };
  trips: { active: number; upcoming: number };
  pendingBookings: number;
  completedShipments: number;
  revenue: { thisMonth: number; lastMonth: number; total: number; changePct: number | null; monthlySeries: Array<{ month: string; amount: number }> };
  upcomingTrips: AgencyTripListItem[];
  recentActivity: NotificationDTO[];
}

export interface AgencyEarningRowDTO {
  bookingId: string;
  tripId: string;
  routeLabel: string;
  customerPaid: number;
  transportationCharge: number;
  handlingFee: number;
  platformFee: number;
  agencyNet: number;
  deliveredAt: IsoDateTime;
  status: "pending" | "settled" | "on_hold";
  settledAt: IsoDateTime | null;
}

export interface AgencyPaymentRowDTO {
  id: string;
  bookingId: string;
  status: PaymentStatus;
  amountRupees: number;
  methodLabel: string | null;
  createdAt: IsoDateTime;
  paidAt: IsoDateTime | null;
}

export interface AgencySettlementDTO {
  id: string;
  amount: number;
  bookings: number;
  reference: string;
  periodThrough: IsoDate;
  settledAt: IsoDateTime;
}

export interface AgencyEarningsDTO {
  summary: { total: number; pending: number; settled: number; onHold: number; thisMonth: number; lastMonth: number };
  monthlySeries: Array<{ month: string; amount: number }>;
  byTrip: Array<{ tripId: string; routeLabel: string; deliveredBookings: number; agencyNet: number; lastDeliveredAt: IsoDateTime }>;
  byBooking: AgencyEarningRowDTO[];
  payments: AgencyPaymentRowDTO[];
  settlements: AgencySettlementDTO[];
}

export interface AgencyProfileSummaryDTO {
  counts: { vehicles: number; drivers: number; pendingDrivers: number };
}

export type { NotificationLink };
