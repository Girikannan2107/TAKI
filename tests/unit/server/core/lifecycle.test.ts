/**
 * Core booking + trip lifecycle (P2 §5.1, §5.2) end to end through `@/server/core`:
 * request → accept → pay → pickup (OTP) → checkpoints (auto transitions) → deliver (OTP + proof)
 * → complete → review → earnings → settlement; plus reject, cancel/refund, trip cancel cascade,
 * lazy expiry, publish guards and ownership. Runs on memory and on the emulator.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { newId } from "@/lib/domain/ids";
import { bookings } from "@/server/core/bookings";
import { agencyEarnings, recordSettlement } from "@/server/core/earnings";
import { listNotifications, markRead, unreadCount } from "@/server/core/notify";
import { listReviews } from "@/server/core/reviews";
import { runSweep } from "@/server/core/sweep";
import { loadTracking } from "@/server/core/tracking";
import { nextStep, tripsLifecycle } from "@/server/core/trips-lifecycle";
import { verification } from "@/server/core/verification";
import { getDocStore } from "@/server/db";
import { C, scheduleId } from "@/server/db/collections";
import type { AgencyDoc, BookingDoc, BookingSecretsDoc, DriverDoc, EarningDoc, FileDoc, JobDoc, PaymentDoc, ScheduleDoc, ShipmentDoc, TripDoc } from "@/server/db/schema";
import { ON_EMULATOR, flushAfter, freshStore } from "../../../support/harness";
import { HOUR, MIN, createShipment, createTrip, createWorld, ctxOf, idemKey, payDev, requestAndAccept, type World } from "../../../support/world";

const T0 = new Date("2026-11-20T04:30:00.000Z");
const TIMEOUT = ON_EMULATOR ? 120_000 : 20_000;
const store = () => getDocStore();
const get = async <T>(col: string, id: string) => (await store().get<T>(col, id))!;

async function proofFile(bookingId: string, driverId: string, now: Date): Promise<string> {
  const id = newId("fil");
  const at = now.toISOString();
  const doc: FileDoc = {
    id,
    ownerType: "booking",
    ownerId: bookingId,
    uploadedBy: driverId,
    kind: "delivery_proof",
    storagePath: `private/booking/${bookingId}/delivery_proof/${id}.jpg`,
    contentType: "image/jpeg",
    sizeBytes: 1234,
    sha256: "0".repeat(64),
    status: "active",
    sample: false,
    createdAt: at,
    updatedAt: at,
  };
  await store().batchWrite([{ op: "create", col: C.files, id, data: doc }]);
  return id;
}

describe(`core lifecycle (${ON_EMULATOR ? "firestore emulator" : "memory"})`, () => {
  let w: World;
  beforeEach(async () => {
    await freshStore();
    w = await createWorld(T0, { customers: 3 });
  }, TIMEOUT);

  it(
    "runs a booking from request to settlement through real events only",
    async () => {
      const t = await createTrip(w, { offeredKg: 1000 });
      expect(t.status).toBe("published");
      expect(t.pickupKeys.length).toBe(3);
      const s = await createShipment(w, 0, { weightKg: 250, to: "salem", specialHandling: ["fragile"] });
      const cust = ctxOf(w.customers[0]!.session, T0);
      const { booking: req } = await bookings.request(cust, { shipmentId: s.id, tripId: t.id, idempotencyKey: idemKey() });
      expect(req).toMatchObject({ status: "awaiting_agency", tab: "pending", weightKg: 250 });
      expect(req.pricing.handlingFee).toBeGreaterThan(0);
      expect((await get<ShipmentDoc>(C.shipments, s.id)).currentBookingId).toBe(req.id);

      const accepted = await bookings.accept(ctxOf(w.owner, T0), req.id);
      expect(accepted.status).toBe("pending_payment");
      expect(Date.parse(accepted.paymentDueAt!)).toBe(T0.getTime() + 120 * MIN);
      expect((await get<TripDoc>(C.trips, t.id)).holds[req.id]).toMatchObject({ kg: 250, kind: "unpaid" });

      // Dev gateway: nothing happens until the explicit Approve.
      const paid = await payDev(w, 0, req.id);
      expect(paid).toMatchObject({ status: "succeeded", bookingStatus: "confirmed" });
      const secrets = await get<BookingSecretsDoc>(C.bookingSecrets, req.id);
      expect(secrets.pickupOtp).toMatch(/^\d{6}$/);
      expect(secrets.deliveryOtp).not.toBe(secrets.pickupOtp);

      const driver = w.drivers[0]!.session;
      const nearDeparture = new Date(Date.parse(t.departureAt) - 30 * MIN);
      const dctx = ctxOf(driver, nearDeparture);
      await expect(bookings.pickup(dctx, req.id, secrets.pickupOtp === "000000" ? "111111" : "000000")).rejects.toMatchObject({ code: "otp_invalid" });
      expect((await get<BookingSecretsDoc>(C.bookingSecrets, req.id)).pickupAttempts).toBe(1);
      const picked = await bookings.pickup(dctx, req.id, secrets.pickupOtp, "Loaded 4 cartons");
      expect(picked.status).toBe("picked_up");
      expect(picked.tab).toBe("picked_up");

      // Checkpoints: depart 0 starts the trip and moves the booking to in_transit.
      await expect(tripsLifecycle.checkpoint(dctx, t.id, 1, "arrive", {})).rejects.toMatchObject({ code: "checkpoint_out_of_order" });
      let trip = await tripsLifecycle.checkpoint(dctx, t.id, 0, "depart", {});
      expect(trip.status).toBe("in_progress");
      expect((await get<BookingDoc>(C.bookings, req.id)).status).toBe("in_transit");
      let clock = nearDeparture.getTime();
      while (nextStep(trip)) {
        const step = nextStep(trip)!;
        clock += 30 * MIN;
        trip = await tripsLifecycle.checkpoint(ctxOf(driver, new Date(clock)), t.id, step.index, step.kind, { remarks: step.kind === "arrive" ? "On time" : undefined });
      }
      expect(trip.checkpoints.every((c) => c.index === 0 || c.actualArrivalAt)).toBe(true);
      expect((await get<BookingDoc>(C.bookings, req.id)).status).toBe("out_for_delivery");

      const tracking = await loadTracking(req.id);
      expect(tracking.liveLocation).toBeNull();
      const cpRows = tracking.stages.filter((x) => x.key === "checkpoint");
      expect(cpRows).toHaveLength(2); // tiruppur, erode (strictly between pickup and drop)
      expect(cpRows.every((r) => r.state === "done" && r.at)).toBe(true);

      const dnow = new Date(clock + 10 * MIN);
      const dd = ctxOf(driver, dnow);
      await expect(bookings.deliver(dd, req.id, { otp: secrets.deliveryOtp, proofFileIds: [] })).rejects.toMatchObject({ code: "proof_required" });
      const f1 = await proofFile(req.id, driver.userId, dnow);
      await expect(bookings.deliver(dd, req.id, { otp: secrets.pickupOtp, proofFileIds: [f1] })).rejects.toMatchObject({ code: "otp_invalid" });
      const f2 = await proofFile(req.id, driver.userId, dnow);
      const delivered = await bookings.deliver(dd, req.id, { otp: secrets.deliveryOtp, proofFileIds: [f2], remarks: "Handed to receiver" });
      expect(delivered.status).toBe("delivered");
      expect((await get<ShipmentDoc>(C.shipments, s.id)).status).toBe("completed");
      const earning = await get<EarningDoc>(C.earnings, req.id);
      expect(earning).toMatchObject({ status: "pending", agencyNet: delivered.pricing.transportationCharge + delivered.pricing.handlingFee, platformFee: delivered.pricing.serviceFee });

      const done = await tripsLifecycle.complete(dd, t.id);
      expect(done.status).toBe("completed");
      expect((await store().get<ScheduleDoc>(C.schedules, scheduleId.driver(driver.userId)))?.intervals.some((i) => i.tripId === t.id) ?? false).toBe(false);

      const review = await bookings.review(ctxOf(w.customers[0]!.session, dnow), req.id, { rating: 4, comment: "Careful handling" });
      expect(review.customerFirstName).toBe("Customer");
      await expect(bookings.review(ctxOf(w.customers[0]!.session, dnow), req.id, { rating: 5 })).rejects.toMatchObject({ code: "already_reviewed" });
      expect((await get<DriverDoc>(C.drivers, driver.userId)).stats).toMatchObject({ ratingAvg: 4, ratingCount: 1, delivered: 1 });
      expect((await get<AgencyDoc>(C.agencies, w.agency.id)).stats.ratingCount).toBe(1);
      const reviews = await listReviews(store(), { driverId: driver.userId }, { limit: 10 });
      expect(reviews.map((r) => r.bookingId)).toEqual([req.id]);

      const model = await agencyEarnings(w.agency.id, {}, dnow);
      expect(model.summary.pending).toBe(earning.agencyNet);
      const throughDate = new Date(dnow.getTime() + 6 * HOUR).toISOString().slice(0, 10);
      const stl = await recordSettlement({ agencyId: w.agency.id, through: throughDate, reference: "UTR-TEST-1", recordedBy: "ops", now: dnow });
      expect(stl?.amount).toBe(earning.agencyNet);
      expect((await get<EarningDoc>(C.earnings, req.id)).status).toBe("settled");
      expect(await recordSettlement({ agencyId: w.agency.id, through: throughDate, reference: "UTR-TEST-2", recordedBy: "ops", now: dnow })).toBeNull();

      const custNotes = await listNotifications(store(), w.customers[0]!.doc.id, { limit: 50 });
      const kinds = custNotes.map((n) => n.kind);
      for (const k of ["booking_accepted", "payment_succeeded", "pickup_confirmed", "checkpoint_reached", "out_for_delivery", "delivered"]) expect(kinds).toContain(k);
      expect(await unreadCount(store(), w.customers[0]!.doc.id)).toBe(custNotes.length);
      await markRead(store(), w.customers[0]!.doc.id, { all: true }, dnow);
      expect(await unreadCount(store(), w.customers[0]!.doc.id)).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "reject needs a reason and reopens the shipment; strangers get not_found",
    async () => {
      const t = await createTrip(w);
      const s = await createShipment(w, 0, { weightKg: 100 });
      const { booking } = await bookings.request(ctxOf(w.customers[0]!.session, T0), { shipmentId: s.id, tripId: t.id, idempotencyKey: idemKey() });
      await expect(bookings.cancelByCustomer(ctxOf(w.customers[1]!.session, T0), booking.id)).rejects.toMatchObject({ code: "not_found" });
      await expect(bookings.reject(ctxOf(w.owner, T0), booking.id, "")).rejects.toMatchObject({ code: "invalid_request" });
      const r = await bookings.reject(ctxOf(w.owner, T0), booking.id, "Truck already full");
      expect(r).toMatchObject({ status: "rejected", tab: "rejected", rejection: { reason: "agency_rejected", note: "Truck already full" } });
      expect(await get<ShipmentDoc>(C.shipments, s.id)).toMatchObject({ status: "open", currentBookingId: null });
      expect((await get<TripDoc>(C.trips, t.id)).counts.awaiting).toBe(0);
      // Idempotent reject; the shipment can be requested again.
      expect((await bookings.reject(ctxOf(w.owner, T0), booking.id, "Truck already full")).status).toBe("rejected");
      const again = await bookings.request(ctxOf(w.customers[0]!.session, T0), { shipmentId: s.id, tripId: t.id, idempotencyKey: idemKey() });
      expect(again.booking.status).toBe("awaiting_agency");
    },
    TIMEOUT,
  );

  it(
    "customer cancel of a paid booking frees the hold and refunds through the job runner",
    async () => {
      const t = await createTrip(w);
      const b = await requestAndAccept(w, t, 0, 300);
      await payDev(w, 0, b.id);
      const c = await bookings.cancelByCustomer(ctxOf(w.customers[0]!.session, T0), b.id, "Plans changed");
      expect(c).toMatchObject({ status: "cancelled", cancellation: { reason: "customer_cancelled" } });
      expect((await get<TripDoc>(C.trips, t.id)).holds[b.id]).toBeUndefined();
      const pay = await get<PaymentDoc>(C.payments, c.paymentId!);
      expect(pay.status).toBe("refund_pending");
      await flushAfter();
      expect((await get<PaymentDoc>(C.payments, pay.id)).status).toBe("refunded");
      const jobs = await store().query<JobDoc>(C.jobs, {});
      expect(jobs.every((j) => j.status === "succeeded")).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "cancelling a trip cascades: awaiting → rejected, paid → cancelled + refund, schedules freed",
    async () => {
      const t = await createTrip(w);
      const s1 = await createShipment(w, 0, { weightKg: 100 });
      const { booking: awaiting } = await bookings.request(ctxOf(w.customers[0]!.session, T0), { shipmentId: s1.id, tripId: t.id, idempotencyKey: idemKey() });
      const confirmed = await requestAndAccept(w, t, 1, 200);
      await payDev(w, 1, confirmed.id);
      await expect(tripsLifecycle.unpublish(ctxOf(w.owner, T0), t.id)).rejects.toMatchObject({ code: "trip_has_bookings" });
      const cancelled = await tripsLifecycle.cancel(ctxOf(w.owner, T0), t.id, "Vehicle breakdown");
      expect(cancelled).toMatchObject({ status: "cancelled", holds: {}, pickupKeys: [] });
      expect(await get<BookingDoc>(C.bookings, awaiting.id)).toMatchObject({ status: "rejected", rejection: { reason: "trip_cancelled" } });
      const cb = await get<BookingDoc>(C.bookings, confirmed.id);
      expect(cb).toMatchObject({ status: "cancelled", cancellation: { reason: "trip_cancelled" } });
      await flushAfter();
      expect((await get<PaymentDoc>(C.payments, cb.paymentId!)).status).toBe("refunded");
      const sched = await store().get<ScheduleDoc>(C.schedules, scheduleId.vehicle(t.vehicleId));
      expect(sched?.intervals.some((i) => i.tripId === t.id) ?? false).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "expires lazily: an unanswered request can't be accepted after respondBy; the sweep catches up",
    async () => {
      const t = await createTrip(w, { departInMin: 180 });
      const s = await createShipment(w, 0, { weightKg: 100 });
      const { booking } = await bookings.request(ctxOf(w.customers[0]!.session, T0), { shipmentId: s.id, tripId: t.id, idempotencyKey: idemKey() });
      const late = new Date(Date.parse(booking.respondBy) + MIN);
      await expect(bookings.accept(ctxOf(w.owner, late), booking.id)).rejects.toMatchObject({ code: "request_expired" });
      expect(await get<BookingDoc>(C.bookings, booking.id)).toMatchObject({ status: "rejected", rejection: { reason: "no_response_before_departure" } });
      expect(await runSweep(late)).toMatchObject({ expiredRequests: 0 });
      // A second shipment's request: sweep expires it.
      const s2 = await createShipment(w, 1, { weightKg: 100 });
      const { booking: b2 } = await bookings.request(ctxOf(w.customers[1]!.session, T0), { shipmentId: s2.id, tripId: t.id, idempotencyKey: idemKey() });
      expect(await runSweep(late)).toMatchObject({ expiredRequests: 1 });
      expect((await get<BookingDoc>(C.bookings, b2.id)).status).toBe("rejected");
      // After respondBy nobody can request this trip any more.
      const s3 = await createShipment(w, 2, { weightKg: 100 });
      await expect(bookings.request(ctxOf(w.customers[2]!.session, late), { shipmentId: s3.id, tripId: t.id, idempotencyKey: idemKey() })).rejects.toMatchObject({ code: "departed" });
    },
    TIMEOUT,
  );

  it(
    "publish requires a verified agency, an active driver link and a future departure",
    async () => {
      const draft = await createTrip(w, { publish: false, departInMin: 30 });
      await expect(tripsLifecycle.publish(ctxOf(w.owner, T0), draft.id)).rejects.toMatchObject({ code: "invalid_checkpoints" });
      const ok = await createTrip(w, { publish: false, vehicle: 1, driver: 1 });
      await verification.rejectAgency({ now: T0, reviewerId: "ops" }, w.agency.id, "Blurry PAN");
      await expect(tripsLifecycle.publish(ctxOf(w.owner, T0), ok.id)).rejects.toMatchObject({ code: "agency_not_verified" });
      await verification.verifyAgency({ now: T0, reviewerId: "ops" }, w.agency.id);
      const published = await tripsLifecycle.publish(ctxOf(w.owner, T0), ok.id);
      expect(published.status).toBe("published");
      // Driver can't act on someone else's trip; customers can't publish.
      await expect(tripsLifecycle.checkpoint(ctxOf(w.drivers[0]!.session, T0), ok.id, 0, "depart", {})).rejects.toMatchObject({ code: "not_found" });
      await expect(tripsLifecycle.publish(ctxOf(w.customers[0]!.session, T0), ok.id)).rejects.toMatchObject({ code: "forbidden" });
      // Reassign to the free driver, back again.
      const re = await tripsLifecycle.reassignDriver(ctxOf(w.owner, T0), ok.id, w.drivers[0]!.doc.id);
      expect(re.driverId).toBe(w.drivers[0]!.doc.id);
    },
    TIMEOUT,
  );

  it(
    "OTP regeneration only after the driver used up the attempts; refusePickup refunds",
    async () => {
      const t = await createTrip(w);
      const b = await requestAndAccept(w, t, 0, 100);
      await payDev(w, 0, b.id);
      const cust = ctxOf(w.customers[0]!.session, T0);
      await expect(bookings.regenerateOtp(cust, b.id, "pickup")).rejects.toMatchObject({ code: "otp_not_exhausted" });
      const near = new Date(Date.parse(t.departureAt) - HOUR);
      const dctx = ctxOf(w.drivers[0]!.session, near);
      const secrets = await get<BookingSecretsDoc>(C.bookingSecrets, b.id);
      const wrong = secrets.pickupOtp === "999999" ? "888888" : "999999";
      for (let i = 0; i < 4; i++) await expect(bookings.pickup(dctx, b.id, wrong)).rejects.toMatchObject({ code: "otp_invalid" });
      await expect(bookings.pickup(dctx, b.id, wrong)).rejects.toMatchObject({ code: "too_many_attempts" });
      await expect(bookings.pickup(dctx, b.id, secrets.pickupOtp)).rejects.toMatchObject({ code: "too_many_attempts" });
      const fresh = await bookings.regenerateOtp(cust, b.id, "pickup");
      expect(fresh.pickupAttempts).toBe(0);
      expect(fresh.pickupOtp).not.toBe(fresh.deliveryOtp);
      const refused = await bookings.refusePickup(dctx, b.id, "Prohibited goods in the package");
      expect(refused).toMatchObject({ status: "cancelled", cancellation: { reason: "pickup_refused" } });
      await flushAfter();
      expect((await get<PaymentDoc>(C.payments, refused.paymentId!)).status).toBe("refunded");
    },
    TIMEOUT,
  );
});
