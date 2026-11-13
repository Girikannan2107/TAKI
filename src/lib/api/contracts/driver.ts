/**
 * Driver app API contract (P2 §8.6). Isomorphic: zod bodies are used by the route handlers
 * AND by the driver app forms. Owner: D4.
 */
import { z } from "zod";
import type { DriverProfileDTO as AccountDriverProfileDTO } from "./auth";
import { CursorQuery, IdSchema, OtpCodeSchema, type ReviewDTO } from "./common";
import type {
  BookingStatus,
  DriverLinkStatus,
  GoodsCategory,
  IsoDateTime,
  PackageType,
  SpecialHandling,
  StateCode,
  TrackingEventType,
  TripEventType,
  TripStatus,
} from "@/lib/domain/model";

// ── Bodies / queries ─────────────────────────────────────────────────────────
const Remarks = z.string().trim().max(300, "Keep remarks under 300 characters").optional();
const ClientAt = z.iso.datetime({ offset: true }).optional();

export const CheckpointActionBody = z.object({ remarks: Remarks, clientAt: ClientAt });
export type CheckpointActionInput = z.input<typeof CheckpointActionBody>;

export const PickupBody = z.object({ otp: OtpCodeSchema, remarks: Remarks, clientAt: ClientAt });
export type PickupInput = z.input<typeof PickupBody>;

export const RefusePickupBody = z.object({
  reason: z.string().trim().min(5, "Tell us why (at least 5 characters)").max(300, "Keep the reason under 300 characters"),
});
export type RefusePickupInput = z.input<typeof RefusePickupBody>;

/** multipart fields of the deliver call; files go in `proof` (1–3 images). */
export const DeliverFields = z.object({
  otp: OtpCodeSchema,
  receivedBy: z.string().trim().max(80, "Keep the name under 80 characters").optional(),
  remarks: Remarks,
  clientAt: ClientAt,
});
export type DeliverInput = z.input<typeof DeliverFields>;
export const MAX_PROOF_FILES = 3;

export const RemarkBody = z.object({ text: z.string().trim().min(1, "Enter a remark").max(300, "Keep remarks under 300 characters") });
export type RemarkInput = z.input<typeof RemarkBody>;

export const DRIVER_SHIPMENT_TABS = ["pending_pickup", "in_transit", "delivered"] as const;
export type DriverShipmentTab = (typeof DRIVER_SHIPMENT_TABS)[number];
export const DriverShipmentsQuery = CursorQuery.extend({ tab: z.enum(DRIVER_SHIPMENT_TABS).default("pending_pickup") });

export const DRIVER_TRIP_FILTERS = ["upcoming", "active", "completed"] as const;
export type DriverTripFilter = (typeof DRIVER_TRIP_FILTERS)[number];
export const DriverTripsQuery = z.object({ status: z.enum(DRIVER_TRIP_FILTERS).default("upcoming") });

/** `month` = "YYYY-MM" (IST calendar month of delivery). `q` = booking id (TAKI123456, case-insensitive). */
export const DriverHistoryQuery = CursorQuery.extend({
  q: z.string().trim().max(20).optional(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM")
    .optional(),
});

export const DriverProfilePatchBody = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(80, "Keep your name under 80 characters"),
});

export const AgencyLinkBody = z.object({ agencyId: IdSchema("agc") });

export const TripIdParam = IdSchema("trp");
export const CheckpointIndexParam = z.coerce.number().int().min(0).max(9);

// ── DTOs ─────────────────────────────────────────────────────────────────────
export type DriverShipmentAction = "pickup" | "refuse_pickup" | "start_transit" | "out_for_delivery" | "deliver" | "remark";

export interface DriverPlaceDTO {
  checkpointIndex: number;
  placeName: string;
  districtName: string;
  /** Expected pickup departure / drop arrival. */
  expectedAt: IsoDateTime;
}

export interface DriverAddressDTO {
  line1: string;
  line2: string | null;
  landmark: string | null;
  districtName: string;
  state: StateCode;
  pincode: string;
  /** Google Maps search link built from the address (no tracking, no API key). */
  mapsUrl: string;
}

export interface DriverPackageDTO {
  weightKg: number;
  pieces: number;
  packageType: PackageType;
  goodsCategory: GoodsCategory;
  specialHandling: SpecialHandling[];
}

export interface DriverShipmentListItem {
  bookingId: string;
  tripId: string;
  status: BookingStatus;
  customerName: string;
  receiverName: string;
  pickup: DriverPlaceDTO & { district: string; shortAddress: string };
  drop: DriverPlaceDTO & { district: string; shortAddress: string };
  package: DriverPackageDTO;
  trip: { id: string; routeLabel: string; departureAt: IsoDateTime; vehicleReg: string };
  updatedAt: IsoDateTime;
  /** When the booking reached `delivered`. */
  deliveredAt: IsoDateTime | null;
}

export interface DriverEventDTO {
  id: string;
  type: TrackingEventType;
  at: IsoDateTime;
  clientAt: IsoDateTime | null;
  placeName: string | null;
  remarks: string | null;
  fileUrls: string[];
  byRole: "customer" | "agency" | "driver" | "admin" | "system";
}

export interface DriverCheckpointBriefDTO {
  index: number;
  placeName: string;
  districtName: string;
  expectedArrivalAt: IsoDateTime | null;
  expectedDepartureAt: IsoDateTime | null;
  actualArrivalAt: IsoDateTime | null;
  actualDepartureAt: IsoDateTime | null;
  isPickup: boolean;
  isDrop: boolean;
}

export interface DriverShipmentDTO extends DriverShipmentListItem {
  /** Null once the booking is no longer active for this driver (e.g. cancelled). */
  customer: { name: string; phone: string | null };
  receiver: { name: string; phone: string | null };
  pickupAddress: DriverAddressDTO | null;
  dropAddress: DriverAddressDTO | null;
  description: string | null;
  tripStatus: TripStatus;
  vehicle: { registrationNumber: string; vehicleClass: string; makeModel: string };
  checkpoints: DriverCheckpointBriefDTO[];
  events: DriverEventDTO[];
  delivery: { at: IsoDateTime; proofUrls: string[]; remarks: string | null } | null;
  cancellation: { at: IsoDateTime; note: string | null; reason: string } | null;
  allowedActions: DriverShipmentAction[];
}

export interface DriverTripBookingRef {
  bookingId: string;
  customerName: string;
  receiverName: string | null;
  weightKg: number;
  status: BookingStatus;
}

export interface DriverTripCheckpointDTO {
  index: number;
  placeName: string;
  districtName: string;
  state: StateCode;
  kmFromOrigin: number;
  expectedArrivalAt: IsoDateTime | null;
  expectedDepartureAt: IsoDateTime | null;
  actualArrivalAt: IsoDateTime | null;
  actualDepartureAt: IsoDateTime | null;
  pickups: DriverTripBookingRef[];
  drops: DriverTripBookingRef[];
}

export interface DriverTripNextStep {
  kind: "arrive" | "depart";
  index: number;
  placeName: string;
  expectedAt: IsoDateTime | null;
}

export interface DriverTripListItem {
  id: string;
  status: TripStatus;
  routeLabel: string;
  originName: string;
  destinationName: string;
  departureAt: IsoDateTime;
  arrivalAt: IsoDateTime;
  agencyName: string;
  vehicle: { registrationNumber: string; vehicleClass: string; makeModel: string };
  capacity: { offeredKg: number; bookedKg: number; reservedKg: number };
  checkpointCount: number;
  /** Next checkpoint event the driver should record (null when none is pending). */
  nextStep: DriverTripNextStep | null;
  shipmentCount: number;
}

export interface DriverTripEventDTO {
  id: string;
  type: TripEventType;
  checkpointIndex: number | null;
  at: IsoDateTime;
  clientAt: IsoDateTime | null;
  remarks: string | null;
}

export interface DriverTripDTO extends DriverTripListItem {
  checkpoints: DriverTripCheckpointDTO[];
  events: DriverTripEventDTO[];
  /** Arrived at the destination and every held shipment is delivered or closed. */
  canComplete: boolean;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
}

export interface DriverAgencyStatusDTO {
  agencyId: string;
  agencyName: string;
  status: DriverLinkStatus;
}

export interface DriverDashboardDTO {
  driver: { fullName: string; photoUrl: string | null };
  agency: DriverAgencyStatusDTO | null;
  /** Agency link is active → trips and shipments are available. */
  approved: boolean;
  activeTrips: number;
  pendingPickups: number;
  inTransit: number;
  completedDeliveries: number;
  /** In-progress trip, else the next upcoming one. */
  nextTrip: DriverTripListItem | null;
  /** Up to 5 confirmed shipments awaiting pickup, earliest first. */
  nextActions: DriverShipmentListItem[];
}

export interface DriverHistoryDTO {
  items: DriverShipmentListItem[];
  nextCursor: string | null;
}

export interface DriverAppProfileDTO {
  account: AccountDriverProfileDTO;
  reviews: ReviewDTO[];
}

// ── Labels shared by the UI ──────────────────────────────────────────────────
export const DRIVER_STATUS_LABEL: Record<BookingStatus, string> = {
  awaiting_agency: "Awaiting agency",
  pending_payment: "Awaiting payment",
  payment_failed: "Payment failed",
  confirmed: "To pick up",
  picked_up: "Picked up",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  draft: "Draft",
  published: "Upcoming",
  in_progress: "On the road",
  completed: "Completed",
  cancelled: "Cancelled",
};
