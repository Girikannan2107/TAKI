"use client";
import { appMode } from "@/lib/config/env";
import { cashfreePaymentAdapter } from "./cashfree";
import { demoPaymentAdapter } from "./demo-payment";
import type { PaymentAdapter } from "./types";

/** Active payment adapter (demo unless NEXT_PUBLIC_APP_MODE=live). */
export const paymentService: PaymentAdapter = appMode === "live" ? cashfreePaymentAdapter : demoPaymentAdapter;

/** New idempotency key for one payment attempt. */
export function newIdempotencyKey(bookingId: string): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
  return `pay_${bookingId}_${rand}`;
}

export type { PayInput, PaymentAdapter } from "./types";
