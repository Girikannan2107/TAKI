/**
 * Payments (P2 §9, §6.3): the dev gateway never auto-succeeds; idempotent order creation;
 * amount mismatch; decline and retry; Cashfree webhook signature, stale timestamp, replay and
 * refund-status handling (Cashfree HTTP stubbed with fetch). Runs on memory and the emulator.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDocStore } from "@/server/db";
import { C } from "@/server/db/collections";
import type { BookingDoc, JobDoc, PaymentDoc, TripDoc } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { devTokenFor } from "@/server/payments/dev";
import { confirmPayment, payments } from "@/server/payments/service";
import { runDueJobs } from "@/server/core/jobs";
import { bookings } from "@/server/core/bookings";
import { ON_EMULATOR, flushAfter, freshStore } from "../../../support/harness";
import { MIN, createTrip, createWorld, ctxOf, idemKey, requestAndAccept, type World } from "../../../support/world";

const T0 = new Date("2026-11-20T04:30:00.000Z");
const TIMEOUT = ON_EMULATOR ? 120_000 : 20_000;
const store = () => getDocStore();
const get = async <T>(col: string, id: string) => (await store().get<T>(col, id))!;
const SECRET = "cf_test_secret_key";

function signed(body: unknown, at: Date, secret = SECRET): Request {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(at.getTime() / 1000));
  const sig = createHmac("sha256", secret).update(ts + raw, "utf8").digest("base64");
  return new Request("http://localhost/api/payments/cashfree/webhook", { method: "POST", body: raw, headers: { "x-webhook-signature": sig, "x-webhook-timestamp": ts, "content-type": "application/json" } });
}

describe(`payments (${ON_EMULATOR ? "firestore emulator" : "memory"})`, () => {
  let w: World;
  let booking: BookingDoc;
  beforeEach(async () => {
    await freshStore();
    w = await createWorld(T0, { customers: 2 });
    const t = await createTrip(w);
    booking = await requestAndAccept(w, t, 0, 200);
  }, TIMEOUT);

  describe("dev gateway", () => {
    it(
      "stays pending until the explicit Approve; the token and owner are checked",
      async () => {
        const ctx = ctxOf(w.customers[0]!.session, T0);
        const key = idemKey();
        const order = await payments.createOrder(ctx, booking.id, key);
        expect(order).toMatchObject({ provider: "dev", reused: false, amountRupees: booking.pricing.totalPayable });
        expect(order.checkout.kind).toBe("dev");
        // Same key → same payment; another key while one is open → reused too.
        expect((await payments.createOrder(ctx, booking.id, key)).paymentId).toBe(order.paymentId);
        expect((await payments.createOrder(ctx, booking.id, idemKey())).paymentId).toBe(order.paymentId);
        // Polling never confirms a dev payment.
        expect(await payments.getStatus(ctx, order.paymentId)).toMatchObject({ status: "pending", bookingStatus: "pending_payment" });
        // Wrong token / wrong customer.
        await expect(payments.devConfirm(ctx, { paymentId: order.paymentId, outcome: "success", devToken: "x".repeat(32) })).rejects.toMatchObject({ code: "forbidden" });
        await expect(payments.devConfirm(ctxOf(w.customers[1]!.session, T0), { paymentId: order.paymentId, outcome: "success", devToken: devTokenFor(order.paymentId) })).rejects.toMatchObject({ code: "not_found" });
        await expect(payments.getStatus(ctxOf(w.customers[1]!.session, T0), order.paymentId)).rejects.toMatchObject({ code: "not_found" });
        const ok = await payments.devConfirm(ctx, { paymentId: order.paymentId, outcome: "success", devToken: devTokenFor(order.paymentId) });
        expect(ok).toMatchObject({ status: "succeeded", bookingStatus: "confirmed", methodLabel: "Dev gateway" });
        await expect(payments.createOrder(ctx, booking.id, idemKey())).rejects.toMatchObject({ code: "already_paid" });
        // Replaying Approve is a no-op.
        expect((await payments.devConfirm(ctx, { paymentId: order.paymentId, outcome: "success", devToken: devTokenFor(order.paymentId) })).status).toBe("succeeded");
      },
      TIMEOUT,
    );

    it(
      "decline → payment_failed; a retry with a new order confirms",
      async () => {
        const ctx = ctxOf(w.customers[0]!.session, T0);
        const first = await payments.createOrder(ctx, booking.id, idemKey());
        const declined = await payments.devConfirm(ctx, { paymentId: first.paymentId, outcome: "failure", devToken: devTokenFor(first.paymentId) });
        expect(declined).toMatchObject({ status: "failed", bookingStatus: "payment_failed" });
        const second = await payments.createOrder(ctx, booking.id, idemKey());
        expect(second.paymentId).not.toBe(first.paymentId);
        expect((await get<BookingDoc>(C.bookings, booking.id)).status).toBe("pending_payment");
        const ok = await payments.devConfirm(ctx, { paymentId: second.paymentId, outcome: "success", devToken: devTokenFor(second.paymentId) });
        expect(ok.bookingStatus).toBe("confirmed");
      },
      TIMEOUT,
    );

    it(
      "an amount mismatch fails the payment and never confirms the booking",
      async () => {
        const ctx = ctxOf(w.customers[0]!.session, T0);
        const order = await payments.createOrder(ctx, booking.id, idemKey());
        const p = await confirmPayment(order.paymentId, { source: "webhook", status: "paid", amountPaise: 100, providerPaymentId: "x", methodLabel: null, providerStatus: "PAID" }, T0);
        expect(p).toMatchObject({ status: "failed", failureReason: "amount_mismatch" });
        expect((await get<BookingDoc>(C.bookings, booking.id)).status).toBe("pending_payment");
      },
      TIMEOUT,
    );

    it(
      "starting a checkout extends an unpaid hold by the grace period; an expired order is closed on poll",
      async () => {
        const ctx = ctxOf(w.customers[0]!.session, T0);
        const nearDue = new Date(Date.parse(booking.paymentDueAt!) - 5 * MIN);
        const order = await payments.createOrder(ctxOf(w.customers[0]!.session, nearDue), booking.id, idemKey());
        const trip = await get<TripDoc>(C.trips, booking.tripId);
        expect(Date.parse(trip.holds[booking.id]!.dueAt!)).toBe(nearDue.getTime() + 15 * MIN);
        const after = new Date(nearDue.getTime() + 16 * MIN);
        const st = await payments.getStatus({ ...ctx, now: after }, order.paymentId);
        expect(st.status).toBe("cancelled");
      },
      TIMEOUT,
    );
  });

  describe("cashfree", () => {
    const fetchMock = vi.fn<typeof fetch>();
    beforeEach(() => {
      process.env.PAYMENT_PROVIDER = "cashfree";
      process.env.CASHFREE_APP_ID = "cf_app";
      process.env.CASHFREE_SECRET_KEY = SECRET;
      process.env.CASHFREE_ENV = "sandbox";
      resetEnvCache();
      fetchMock.mockReset();
      const real = globalThis.fetch;
      fetchMock.mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith("https://sandbox.cashfree.com/")) return real(input, init); // emulator traffic
        if (url.endsWith("/orders") && init?.method === "POST") return Response.json({ order_id: JSON.parse(String(init.body)).order_id, payment_session_id: "session_abc", order_status: "ACTIVE" });
        if (url.includes("/refunds") && init?.method === "POST") return Response.json({ refund_id: JSON.parse(String(init.body)).refund_id, cf_refund_id: 991, refund_status: "PENDING" });
        if (url.includes("/refunds/")) return Response.json({ refund_status: "PENDING" });
        if (url.endsWith("/payments")) return Response.json([]);
        return Response.json({ order_status: "ACTIVE", order_amount: 1 });
      });
      vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.PAYMENT_PROVIDER;
      delete process.env.CASHFREE_APP_ID;
      delete process.env.CASHFREE_SECRET_KEY;
      delete process.env.CASHFREE_ENV;
      resetEnvCache();
    });

    it(
      "creates a sandbox order and confirms only from a correctly signed, fresh webhook (once)",
      async () => {
        const ctx = ctxOf(w.customers[0]!.session, T0);
        const order = await payments.createOrder(ctx, booking.id, idemKey());
        expect(order.checkout).toEqual({ kind: "cashfree", mode: "sandbox", paymentSessionId: "session_abc", orderId: order.paymentId });
        const p = await get<PaymentDoc>(C.payments, order.paymentId);
        const body = { type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: p.id, order_amount: p.amountPaise / 100 }, payment: { cf_payment_id: 5001, payment_status: "SUCCESS", payment_amount: p.amountPaise / 100, payment_group: "upi" } } };

        const forged = await payments.handleCashfreeWebhook(signed(body, T0, "wrong-secret"), T0);
        expect(forged.status).toBe(401);
        const stale = await payments.handleCashfreeWebhook(signed(body, new Date(T0.getTime() - 10 * MIN)), T0);
        expect(stale.status).toBe(401);
        expect((await stale.json()).error.code).toBe("stale_timestamp");
        expect((await get<BookingDoc>(C.bookings, booking.id)).status).toBe("pending_payment");

        const ok = await payments.handleCashfreeWebhook(signed(body, T0), T0);
        expect(ok.status).toBe(200);
        expect(await get<BookingDoc>(C.bookings, booking.id)).toMatchObject({ status: "confirmed", paymentId: p.id });
        expect((await get<PaymentDoc>(C.payments, p.id)).methodLabel).toMatch(/upi/i);
        const replay = await payments.handleCashfreeWebhook(signed(body, T0), T0);
        expect(await replay.json()).toMatchObject({ duplicate: true });

        // Cancel → refund job → gateway says PENDING → REFUND_STATUS webhook completes it.
        await bookings.cancelByCustomer(ctx, booking.id);
        await flushAfter();
        expect((await get<PaymentDoc>(C.payments, p.id)).status).toBe("refund_pending");
        const refundHook = { type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_id: `rf_${p.id}`, order_id: p.id, cf_refund_id: 991, refund_status: "SUCCESS" } } };
        expect((await payments.handleCashfreeWebhook(signed(refundHook, T0), T0)).status).toBe(200);
        expect((await get<PaymentDoc>(C.payments, p.id)).status).toBe("refunded");
        // The job is retried later and sees the payment already refunded.
        await runDueJobs(new Date(T0.getTime() + 2 * 60 * MIN));
        const jobs = await store().query<JobDoc>(C.jobs, {});
        expect(jobs.map((j) => j.status)).toEqual(["succeeded"]);
      },
      TIMEOUT,
    );

    it(
      "without Cashfree keys, order creation answers payments_not_configured",
      async () => {
        delete process.env.CASHFREE_APP_ID;
        resetEnvCache();
        await expect(payments.createOrder(ctxOf(w.customers[0]!.session, T0), booking.id, idemKey())).rejects.toMatchObject({ code: "payments_not_configured" });
      },
      TIMEOUT,
    );
  });
});
