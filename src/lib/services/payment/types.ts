/**
 * Gateway-independent payment contract. The client never sees gateway secrets
 * and never decides that a live payment succeeded: in live mode only a
 * server-verified gateway confirmation (verify endpoint / signed webhook) marks
 * a booking paid. Amounts are always derived server-side from the booking.
 */
import type { BookingId, Payment, PaymentMethod } from "@/lib/domain/types";

export interface PayInput {
  bookingId: BookingId;
  method: PaymentMethod;
  /** One key per attempt; replays return the same Payment (no double charge). */
  idempotencyKey: string;
  /** DEMO ONLY: force a failed outcome to exercise the error path. */
  simulateFailure?: boolean;
}

export interface PaymentAdapter {
  readonly mode: "demo" | "live";
  /** Resolves with the recorded Payment (status succeeded/failed). */
  pay(input: PayInput): Promise<Payment>;
}
