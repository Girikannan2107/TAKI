import "server-only";
/**
 * Booking commands (P2 §5.1, §6.2). EVERY cross-role booking state transition goes through
 * here, each in one Firestore transaction with its events, capacity holds, notifications,
 * idempotency record and outbox jobs. Callers (route handlers) pass `{ now, actor: session }`.
 */
import { DomainError } from "@/lib/api/contracts/errors";
import type { BookingId, Id, IsoDateTime } from "@/lib/domain/model";
import type { BookingDoc, BookingEventDoc, BookingSecretsDoc, ReviewDoc } from "../db/schema";
import type { Ctx } from "./context";

const notImplemented = (): never => {
  throw new DomainError("not_implemented");
};

export interface RequestBookingResult {
  booking: BookingDoc;
  /** true when the Idempotency-Key replayed an earlier request (respond 200, not 201). */
  replayed: boolean;
}

export const bookings = {
  /** Customer requests a trip for an open shipment. Requires an Idempotency-Key. */
  async request(_ctx: Ctx, _i: { shipmentId: Id; tripId: Id; idempotencyKey: string }): Promise<RequestBookingResult> {
    return notImplemented();
  },
  /** Agency accepts: capacity hold (unpaid, dueAt), pricing re-locked, payment window opens. */
  async accept(_ctx: Ctx, _bookingId: BookingId): Promise<BookingDoc> {
    return notImplemented();
  },
  /** Agency rejects with a reason (3–300 chars). */
  async reject(_ctx: Ctx, _bookingId: BookingId, _reason: string): Promise<BookingDoc> {
    return notImplemented();
  },
  /** Customer cancels before pickup; paid bookings get a refund job. */
  async cancelByCustomer(_ctx: Ctx, _bookingId: BookingId, _note?: string): Promise<BookingDoc> {
    return notImplemented();
  },
  /** Assigned driver refuses at pickup (e.g. prohibited goods); full refund. */
  async refusePickup(_ctx: Ctx, _bookingId: BookingId, _reason: string): Promise<BookingDoc> {
    return notImplemented();
  },
  /** Assigned driver confirms pickup with the customer's pickup OTP. */
  async pickup(_ctx: Ctx, _bookingId: BookingId, _otp: string, _remarks?: string, _clientAt?: IsoDateTime): Promise<BookingDoc> {
    return notImplemented();
  },
  /** Manual fallback (normally automatic on departing a checkpoint ≥ pickup). */
  async startTransit(_ctx: Ctx, _bookingId: BookingId, _remarks?: string): Promise<BookingDoc> {
    return notImplemented();
  },
  /** Manual fallback (normally automatic on arriving at the drop checkpoint). */
  async outForDelivery(_ctx: Ctx, _bookingId: BookingId, _remarks?: string): Promise<BookingDoc> {
    return notImplemented();
  },
  /** Delivery OTP + proof files (uploaded beforehand via files/uploads.ts). */
  async deliver(_ctx: Ctx, _bookingId: BookingId, _i: { otp: string; proofFileIds: Id[]; remarks?: string; clientAt?: IsoDateTime }): Promise<BookingDoc> {
    return notImplemented();
  },
  /** Driver remark on a booking (visible to customer and agency). */
  async addRemark(_ctx: Ctx, _bookingId: BookingId, _text: string): Promise<BookingEventDoc> {
    return notImplemented();
  },
  /** Customer review after delivery (once). */
  async review(_ctx: Ctx, _bookingId: BookingId, _i: { rating: number; comment?: string }): Promise<ReviewDoc> {
    return notImplemented();
  },
  /** Customer regenerates an OTP — only after the driver exhausted its attempts. */
  async regenerateOtp(_ctx: Ctx, _bookingId: BookingId, _which: "pickup" | "delivery"): Promise<BookingSecretsDoc> {
    return notImplemented();
  },
};
