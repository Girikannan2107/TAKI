import "server-only";
/**
 * Firestore document shapes (P2 §4.3) — the single source of truth for persisted data.
 * D5 owns this file; other agents request additions via SendMessage.
 *
 * Conventions: every doc has `id`, `createdAt`, `updatedAt` (ISO strings, server clock).
 * Mutable aggregates carry `version`. Only the TTL collections also store `expiresAtTs: Date`
 * (Firestore Timestamp) for storage hygiene; expiry is always enforced in code via `expiresAt`.
 */
import type {
  Actor,
  Address,
  BodyType,
  BookingId,
  BookingStatus,
  CancelReason,
  CapacityHold,
  CustomerTab,
  DistrictId,
  DriverLinkStatus,
  EarningStatus,
  FileContentType,
  FileKind,
  FileOwnerType,
  FileRef,
  GoodsCategory,
  Id,
  IdentityDocumentKind,
  IsoDate,
  IsoDateTime,
  Mobile,
  NotificationKind,
  NotificationLink,
  PackageType,
  PaymentProvider,
  PaymentProviderEnv,
  PaymentStatus,
  PricingBreakdownV2,
  RejectReason,
  Role,
  Rupees,
  SpecialHandling,
  StateCode,
  TrackingEventType,
  TripCheckpoint,
  TripEventType,
  TripStatus,
  VehicleClass,
  VehicleCountRange,
  VehicleImageKey,
  VehicleModelId,
  VerificationStatus,
} from "@/lib/domain/model";
import type { StatusHistoryEntry } from "@/lib/domain/booking-machine";

export type { TripCheckpoint, CapacityHold, StatusHistoryEntry };

export interface Base {
  id: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Review state shared by agencies and drivers (admin/ops document review). */
export interface VerificationState {
  status: VerificationStatus;
  submittedAt: IsoDateTime;
  reviewedAt: IsoDateTime | null;
  /** Admin userId, or "ops" for the CLI. */
  reviewedBy: string | null;
  reason: string | null;
}

// ── Accounts & auth (D1 uses; D5 owns the shapes) ────────────────────────────
export interface UserDoc extends Base {
  role: Role;
  phone: Mobile;
  phoneVerifiedAt: IsoDateTime;
  passwordHash: string;
  passwordChangedAt: IsoDateTime;
  status: "active" | "disabled";
  failedLoginCount: number;
  lockedUntil: IsoDateTime | null;
  lastLoginAt: IsoDateTime | null;
  /** role === "agency" */
  agencyId: Id | null;
  /** Display name (admin users have no profile doc). */
  displayName: string;
}

/** id = `${role}:${e164}` */
export interface PhoneIndexDoc {
  id: string;
  userId: Id;
  role: Role;
  createdAt: IsoDateTime;
}

/** id = sha256(sid) */
export interface SessionDoc {
  id: string;
  userId: Id;
  role: Role;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
  expiresAtTs: Date;
  lastSeenAt: IsoDateTime;
  revokedAt: IsoDateTime | null;
  userAgentHash: string | null;
  ipHash: string | null;
}

export type OtpPurpose = "signup" | "reset_password" | "change_phone";

export interface OtpChallengeDoc extends Base {
  phone: Mobile;
  role: Role;
  purpose: OtpPurpose;
  /** For change_phone: the user requesting it. */
  userId: Id | null;
  codeHash: string;
  expiresAt: IsoDateTime;
  expiresAtTs: Date;
  resendAvailableAt: IsoDateTime;
  attempts: number;
  resends: number;
  verifiedAt: IsoDateTime | null;
  proofHash: string | null;
  proofExpiresAt: IsoDateTime | null;
  consumedAt: IsoDateTime | null;
  dead: boolean;
}

/** id = sha256(bucket) */
export interface RateLimitDoc {
  id: string;
  bucket: string;
  count: number;
  windowStart: IsoDateTime;
  expiresAt: IsoDateTime;
  expiresAtTs: Date;
}

/** id = `${scope}:${userId}:${key}` (hashed if long) */
export interface IdempotencyDoc {
  id: string;
  scope: string;
  userId: Id;
  requestHash: string;
  status: number;
  body: unknown;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
  expiresAtTs: Date;
}

// ── Profiles ─────────────────────────────────────────────────────────────────
export interface CustomerDoc extends Base {
  fullName: string;
  /** 18+ at signup (IST). */
  dob: IsoDate;
  phone: Mobile;
  photo: FileRef | null;
  stats: { bookings: number; delivered: number };
}

export interface IdentityDocument {
  kind: IdentityDocumentKind;
  numberMasked: string;
  numberHmac: string;
  file: FileRef;
}

export interface AgencyDoc extends Base {
  ownerUserId: Id;
  ownerName: string;
  agencyName: string;
  nameLower: string;
  searchTokens: string[];
  districtId: DistrictId;
  state: StateCode;
  statesCovered: StateCode[];
  vehicleCountRange: VehicleCountRange;
  phone: Mobile;
  photo: FileRef | null;
  identityDocument: IdentityDocument;
  verification: VerificationState;
  stats: { vehicles: number; drivers: number; ratingAvg: number; ratingCount: number; delivered: number };
}

export interface DriverAgencyLink {
  agencyId: Id;
  agencyName: string;
  status: DriverLinkStatus;
  via: "invite" | "request";
  requestedAt: IsoDateTime;
  decidedAt: IsoDateTime | null;
}

/** id = userId */
export interface DriverDoc extends Base {
  fullName: string;
  phone: Mobile;
  photo: FileRef;
  license: { numberMasked: string; numberHmac: string; file: FileRef; validUntil: IsoDate | null };
  aadhaar: { numberMasked: string; numberHmac: string; file: FileRef };
  agencyLink: DriverAgencyLink | null;
  /** Agency-controlled. */
  availability: "available" | "unavailable";
  /** Admin document review (informational; trip assignment is gated by the agency link). */
  verification: VerificationState;
  stats: { ratingAvg: number; ratingCount: number; delivered: number };
}

export interface DriverInviteDoc extends Base {
  agencyId: Id;
  agencyName: string;
  phone: Mobile;
  fullName: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: IsoDateTime;
  driverId: Id | null;
}

// ── Fleet ────────────────────────────────────────────────────────────────────
export interface VehicleDoc extends Base {
  agencyId: Id;
  vehicleClass: VehicleClass;
  modelId: VehicleModelId | null;
  makeModel: string;
  /** Normalised "TN 37 XX 4587". */
  registrationNumber: string;
  maxPayloadKg: number;
  bodyType: BodyType;
  dimensionsFt: { length: number; width: number; height: number } | null;
  acceptedGoods: GoodsCategory[];
  handlingSupported: SpecialHandling[];
  photos: FileRef[];
  imageKey: VehicleImageKey;
  status: "active" | "inactive" | "removed";
}

/** id = normalised registration (spaces removed) */
export interface RegistrationIndexDoc {
  id: string;
  vehicleId: Id;
  agencyId: Id;
  createdAt: IsoDateTime;
}

export interface ScheduleInterval {
  tripId: Id;
  from: IsoDateTime;
  to: IsoDateTime;
}

/** id = `driver:${driverId}` | `vehicle:${vehicleId}` — per-resource lock doc (P2 §6.4). */
export interface ScheduleDoc {
  id: string;
  kind: "driver" | "vehicle";
  resourceId: Id;
  intervals: ScheduleInterval[];
  updatedAt: IsoDateTime;
}

// ── Trips ────────────────────────────────────────────────────────────────────
export interface TripVehicleSnapshot {
  vehicleClass: VehicleClass;
  makeModel: string;
  registrationNumber: string;
  bodyType: BodyType;
  photo: FileRef | null;
  imageKey: VehicleImageKey;
}

export interface TripDriverSnapshot {
  fullName: string;
  photo: FileRef | null;
  ratingAvg: number;
  ratingCount: number;
}

export interface TripDoc extends Base {
  agencyId: Id;
  agencyName: string;
  vehicleId: Id;
  vehicle: TripVehicleSnapshot;
  driverId: Id;
  driver: TripDriverSnapshot;
  status: TripStatus;
  /** 2..10, ordered. */
  checkpoints: TripCheckpoint[];
  departureAt: IsoDateTime;
  arrivalAt: IsoDateTime;
  distanceKm: number;
  capacity: { vehicleMaxKg: number; offeredKg: number };
  /** P2 §6 — the ONLY capacity ledger. */
  holds: Record<BookingId, CapacityHold>;
  goods: { accepted: GoodsCategory[]; handlingSupported: SpecialHandling[]; maxPackageKg: number | null; notes: string | null };
  rates: { perKmPaise: number; perKgPaise: number; handlingFeeRupees: number };
  /** `${districtId}|${istDate}` per pickup-able checkpoint (all but the last). Empty unless published. */
  pickupKeys: string[];
  progress: { lastCheckpointIndex: number | null; lastEventAt: IsoDateTime | null };
  counts: { awaiting: number; held: number; delivered: number };
  publishedAt: IsoDateTime | null;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  cancelledAt: IsoDateTime | null;
  cancelReason: string | null;
  version: number;
}

export interface TripEventDoc {
  id: Id;
  tripId: Id;
  type: TripEventType;
  checkpointIndex: number | null;
  at: IsoDateTime;
  clientAt: IsoDateTime | null;
  actor: Actor;
  remarks: string | null;
}

// ── Shipments & bookings ─────────────────────────────────────────────────────
export interface ShipmentPackage {
  weightKg: number;
  goodsCategory: GoodsCategory;
  packageType: PackageType;
  description: string;
  pieces: number;
  specialHandling: SpecialHandling[];
  declaredValueRupees: number | null;
}

export interface ShipmentDoc extends Base {
  customerId: Id;
  source: Address;
  destination: Address;
  receiver: { name: string; phone: Mobile };
  package: ShipmentPackage;
  shippingDate: IsoDate;
  status: "open" | "booked" | "completed" | "withdrawn";
  /** The ONE non-terminal booking (duplicate guard). */
  currentBookingId: BookingId | null;
  bookingIds: BookingId[];
}

export interface BookingDoc extends Base {
  shipmentId: Id;
  tripId: Id;
  customerId: Id;
  agencyId: Id;
  driverId: Id;
  vehicleId: Id;
  status: BookingStatus;
  tab: CustomerTab;
  pickup: { checkpointIndex: number; districtId: DistrictId; placeName: string; expectedDepartureAt: IsoDateTime };
  drop: { checkpointIndex: number; districtId: DistrictId; placeName: string; expectedArrivalAt: IsoDateTime };
  weightKg: number;
  goodsCategory: GoodsCategory;
  specialHandling: SpecialHandling[];
  /** Quote at request; re-locked at accept. */
  pricing: PricingBreakdownV2;
  /** pickup.expectedDepartureAt − respondLeadMinutes */
  respondBy: IsoDateTime;
  acceptedAt: IsoDateTime | null;
  paymentDueAt: IsoDateTime | null;
  paidAt: IsoDateTime | null;
  paymentId: Id | null;
  statusHistory: StatusHistoryEntry[];
  rejection: { reason: RejectReason; note: string | null; at: IsoDateTime } | null;
  cancellation: { reason: CancelReason; note: string | null; at: IsoDateTime; by: Actor } | null;
  reviewed: boolean;
  /** List denormalisation. */
  display: {
    customerName: string;
    agencyName: string;
    routeLabel: string;
    tripDepartureAt: IsoDateTime;
    vehicleReg: string;
    driverName: string;
  };
  /** Agency History search tokens (P2 §8.5). */
  searchTokens: string[];
  version: number;
}

/** id = bookingId. Read only by customer projections and driver OTP verification. */
export interface BookingSecretsDoc {
  id: BookingId;
  pickupOtp: string;
  deliveryOtp: string;
  pickupAttempts: number;
  deliveryAttempts: number;
  pickupUsedAt: IsoDateTime | null;
  deliveryUsedAt: IsoDateTime | null;
  issuedAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface BookingEventDoc {
  id: Id;
  bookingId: BookingId;
  type: TrackingEventType;
  at: IsoDateTime;
  clientAt: IsoDateTime | null;
  actor: Actor;
  checkpointIndex: number | null;
  placeName: string | null;
  remarks: string | null;
  files: FileRef[];
}

// ── Payments ─────────────────────────────────────────────────────────────────
export interface PaymentRefund {
  refundId: string;
  amountPaise: number;
  reason: "customer_cancelled" | "trip_cancelled" | "pickup_refused" | "duplicate_payment" | "late_payment" | string;
  status: "pending" | "succeeded" | "failed";
  requestedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  providerRefundId: string | null;
}

/** id = pay_* = gateway order_id */
export interface PaymentDoc extends Base {
  bookingId: BookingId;
  customerId: Id;
  agencyId: Id;
  provider: PaymentProvider;
  providerEnv: PaymentProviderEnv;
  amountPaise: number;
  currency: "INR";
  status: PaymentStatus;
  idempotencyKey: string;
  providerOrderId: string;
  checkout: { paymentSessionId?: string; devTokenHash?: string };
  expiresAt: IsoDateTime;
  providerPaymentId: string | null;
  methodLabel: string | null;
  confirmation: { source: "webhook" | "verify" | "dev_confirm"; at: IsoDateTime; providerStatus: string } | null;
  failureReason: string | null;
  refund: PaymentRefund | null;
  version: number;
}

/** id = sha256(provider event key) — webhook dedupe */
export interface PaymentEventDoc {
  id: string;
  provider: PaymentProvider;
  type: string;
  orderId: string;
  receivedAt: IsoDateTime;
}

// ── Reviews, earnings, settlements ───────────────────────────────────────────
/** id = bookingId */
export interface ReviewDoc extends Base {
  bookingId: BookingId;
  customerId: Id;
  customerFirstName: string;
  driverId: Id;
  agencyId: Id;
  tripId: Id;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string | null;
}

/** id = bookingId — the settlement unit. */
export interface EarningDoc extends Base {
  bookingId: BookingId;
  agencyId: Id;
  tripId: Id;
  driverId: Id;
  customerPaid: Rupees;
  transportationCharge: Rupees;
  handlingFee: Rupees;
  platformFee: Rupees;
  /** transportationCharge + handlingFee */
  agencyNet: Rupees;
  routeLabel: string;
  deliveredAt: IsoDateTime;
  status: EarningStatus;
  settlementId: Id | null;
  settledAt: IsoDateTime | null;
}

export interface SettlementDoc extends Base {
  agencyId: Id;
  amount: Rupees;
  earningIds: BookingId[];
  /** Bank UTR / reference. */
  reference: string;
  periodThrough: IsoDate;
  settledAt: IsoDateTime;
  /** "ops" (CLI) or the admin user id. */
  recordedBy: string;
}

// ── Notifications, files, jobs, contact ──────────────────────────────────────
export interface NotificationDoc {
  id: Id;
  userId: Id;
  role: Role;
  kind: NotificationKind;
  title: string;
  body: string;
  link: NotificationLink | null;
  createdAt: IsoDateTime;
  readAt: IsoDateTime | null;
}

export interface FileDoc extends Base {
  ownerType: FileOwnerType;
  ownerId: string;
  uploadedBy: Id;
  kind: FileKind;
  /** private/{ownerType}/{ownerId}/{kind}/{fileId}.{ext} */
  storagePath: string;
  contentType: FileContentType;
  sizeBytes: number;
  sha256: string;
  status: "active" | "replaced" | "deleted";
  /** true only for seed files */
  sample: boolean;
}

export type JobType = "refund" | "sms";

export interface RefundJobPayload {
  paymentId: Id;
  refundId: string;
  amountPaise: number;
  reason: string;
}

export interface SmsJobPayload {
  to: Mobile;
  templateId: string;
  vars: Record<string, string>;
}

export interface JobDoc extends Base {
  type: JobType;
  payload: RefundJobPayload | SmsJobPayload;
  status: "pending" | "running" | "succeeded" | "failed";
  attempts: number;
  nextAttemptAt: IsoDateTime;
  lastError: string | null;
}

export interface ContactMessageDoc extends Base {
  name: string;
  /** E.164 or null when only email given. */
  phone: Mobile | null;
  email: string | null;
  role: "customer" | "agency" | "driver" | "other";
  message: string;
  status: "new" | "read" | "closed";
  ipHash: string | null;
}
