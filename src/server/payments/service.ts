import "server-only";
/**
 * Payment service (P2 §9, §6.3). The amount ALWAYS comes from booking.pricing.totalPayable.
 * Nothing on the client can mark a payment paid: only the webhook, the server-side verify
 * (GET /api/payments/[id]) and the dev gateway's explicit Approve call `confirmPayment`.
 *
 * Order flow: tx (validate + create/reuse `created`) → gateway.createOrder (outside tx) →
 * tx (store checkout, `pending`). A gateway failure marks the payment `failed/gateway_error`.
 */
import type { CreatePaymentOrderResponse, PaymentStatusResponse } from "@/lib/api/contracts/payments";
import { DomainError } from "@/lib/api/contracts/errors";
import { formatDateTime } from "@/lib/format";
import { PAYABLE_STATUSES } from "@/lib/domain/booking-machine";
import { fits } from "@/lib/domain/capacity";
import { V2 } from "@/lib/domain/constants";
import { newId } from "@/lib/domain/ids";
import type { Actor } from "@/lib/domain/model";
import { rupeesToPaiseInt } from "@/lib/domain/pricing";
import { newOtp } from "../core/bookings";
import type { Ctx } from "../core/context";
import { actorOfSession, assertCustomerOwns, bookingEvent, fail, iso, transition, txn, writeEvent } from "../core/internal";
import { applyRefundResult, enqueueJob, runJobsAfterCommit } from "../core/jobs";
import { applyExpiry, dueExpiry, msg, readBundle } from "../core/lifecycle";
import { notifyMany } from "../core/notify";
import { getDocStore } from "../db";
import { C } from "../db/collections";
import type { TxContext } from "../db/docstore";
import type { BookingDoc, BookingSecretsDoc, CustomerDoc, PaymentDoc, PaymentEventDoc } from "../db/schema";
import { appOrigin, devFixedOtps, isProduction, paymentProvider } from "../env";
import { sha256Hex } from "../http/crypto";
import { idempotencyRef, readIdempotency, writeIdempotency } from "../http/idempotency";
import { devGatewayUrl, devTokenFor, devTokenHash, devTokenMatches } from "./dev";
import { gatewayFor, getPaymentGateway } from "./gateway";

export interface ConfirmInput {
  source: "webhook" | "verify" | "dev_confirm";
  status: "paid" | "failed" | "pending" | "expired";
  amountPaise: number | null;
  providerPaymentId: string | null;
  methodLabel: string | null;
  providerStatus: string;
}

const SYSTEM: Actor = { role: "system", userId: null };
const OPEN_PAYMENT = (p: PaymentDoc) => p.status === "created" || p.status === "pending";

function statusResponse(p: PaymentDoc, b: Pick<BookingDoc, "status">): PaymentStatusResponse {
  return {
    paymentId: p.id,
    bookingId: p.bookingId,
    status: p.status,
    bookingStatus: b.status,
    amountRupees: Math.round(p.amountPaise / 100),
    provider: p.provider,
    methodLabel: p.methodLabel,
    failureReason: p.failureReason,
  };
}

function checkoutOf(p: PaymentDoc): CreatePaymentOrderResponse["checkout"] {
  if (p.provider === "dev") return { kind: "dev", url: devGatewayUrl(p.id, devTokenFor(p.id)) };
  return { kind: "cashfree", mode: p.providerEnv === "production" ? "production" : "sandbox", paymentSessionId: p.checkout.paymentSessionId ?? "", orderId: p.id };
}

function orderResponse(p: PaymentDoc, reused: boolean): CreatePaymentOrderResponse {
  return { paymentId: p.id, provider: p.provider, amountRupees: Math.round(p.amountPaise / 100), expiresAt: p.expiresAt, checkout: checkoutOf(p), reused };
}

/** Succeeded → refund_pending with a refund job (duplicate / late payments). */
function refundPayment(tx: TxContext, p: PaymentDoc, reason: string, now: Date): { payment: PaymentDoc; jobId: string } {
  const at = iso(now);
  const refundId = `rf_${p.id}`;
  const payment: PaymentDoc = {
    ...p,
    status: "refund_pending",
    refund: { refundId, amountPaise: p.amountPaise, reason, status: "pending", requestedAt: at, completedAt: null, providerRefundId: null },
    updatedAt: at,
    version: p.version + 1,
  };
  tx.set(C.payments, p.id, payment);
  const job = enqueueJob(tx, "refund", { paymentId: p.id, refundId, amountPaise: p.amountPaise, reason }, now);
  return { payment, jobId: job.id };
}

export const payments = {
  /** POST /api/payments/orders — create or reuse the open payment for a booking. */
  async createOrder(ctx: Ctx, bookingId: string, idempotencyKey: string): Promise<CreatePaymentOrderResponse> {
    if (ctx.actor.role !== "customer") throw new DomainError("forbidden");
    const { now, actor } = ctx;
    const gateway = getPaymentGateway(); // 501 before touching anything when not configured
    const idem = idempotencyRef("payment", actor.userId, idempotencyKey, { bookingId });
    const paymentId = newId("pay");

    const first = await txn(async (tx) => {
      const replay = await readIdempotency(tx, idem, now);
      if (replay) {
        const p = await tx.get<PaymentDoc>(C.payments, (replay.body as { paymentId: string }).paymentId);
        if (p) return { payment: p, reused: true as const, refundJobIds: [] as string[] };
      }
      const bundle = await readBundle(tx, bookingId);
      assertCustomerOwns(actor, bundle?.booking ?? null);
      const { booking: b, trip, payments: existing } = bundle!;
      const kind = dueExpiry(b, trip, existing, now);
      if (kind) {
        const out = applyExpiry(tx, bundle!, kind, now);
        return { failure: fail(kind === "expirePayment" ? "payment_window_closed" : "request_expired"), refundJobIds: out?.refundJobIds ?? [] };
      }
      if (b.paidAt || ["confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"].includes(b.status)) throw new DomainError("already_paid");
      if (!PAYABLE_STATUSES.includes(b.status)) throw new DomainError("invalid_transition", "This booking can't be paid right now.");
      if (!trip) throw new DomainError("invalid_transition");
      const hold = trip.holds[b.id];
      if (!hold) throw new DomainError("payment_window_closed");

      const open = existing.find((p) => OPEN_PAYMENT(p) && Date.parse(p.expiresAt) > now.getTime() && p.provider === gateway.provider);
      if (open) {
        writeIdempotency(tx, idem, 201, { paymentId: open.id }, now);
        return { payment: open, reused: true as const, refundJobIds: [] as string[] };
      }
      const at = iso(now);
      // Starting a checkout extends the unpaid hold to at least now + grace (P2 §5.1 paymentStarted).
      const graceUntil = new Date(now.getTime() + V2.checkoutGraceMinutes * 60_000).toISOString();
      const dueAt = hold.dueAt && hold.dueAt > graceUntil ? hold.dueAt : graceUntil;
      for (const p of existing) if (OPEN_PAYMENT(p)) tx.set(C.payments, p.id, { ...p, status: "cancelled", failureReason: "superseded", updatedAt: at, version: p.version + 1 });
      const payment: PaymentDoc = {
        id: paymentId,
        bookingId: b.id,
        customerId: b.customerId,
        agencyId: b.agencyId,
        provider: gateway.provider,
        providerEnv: gateway.env,
        amountPaise: rupeesToPaiseInt(b.pricing.totalPayable),
        currency: "INR",
        status: "created",
        idempotencyKey,
        providerOrderId: paymentId,
        checkout: gateway.provider === "dev" ? { devTokenHash: devTokenHash(devTokenFor(paymentId)) } : {},
        expiresAt: dueAt,
        providerPaymentId: null,
        methodLabel: null,
        confirmation: null,
        failureReason: null,
        refund: null,
        createdAt: at,
        updatedAt: at,
        version: 1,
      };
      tx.create(C.payments, payment.id, payment);
      const retried = b.status === "payment_failed" ? transition(b, "retryPayment", now, actorOfSession(actor)) : null;
      tx.set(C.bookings, b.id, { ...(retried ?? b), paymentId: payment.id, updatedAt: at, version: (retried ?? b).version + (retried ? 0 : 1) });
      tx.set(C.trips, trip.id, { ...trip, holds: { ...trip.holds, [b.id]: { ...hold, dueAt } }, updatedAt: at, version: trip.version + 1 });
      writeIdempotency(tx, idem, 201, { paymentId: payment.id }, now);
      return { payment, reused: false as const, refundJobIds: [] as string[] };
    });

    if ("failure" in first && first.failure) {
      runJobsAfterCommit(first.refundJobIds, now);
      throw first.failure.error;
    }
    if (first.reused) return orderResponse(first.payment, true);

    const customer = await getDocStore().get<CustomerDoc>(C.customers, actor.userId);
    let checkoutPatch: PaymentDoc["checkout"];
    try {
      const r = await gateway.createOrder({
        paymentId: first.payment.id,
        amountPaise: first.payment.amountPaise,
        customer: { id: actor.userId, phone: actor.phone, name: customer?.fullName ?? actor.name },
        returnUrl: `${appOrigin()}/customer/payment/return?paymentId=${first.payment.id}`,
        notifyUrl: `${appOrigin()}/api/payments/cashfree/webhook`,
        expiresAt: first.payment.expiresAt,
      });
      checkoutPatch = r.checkout.kind === "cashfree" ? { paymentSessionId: r.checkout.paymentSessionId } : first.payment.checkout;
    } catch (e) {
      await txn(async (tx) => {
        const p = await tx.get<PaymentDoc>(C.payments, first.payment.id);
        if (p && p.status === "created") tx.set(C.payments, p.id, { ...p, status: "failed", failureReason: "gateway_error", updatedAt: iso(now), version: p.version + 1 });
      });
      throw e instanceof DomainError ? e : new DomainError("gateway_error");
    }
    const stored = await txn(async (tx) => {
      const p = await tx.get<PaymentDoc>(C.payments, first.payment.id);
      if (!p) throw new DomainError("not_found");
      if (p.status !== "created") return p;
      const next: PaymentDoc = { ...p, status: "pending", checkout: checkoutPatch, updatedAt: iso(now), version: p.version + 1 };
      tx.set(C.payments, p.id, next);
      return next;
    });
    return orderResponse(stored, false);
  },

  /** GET /api/payments/[id] — owner only; when pending, verifies with the provider. */
  async getStatus(ctx: Ctx, paymentId: string): Promise<PaymentStatusResponse> {
    const { now, actor } = ctx;
    const store = getDocStore();
    let p = await store.get<PaymentDoc>(C.payments, paymentId);
    if (!p || actor.role !== "customer" || p.customerId !== actor.userId) throw new DomainError("not_found");
    if (OPEN_PAYMENT(p)) {
      if (p.provider === "cashfree") {
        const s = await gatewayFor("cashfree").fetchOrderStatus(p.id);
        p = await confirmPayment(p.id, { source: "verify", status: s.status, amountPaise: s.amountPaise, providerPaymentId: s.providerPaymentId, methodLabel: s.methodLabel, providerStatus: s.raw }, now);
      } else if (Date.parse(p.expiresAt) <= now.getTime()) {
        p = await confirmPayment(p.id, { source: "verify", status: "expired", amountPaise: null, providerPaymentId: null, methodLabel: null, providerStatus: "dev:expired" }, now);
      }
    }
    // The booking may also be lazily expired by the time the customer polls.
    const b = await store.get<BookingDoc>(C.bookings, p.bookingId);
    return statusResponse(p, b ?? { status: "cancelled" });
  },

  /** POST /api/payments/dev/confirm — dev gateway Approve/Decline (404 unless dev mode). */
  async devConfirm(ctx: Ctx, i: { paymentId: string; outcome: "success" | "failure"; devToken: string }): Promise<PaymentStatusResponse> {
    if (isProduction() || paymentProvider() !== "dev") throw new DomainError("not_found");
    const { now, actor } = ctx;
    const store = getDocStore();
    const p = await store.get<PaymentDoc>(C.payments, i.paymentId);
    if (!p || p.provider !== "dev" || actor.role !== "customer" || p.customerId !== actor.userId) throw new DomainError("not_found");
    if (!devTokenMatches(p.id, i.devToken, p.checkout.devTokenHash)) throw new DomainError("forbidden", "This payment link is not valid.");
    const updated = await confirmPayment(
      p.id,
      i.outcome === "success"
        ? { source: "dev_confirm", status: "paid", amountPaise: p.amountPaise, providerPaymentId: `dev_${p.id}`, methodLabel: "Dev gateway", providerStatus: "dev:approved" }
        : { source: "dev_confirm", status: "failed", amountPaise: null, providerPaymentId: null, methodLabel: null, providerStatus: "dev:declined" },
      now,
    );
    const b = await store.get<BookingDoc>(C.bookings, updated.bookingId);
    return statusResponse(updated, b ?? { status: "cancelled" });
  },

  /** POST /api/payments/cashfree/webhook — raw-body signature check, dedupe, confirm. */
  async handleCashfreeWebhook(req: Request, now: Date): Promise<Response> {
    const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
    let gw;
    try {
      gw = gatewayFor("cashfree");
    } catch (e) {
      const err = e instanceof DomainError ? e : new DomainError("payments_not_configured");
      return json(err.toBody(), err.status);
    }
    const rawBody = await req.text();
    const v = gw.verifyWebhook!({ rawBody, headers: req.headers, now });
    if (!v.ok) {
      const err = new DomainError(v.reason);
      return json(err.toBody(), err.status);
    }
    const ev = v.event;
    if (!ev) return json({ ok: true, ignored: true }, 200);
    const store = getDocStore();
    const eventId = sha256Hex(ev.eventKey);
    if (await store.get<PaymentEventDoc>(C.paymentEvents, eventId)) return json({ ok: true, duplicate: true }, 200);
    const payment = await store.get<PaymentDoc>(C.payments, ev.orderId);
    if (!payment) {
      console.warn("[taki] cashfree webhook for unknown order (ignored)");
      return json({ ok: true, ignored: true }, 200);
    }
    if (ev.type === "refund_status") {
      if (ev.status !== "pending") await applyRefundResult(payment.id, { status: ev.status, providerRefundId: ev.providerRefundId }, now, { final: false });
    } else {
      await confirmPayment(
        payment.id,
        {
          source: "webhook",
          status: ev.type === "payment_succeeded" ? "paid" : "failed",
          amountPaise: ev.amountPaise,
          providerPaymentId: ev.providerPaymentId,
          methodLabel: ev.methodLabel,
          providerStatus: ev.type,
        },
        now,
      );
    }
    const doc: PaymentEventDoc = { id: eventId, provider: "cashfree", type: ev.type, orderId: ev.orderId, receivedAt: iso(now) };
    await store.batchWrite([{ op: "set", col: C.paymentEvents, id: eventId, data: doc }]);
    return json({ ok: true }, 200);
  },

  /** The single confirmation path (idempotent; late/duplicate payments are refunded). */
  confirmPayment,
};

/**
 * The ONE place a payment's outcome is applied (webhook, verify, dev Approve/Decline).
 * Idempotent: a terminal payment is a no-op. Paid payments for a booking that is already
 * paid (duplicate) or no longer payable (late) are refunded automatically.
 */
export async function confirmPayment(paymentId: string, input: ConfirmInput, now: Date): Promise<PaymentDoc> {
  const r = await txn(async (tx) => {
    const p = await tx.get<PaymentDoc>(C.payments, paymentId);
    if (!p) throw new DomainError("not_found");
    const bundle = await readBundle(tx, p.bookingId);
    if (!bundle) throw new DomainError("not_found");
    const { booking: b, trip, agency } = bundle;
    const at = iso(now);
    const jobIds: string[] = [];

    // Already applied (or refunding): nothing to do.
    if (p.status === "succeeded" || p.status === "refund_pending" || p.status === "refunded" || p.status === "refund_failed") return { payment: p, jobIds };
    if (input.status === "pending") return { payment: p, jobIds };

    const confirmation = { source: input.source, at, providerStatus: input.providerStatus };
    if (input.status === "failed" || input.status === "expired") {
      if (p.status === "failed" || p.status === "cancelled") return { payment: p, jobIds };
      const next: PaymentDoc = {
        ...p,
        status: input.status === "failed" ? "failed" : "cancelled",
        failureReason: input.status === "failed" ? "declined" : "expired",
        providerPaymentId: input.providerPaymentId ?? p.providerPaymentId,
        methodLabel: input.methodLabel ?? p.methodLabel,
        confirmation,
        updatedAt: at,
        version: p.version + 1,
      };
      tx.set(C.payments, p.id, next);
      if (input.status === "failed" && b.status === "pending_payment" && b.paymentId === p.id) {
        const nb = transition(b, "paymentFailed", now, SYSTEM)!;
        tx.set(C.bookings, b.id, nb);
        writeEvent(tx, bookingEvent(b.id, "payment_failed", now, SYSTEM));
        notifyMany(tx, [msg.customer(nb, "payment_failed", "Payment failed", `Your payment for ${b.id} didn't go through. You can try again before ${b.paymentDueAt ? formatDateTime(b.paymentDueAt) : "the window closes"}.`)], now);
      }
      return { payment: next, jobIds };
    }

    // ── paid ──
    if (input.amountPaise === null || input.amountPaise !== p.amountPaise) {
      console.error(`[taki] OPS ALERT: amount mismatch on payment ${p.id} (expected ${p.amountPaise}, got ${input.amountPaise})`);
      const next: PaymentDoc = { ...p, status: "failed", failureReason: "amount_mismatch", confirmation, providerPaymentId: input.providerPaymentId, updatedAt: at, version: p.version + 1 };
      tx.set(C.payments, p.id, next);
      return { payment: next, jobIds };
    }
    const succeeded: PaymentDoc = {
      ...p,
      status: "succeeded",
      providerPaymentId: input.providerPaymentId,
      methodLabel: input.methodLabel,
      confirmation,
      failureReason: null,
      updatedAt: at,
      version: p.version + 1,
    };

    // Duplicate: the booking was already paid by another payment.
    if (b.paidAt && b.paymentId !== p.id) {
      const r = refundPayment(tx, succeeded, "duplicate_payment", now);
      notifyMany(tx, [msg.customer(b, "payment_refunded", "Duplicate payment — refund started", `${b.id} was already paid, so we're refunding the extra ₹${Math.round(p.amountPaise / 100)}.`)], now);
      return { payment: r.payment, jobIds: [r.jobId] };
    }

    // Lazy expiry first; if the hold lapsed but the capacity is still free, honour the payment.
    let live = b;
    const hold = trip?.holds[b.id];
    const holdOk = !!trip && !!hold && (hold.kind === "paid" || (hold.dueAt !== null && Date.parse(hold.dueAt) > now.getTime()) || fits(trip, b.weightKg, now, b.id));
    if (PAYABLE_STATUSES.includes(b.status) && !holdOk) {
      const out = applyExpiry(tx, { ...bundle, payments: bundle.payments.filter((x) => x.id !== p.id) }, "expirePayment", now);
      if (out) {
        live = out.booking;
        jobIds.push(...out.refundJobIds);
      }
    } else if (b.status === "awaiting_agency" && dueExpiry(b, trip, [], now)) {
      const out = applyExpiry(tx, bundle, "expireRequest", now);
      if (out) live = out.booking;
    }

    if (!PAYABLE_STATUSES.includes(live.status) || !trip) {
      const r = refundPayment(tx, succeeded, "late_payment", now);
      notifyMany(tx, [msg.customer(b, "payment_refunded", "Payment received after the booking closed", `${b.id} is no longer active, so your ₹${Math.round(p.amountPaise / 100)} is being refunded.`)], now);
      return { payment: r.payment, jobIds: [...jobIds, r.jobId] };
    }

    // Confirm the booking.
    const nb = transition(live, "paymentSucceeded", now, SYSTEM)!;
    nb.paidAt = at;
    nb.paymentId = p.id;
    tx.set(C.payments, p.id, succeeded);
    for (const other of bundle.payments) {
      if (other.id !== p.id && OPEN_PAYMENT(other)) tx.set(C.payments, other.id, { ...other, status: "cancelled", failureReason: "superseded", updatedAt: at, version: other.version + 1 });
    }
    tx.set(C.bookings, b.id, nb);
    tx.set(C.trips, trip.id, { ...trip, holds: { ...trip.holds, [b.id]: { kg: b.weightKg, kind: "paid", dueAt: null } }, updatedAt: at, version: trip.version + 1 });
    const fixed = devFixedOtps();
    const pickupOtp = fixed?.pickup ?? newOtp();
    const secrets: BookingSecretsDoc = {
      id: b.id,
      pickupOtp,
      deliveryOtp: fixed?.delivery ?? newOtp(pickupOtp),
      pickupAttempts: 0,
      deliveryAttempts: 0,
      pickupUsedAt: null,
      deliveryUsedAt: null,
      issuedAt: at,
      updatedAt: at,
    };
    tx.create(C.bookingSecrets, b.id, secrets);
    writeEvent(tx, bookingEvent(b.id, "payment_succeeded", now, SYSTEM));
    writeEvent(tx, bookingEvent(b.id, "confirmed", now, SYSTEM));
    notifyMany(
      tx,
      [
        msg.customer(nb, "payment_succeeded", "Payment received — booking confirmed", `₹${Math.round(p.amountPaise / 100)} received for ${b.id}. Share the pickup code with the driver at pickup.`),
        ...(agency ? [msg.agency(agency, nb, "payment_succeeded", "Booking confirmed", `${b.display.customerName} paid for ${b.id} (${b.display.routeLabel}).`)] : []),
        msg.driver(nb, "shipment_assigned", "New shipment assigned", `Pick up ${b.id} (${b.weightKg} kg) at ${b.pickup.placeName}.`),
      ],
      now,
    );
    return { payment: succeeded, jobIds };
  });
  runJobsAfterCommit(r.jobIds, now);
  return r.payment;
}
