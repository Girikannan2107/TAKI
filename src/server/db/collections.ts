import "server-only";
/**
 * Collection names and typed paths (P2 §4.2). Use with the DocStore generics:
 *   const b = await store.get<BookingDoc>(C.bookings, id);
 *   tx.create(sub.bookingEvents(id), eventId, event);
 */
import type * as S from "./schema";

export const C = {
  users: "users",
  phoneIndex: "phoneIndex",
  sessions: "sessions",
  otpChallenges: "otpChallenges",
  rateLimits: "rateLimits",
  idempotency: "idempotency",
  customers: "customers",
  agencies: "agencies",
  drivers: "drivers",
  driverInvites: "driverInvites",
  vehicles: "vehicles",
  registrationIndex: "registrationIndex",
  schedules: "schedules",
  trips: "trips",
  shipments: "shipments",
  bookings: "bookings",
  bookingSecrets: "bookingSecrets",
  payments: "payments",
  paymentEvents: "paymentEvents",
  reviews: "reviews",
  earnings: "earnings",
  settlements: "settlements",
  notifications: "notifications",
  files: "files",
  jobs: "jobs",
  contactMessages: "contactMessages",
} as const;

export type CollectionName = (typeof C)[keyof typeof C];

/** Doc type per top-level collection (for helpers that want inference). */
export interface CollectionTypes {
  users: S.UserDoc;
  phoneIndex: S.PhoneIndexDoc;
  sessions: S.SessionDoc;
  otpChallenges: S.OtpChallengeDoc;
  rateLimits: S.RateLimitDoc;
  idempotency: S.IdempotencyDoc;
  customers: S.CustomerDoc;
  agencies: S.AgencyDoc;
  drivers: S.DriverDoc;
  driverInvites: S.DriverInviteDoc;
  vehicles: S.VehicleDoc;
  registrationIndex: S.RegistrationIndexDoc;
  schedules: S.ScheduleDoc;
  trips: S.TripDoc;
  shipments: S.ShipmentDoc;
  bookings: S.BookingDoc;
  bookingSecrets: S.BookingSecretsDoc;
  payments: S.PaymentDoc;
  paymentEvents: S.PaymentEventDoc;
  reviews: S.ReviewDoc;
  earnings: S.EarningDoc;
  settlements: S.SettlementDoc;
  notifications: S.NotificationDoc;
  files: S.FileDoc;
  jobs: S.JobDoc;
  contactMessages: S.ContactMessageDoc;
}

/** Subcollection paths. */
export const sub = {
  bookingEvents: (bookingId: string) => `bookings/${bookingId}/events`,
  tripEvents: (tripId: string) => `trips/${tripId}/events`,
} as const;

export const scheduleId = {
  driver: (driverId: string) => `driver:${driverId}`,
  vehicle: (vehicleId: string) => `vehicle:${vehicleId}`,
} as const;

export const phoneIndexId = (role: string, e164: string) => `${role}:${e164}`;
