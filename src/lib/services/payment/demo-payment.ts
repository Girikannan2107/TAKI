"use client";
/**
 * DEMO payment adapter — no money moves, no gateway is contacted, no card or
 * bank details are collected. Results are labelled "Demo payment" everywhere.
 */
import { recordPayment } from "@/lib/domain/commands";
import { DomainError } from "@/lib/domain/db";
import { useTakiStore } from "@/lib/store";
import type { PayInput, PaymentAdapter } from "./types";

const inFlight = new Map<string, Promise<import("@/lib/domain/types").Payment>>();

export const demoPaymentAdapter: PaymentAdapter = {
  mode: "demo",
  pay(input: PayInput) {
    // Same key while a request is in flight → same promise (double-click safe).
    const existing = inFlight.get(input.idempotencyKey);
    if (existing) return existing;
    const p = (async () => {
      const { session } = useTakiStore.getState();
      if (!session || session.role !== "customer") throw new DomainError("not_customer", "Sign in as a customer to pay.");
      await new Promise((r) => setTimeout(r, 1200));
      return useTakiStore.getState().mutate((db, ctx) =>
        recordPayment(db, ctx, {
          customerId: session.profileId,
          bookingId: input.bookingId,
          method: input.method,
          idempotencyKey: input.idempotencyKey,
          outcome: input.simulateFailure ? "failed" : "succeeded",
          mode: "demo",
          failureReason: input.simulateFailure ? "Demo failure (simulated)." : undefined,
        }),
      );
    })();
    inFlight.set(input.idempotencyKey, p);
    p.finally(() => setTimeout(() => inFlight.delete(input.idempotencyKey), 0)).catch(() => {});
    return p;
  },
};
