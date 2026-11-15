/**
 * P2 §6.6 overbooking and concurrency suite T1–T10. Runs on the MemoryDocStore (`npm test`)
 * and on the Firestore emulator (`npm run test:emulator`).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { capacityInvariant, effectiveAvailableKg } from "@/lib/domain/capacity";
import { bookings } from "@/server/core/bookings";
import { runSweep } from "@/server/core/sweep";
import { tripsLifecycle } from "@/server/core/trips-lifecycle";
import { getDocStore } from "@/server/db";
import { C } from "@/server/db/collections";
import type { BookingDoc, BookingSecretsDoc, JobDoc, NotificationDoc, PaymentDoc, TripDoc } from "@/server/db/schema";
import { setPaymentGatewayForTests, type PaymentGateway } from "@/server/payments/gateway";
import { confirmPayment, payments } from "@/server/payments/service";
import { ON_EMULATOR, flushAfter, freshStore, rng, settle } from "../../../support/harness";
import { MIN, createShipment, createTrip, createWorld, ctxOf, idemKey, payDev, requestAndAccept, type World } from "../../../support/world";

const T0 = new Date("2026-11-20T04:30:00.000Z"); // 10:00 IST
const TIMEOUT = ON_EMULATOR ? 120_000 : 30_000;

const store = () => getDocStore();
const trip = async (id: string) => (await store().get<TripDoc>(C.trips, id))!;
const tripBookings = async (tripId: string) => store().query<BookingDoc>(C.bookings, { where: [["tripId", "==", tripId]] });

async function invariant(tripId: string, now: Date): Promise<string[]> {
  return capacityInvariant(await trip(tripId), await tripBookings(tripId), now);
}

/** A Cashfree-like fake: checkout is "cashfree"; the order status and webhooks are scripted. */
function fakeCashfree(state: { paid: Set<string> }): PaymentGateway {
  return {
    provider: "cashfree",
    env: "sandbox",
    async createOrder(i) {
      return { checkout: { kind: "cashfree", mode: "sandbox", paymentSessionId: `sess_${i.paymentId}`, orderId: i.paymentId } };
    },
    async fetchOrderStatus(paymentId) {
      const p = await store().get<PaymentDoc>(C.payments, paymentId);
      return state.paid.has(paymentId)
        ? { status: "paid", amountPaise: p!.amountPaise, providerPaymentId: `cf_${paymentId}`, methodLabel: "UPI", raw: "PAID" }
        : { status: "pending", amountPaise: p!.amountPaise, providerPaymentId: null, methodLabel: null, raw: "ACTIVE" };
    },
    verifyWebhook({ rawBody }) {
      const b = JSON.parse(rawBody) as { orderId: string; amountPaise: number };
      return { ok: true, event: { type: "payment_succeeded", orderId: b.orderId, providerPaymentId: `cf_${b.orderId}`, amountPaise: b.amountPaise, methodLabel: "UPI", eventKey: `PAYMENT_SUCCESS_WEBHOOK:${b.orderId}` } };
    },
    async refund(i) {
      return { status: "succeeded", providerRefundId: `cfrf_${i.refundId}` };
    },
    async fetchRefundStatus() {
      return "succeeded";
    },
  };
}

describe(`concurrency T1–T10 (${ON_EMULATOR ? "firestore emulator" : "memory"})`, () => {
  let w: World;
  beforeEach(async () => {
    await freshStore();
    w = await createWorld(T0, { customers: 6 });
  }, TIMEOUT);

  it(
    "T1: 15 concurrent accepts of 100 kg on a 1000 kg trip → exactly 10 held, 5 insufficient_capacity",
    async () => {
      const t = await createTrip(w, { offeredKg: 1000 });
      const reqs: BookingDoc[] = [];
      for (let i = 0; i < 15; i++) {
        const s = await createShipment(w, i % 6, { weightKg: 100 });
        reqs.push((await bookings.request(ctxOf(w.customers[i % 6]!.session, T0), { shipmentId: s.id, tripId: t.id, idempotencyKey: idemKey() })).booking);
      }
      const r = await settle(reqs.map((b) => bookings.accept(ctxOf(w.owner, T0), b.id)));
      expect(r.ok).toHaveLength(10);
      expect(r.errors).toEqual(Array(5).fill("insufficient_capacity"));
      const after = await trip(t.id);
      expect(Object.keys(after.holds)).toHaveLength(10);
      expect(effectiveAvailableKg(after, T0)).toBe(0);
      expect(after.counts).toMatchObject({ awaiting: 5, held: 10 });
      expect(await invariant(t.id, T0)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "T2: accepts racing customer cancels keep holds = accepted − cancelled",
    async () => {
      const t = await createTrip(w, { offeredKg: 1000 });
      const accepted: BookingDoc[] = [];
      for (let i = 0; i < 8; i++) accepted.push(await requestAndAccept(w, t, i % 6, 100));
      const waiting: BookingDoc[] = [];
      for (let i = 0; i < 7; i++) {
        const s = await createShipment(w, i % 6, { weightKg: 100 });
        waiting.push((await bookings.request(ctxOf(w.customers[i % 6]!.session, T0), { shipmentId: s.id, tripId: t.id, idempotencyKey: idemKey() })).booking);
      }
      const custIdx = (b: BookingDoc) => w.customers.findIndex((c) => c.doc.id === b.customerId);
      const ops = [
        ...waiting.map((b) => bookings.accept(ctxOf(w.owner, T0), b.id)),
        ...accepted.slice(0, 5).map((b) => bookings.cancelByCustomer(ctxOf(w.customers[custIdx(b)]!.session, T0), b.id, "Changed plans")),
      ];
      const r = await settle(ops);
      expect(r.errors.every((e) => e === "insufficient_capacity")).toBe(true);
      const all = await tripBookings(t.id);
      const holding = all.filter((b) => ["pending_payment", "payment_failed", "confirmed"].includes(b.status));
      const cancelled = all.filter((b) => b.status === "cancelled");
      expect(cancelled).toHaveLength(5);
      const after = await trip(t.id);
      expect(Object.keys(after.holds).sort()).toEqual(holding.map((b) => b.id).sort());
      expect(holding.length).toBe(8 - 5 + r.ok.length - 5);
      expect(effectiveAvailableKg(after, T0)).toBeGreaterThanOrEqual(0);
      expect(await invariant(t.id, T0)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "T3: an expired unpaid hold is ignored by accept; the sweep later releases only that booking",
    async () => {
      const t = await createTrip(w, { offeredKg: 1000 });
      const s2 = await createShipment(w, 1, { weightKg: 500 });
      const { booking: b2 } = await bookings.request(ctxOf(w.customers[1]!.session, T0), { shipmentId: s2.id, tripId: t.id, idempotencyKey: idemKey() });
      const b1 = await requestAndAccept(w, t, 0, 900);
      // Before expiry it does not fit.
      await expect(bookings.accept(ctxOf(w.owner, T0), b2.id)).rejects.toMatchObject({ code: "insufficient_capacity" });
      const later = new Date(Date.parse(b1.paymentDueAt!) + MIN);
      const a2 = await bookings.accept(ctxOf(w.owner, later), b2.id);
      expect(a2.status).toBe("pending_payment");
      expect((await trip(t.id)).holds[b1.id]).toBeDefined(); // not yet swept
      expect(await invariant(t.id, later)).toEqual([]);

      const sweep = await runSweep(later);
      expect(sweep.expiredPayments).toBe(1);
      const after = await trip(t.id);
      expect(after.holds[b1.id]).toBeUndefined();
      expect(after.holds[b2.id]).toMatchObject({ kg: 500, kind: "unpaid" });
      const nb1 = (await store().get<BookingDoc>(C.bookings, b1.id))!;
      expect(nb1.status).toBe("cancelled");
      expect(nb1.cancellation?.reason).toBe("payment_window_expired");
      expect(await invariant(t.id, later)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "T4: 10 concurrent requests with the same Idempotency-Key → one booking, 9 replays",
    async () => {
      const t = await createTrip(w);
      const s = await createShipment(w, 0, { weightKg: 100 });
      const key = idemKey();
      const ctx = ctxOf(w.customers[0]!.session, T0);
      const r = await settle(Array.from({ length: 10 }, () => bookings.request(ctx, { shipmentId: s.id, tripId: t.id, idempotencyKey: key })));
      expect(r.errors).toEqual([]);
      expect(new Set(r.ok.map((x) => x.booking.id)).size).toBe(1);
      expect(r.ok.filter((x) => x.replayed)).toHaveLength(9);
      expect(await tripBookings(t.id)).toHaveLength(1);
      expect((await trip(t.id)).counts.awaiting).toBe(1);
    },
    TIMEOUT,
  );

  it(
    "T5: two concurrent requests for one shipment with different keys → 1 booking, 1 × shipment_has_open_booking",
    async () => {
      const t = await createTrip(w);
      const s = await createShipment(w, 0, { weightKg: 100 });
      const ctx = ctxOf(w.customers[0]!.session, T0);
      const r = await settle([bookings.request(ctx, { shipmentId: s.id, tripId: t.id, idempotencyKey: idemKey() }), bookings.request(ctx, { shipmentId: s.id, tripId: t.id, idempotencyKey: idemKey() })]);
      expect(r.ok).toHaveLength(1);
      expect(r.errors).toEqual(["shipment_has_open_booking"]);
      expect(await tripBookings(t.id)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    "T6: webhook and verify confirm the same payment concurrently → confirmed once",
    async () => {
      const state = { paid: new Set<string>() };
      setPaymentGatewayForTests(fakeCashfree(state));
      const t = await createTrip(w);
      const b = await requestAndAccept(w, t, 0, 200);
      const ctx = ctxOf(w.customers[0]!.session, T0);
      const order = await payments.createOrder(ctx, b.id, idemKey());
      expect(order.checkout.kind).toBe("cashfree");
      state.paid.add(order.paymentId);
      const p = (await store().get<PaymentDoc>(C.payments, order.paymentId))!;
      const webhook = new Request("http://localhost/api/payments/cashfree/webhook", { method: "POST", body: JSON.stringify({ orderId: p.id, amountPaise: p.amountPaise }) });
      const [res, status] = await Promise.all([payments.handleCashfreeWebhook(webhook, T0), payments.getStatus(ctx, p.id)]);
      expect(res.status).toBe(200);
      expect(["succeeded"]).toContain((await store().get<PaymentDoc>(C.payments, p.id))!.status);
      expect(status.bookingStatus === "confirmed" || status.bookingStatus === "pending_payment").toBe(true);
      const nb = (await store().get<BookingDoc>(C.bookings, b.id))!;
      expect(nb.status).toBe("confirmed");
      expect(nb.statusHistory.filter((h) => h.status === "confirmed")).toHaveLength(1);
      expect(await store().get<BookingSecretsDoc>(C.bookingSecrets, b.id)).not.toBeNull();
      const notes = await store().query<NotificationDoc>(C.notifications, { where: [["userId", "==", w.customers[0]!.doc.id]] });
      expect(notes.filter((n) => n.kind === "payment_succeeded")).toHaveLength(1);
      expect((await trip(t.id)).holds[b.id]).toMatchObject({ kind: "paid" });
      // Replayed webhook: acknowledged, no effect.
      const again = await payments.handleCashfreeWebhook(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ orderId: p.id, amountPaise: p.amountPaise }) }), T0);
      expect(await again.json()).toMatchObject({ ok: true });
    },
    TIMEOUT,
  );

  it(
    "T7: a second payment succeeding for an already confirmed booking is refunded (duplicate)",
    async () => {
      const t = await createTrip(w);
      const b = await requestAndAccept(w, t, 0, 200);
      const ctx = ctxOf(w.customers[0]!.session, T0);
      const devOrder = await payments.createOrder(ctx, b.id, idemKey()); // dev payment, left pending
      setPaymentGatewayForTests(fakeCashfree({ paid: new Set() }));
      const cfOrder = await payments.createOrder(ctx, b.id, idemKey()); // supersedes the dev one
      expect(cfOrder.paymentId).not.toBe(devOrder.paymentId);
      const cf = (await store().get<PaymentDoc>(C.payments, cfOrder.paymentId))!;
      await confirmPayment(cf.id, { source: "webhook", status: "paid", amountPaise: cf.amountPaise, providerPaymentId: "cf_1", methodLabel: "UPI", providerStatus: "PAID" }, T0);
      const dev = (await store().get<PaymentDoc>(C.payments, devOrder.paymentId))!;
      const dup = await confirmPayment(dev.id, { source: "dev_confirm", status: "paid", amountPaise: dev.amountPaise, providerPaymentId: "dev_1", methodLabel: "Dev", providerStatus: "dev:approved" }, T0);
      expect(dup.status).toBe("refund_pending");
      expect(dup.refund?.reason).toBe("duplicate_payment");
      const jobs = await store().query<JobDoc>(C.jobs, { where: [["type", "==", "refund"]] });
      expect(jobs.map((j) => (j.payload as { paymentId: string }).paymentId)).toContain(dev.id);
      const nb = (await store().get<BookingDoc>(C.bookings, b.id))!;
      expect(nb).toMatchObject({ status: "confirmed", paymentId: cf.id });
      await flushAfter();
      expect((await store().get<PaymentDoc>(C.payments, dev.id))!.status).toBe("refunded");
    },
    TIMEOUT,
  );

  it(
    "T8: payment succeeding after the window expired and the booking was cancelled → late refund",
    async () => {
      const t = await createTrip(w);
      const b = await requestAndAccept(w, t, 0, 200);
      const ctx = ctxOf(w.customers[0]!.session, T0);
      const order = await payments.createOrder(ctx, b.id, idemKey());
      const late = new Date(Date.parse(b.paymentDueAt!) + 20 * MIN);
      const sweep = await runSweep(late);
      expect(sweep.expiredPayments).toBe(1);
      expect((await store().get<BookingDoc>(C.bookings, b.id))!.status).toBe("cancelled");
      const p = (await store().get<PaymentDoc>(C.payments, order.paymentId))!;
      const out = await confirmPayment(p.id, { source: "dev_confirm", status: "paid", amountPaise: p.amountPaise, providerPaymentId: "dev_late", methodLabel: "Dev", providerStatus: "dev:approved" }, late);
      expect(out.status).toBe("refund_pending");
      expect(out.refund?.reason).toBe("late_payment");
      expect((await store().get<BookingDoc>(C.bookings, b.id))!.status).toBe("cancelled");
      expect((await trip(t.id)).holds[b.id]).toBeUndefined();
      await flushAfter();
      expect((await store().get<PaymentDoc>(C.payments, p.id))!.status).toBe("refunded");
    },
    TIMEOUT,
  );

  it(
    "T9: two concurrent publishes for one driver with overlapping times → 1 published, 1 driver_schedule_conflict",
    async () => {
      const a = await createTrip(w, { publish: false, vehicle: 0, driver: 0 });
      const b = await createTrip(w, { publish: false, vehicle: 1, driver: 0, departInMin: 48 * 60 + 90 });
      const r = await settle([tripsLifecycle.publish(ctxOf(w.owner, T0), a.id), tripsLifecycle.publish(ctxOf(w.owner, T0), b.id)]);
      expect(r.ok).toHaveLength(1);
      expect(r.errors).toEqual(["driver_schedule_conflict"]);
      const statuses = [(await trip(a.id)).status, (await trip(b.id)).status].sort();
      expect(statuses).toEqual(["draft", "published"]);
      // Same vehicle, different drivers → vehicle conflict.
      const c = await createTrip(w, { publish: false, vehicle: r.ok[0]!.vehicleId === w.vehicles[0]!.id ? 0 : 1, driver: 1, departInMin: 48 * 60 + 30 });
      await expect(tripsLifecycle.publish(ctxOf(w.owner, T0), c.id)).rejects.toMatchObject({ code: "vehicle_schedule_conflict" });
    },
    TIMEOUT,
  );

  it(
    "T10: seeded random interleaving keeps capacityInvariant after every step",
    async () => {
      const random = rng(20261113);
      const t = await createTrip(w, { offeredKg: 1000, departInMin: 72 * 60 });
      let now = new Date(T0);
      const live = new Map<string, number>(); // bookingId → customer index
      const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(random() * xs.length)];
      const iterations = ON_EMULATOR ? 120 : 200;
      const counts: Record<string, number> = {};
      for (let step = 0; step < iterations; step++) {
        const op = pick(["request", "request", "accept", "accept", "reject", "cancel", "pay", "fail", "expire", "concurrent"])!;
        counts[op] = (counts[op] ?? 0) + 1;
        const custOf = (b: BookingDoc) => live.get(b.id) ?? w.customers.findIndex((c) => c.doc.id === b.customerId);
        const act = async (kind: string): Promise<unknown> => {
          const fresh = await tripBookings(t.id);
          const sel = (s: string[]) => fresh.filter((b) => s.includes(b.status));
          if (kind === "request") {
            const c = Math.floor(random() * w.customers.length);
            const s = await createShipment(w, c, { weightKg: 50 + Math.floor(random() * 8) * 50 });
            const r = await bookings.request(ctxOf(w.customers[c]!.session, now), { shipmentId: s.id, tripId: t.id, idempotencyKey: idemKey() });
            live.set(r.booking.id, c);
            return r;
          }
          if (kind === "accept") {
            const b = pick(sel(["awaiting_agency"]));
            return b && bookings.accept(ctxOf(w.owner, now), b.id);
          }
          if (kind === "reject") {
            const b = pick(sel(["awaiting_agency"]));
            return b && bookings.reject(ctxOf(w.owner, now), b.id, "Vehicle is full");
          }
          if (kind === "cancel") {
            const b = pick(sel(["awaiting_agency", "pending_payment", "payment_failed", "confirmed"]));
            return b && bookings.cancelByCustomer(ctxOf(w.customers[custOf(b)]!.session, now), b.id);
          }
          if (kind === "pay") {
            const b = pick(sel(["pending_payment", "payment_failed"]));
            return b && payDev(w, custOf(b), b.id, now);
          }
          if (kind === "fail") {
            const b = pick(sel(["pending_payment"]));
            if (!b) return;
            const order = await payments.createOrder(ctxOf(w.customers[custOf(b)]!.session, now), b.id, idemKey());
            return confirmPayment(order.paymentId, { source: "dev_confirm", status: "failed", amountPaise: null, providerPaymentId: null, methodLabel: null, providerStatus: "dev:declined" }, now);
          }
          return undefined;
        };
        try {
          if (op === "expire") {
            now = new Date(now.getTime() + (30 + Math.floor(random() * 90)) * MIN);
            await runSweep(now);
          } else if (op === "concurrent") {
            const kinds = Array.from({ length: 3 }, () => pick(["accept", "accept", "cancel", "pay", "request", "reject"])!);
            await Promise.allSettled(kinds.map((k) => act(k)));
          } else {
            await act(op);
          }
        } catch (e) {
          const code = (e as { code?: string }).code;
          // Domain refusals are fine (capacity, closed windows, races); anything else is a bug.
          expect(["insufficient_capacity", "payment_window_closed", "request_expired", "invalid_transition", "departed", "already_paid", "trip_not_bookable"]).toContain(code);
        }
        const problems = await invariant(t.id, now);
        if (problems.length) throw new Error(`step ${step} (${op}) broke the invariant: ${problems.join("; ")}`);
      }
      await flushAfter();
      expect(await invariant(t.id, now)).toEqual([]);
      // Every paid-then-closed payment has a refund queued or done.
      const pays = await store().query<PaymentDoc>(C.payments, {});
      for (const p of pays.filter((x) => x.status === "succeeded")) {
        const b = (await store().get<BookingDoc>(C.bookings, p.bookingId))!;
        expect(["confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"]).toContain(b.status);
      }
      expect(Object.keys(counts).length).toBeGreaterThan(5);
    },
    ON_EMULATOR ? 600_000 : 120_000,
  );
});
