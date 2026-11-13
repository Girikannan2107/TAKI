import "server-only";
/**
 * Booking commands (P2 §5.1, §6.2). EVERY cross-role booking state transition goes through
 * here, each in one Firestore transaction with its events, capacity holds, notifications,
 * idempotency record and outbox jobs. Callers (route handlers) pass `{ now, actor: session }`.
 *
 * Pattern per command: read bundle → lazy expiry → guards → transition → queue writes.
 * Ownership failures are `not_found` (no existence leak).
 */
import { DomainError } from "@/lib/api/contracts/errors";
import { CANCELLABLE_STATUSES, DRIVER_VISIBLE_STATUSES } from "@/lib/domain/booking-machine";
import { effectiveAvailableKg, fits } from "@/lib/domain/capacity";
import { V2 } from "@/lib/domain/constants";
import { bookingIdCandidates } from "@/lib/domain/ids";
import type { BookingId, CustomerTab, Id, IsoDateTime } from "@/lib/domain/model";
import { quoteV2, segmentKm } from "@/lib/domain/pricing";
import { checkpointArrivalAt, checkpointDepartureAt, goodsProblem, locateSegment, respondByFor } from "@/lib/domain/segments";
import { requireDeliveryProof } from "../env";
import { getDocStore } from "../db";
import { C, sub } from "../db/collections";
import type { TxContext } from "../db/docstore";
import type {
  AgencyDoc,
  BookingDoc,
  BookingEventDoc,
  BookingSecretsDoc,
  CustomerDoc,
  DriverDoc,
  EarningDoc,
  FileDoc,
  ReviewDoc,
  ShipmentDoc,
  TripDoc,
} from "../db/schema";
import { discardUploads } from "../files/uploads";
import { scheduleAfter } from "../http/after";
import { randomDigits, safeEqual } from "../http/crypto";
import { idempotencyRef, readIdempotency, writeIdempotency } from "../http/idempotency";
import type { Ctx } from "./context";
import {
  actorOfSession,
  addMinutes,
  assertAgencyOwns,
  assertCustomerOwns,
  assertDriverAssigned,
  bookingEvent,
  closeBooking,
  fail,
  iso,
  transition,
  txn,
  writeEvent,
  type Failure,
} from "./internal";
import { runJob } from "./jobs";
import { applyExpiry, dueExpiry, msg, readBundle, type BookingBundle } from "./lifecycle";
import { notifyMany } from "./notify";
import { addRating } from "./reviews";

export interface RequestBookingResult {
  booking: BookingDoc;
  /** true when the Idempotency-Key replayed an earlier request (respond 200, not 201). */
  replayed: boolean;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** After commit: run refund jobs right away (the sweep retries failures). */
function runJobsAfterCommit(jobIds: readonly string[]): void {
  for (const id of jobIds) scheduleAfter(() => runJob(id, new Date()));
}

/** Reads the bundle and applies lazy expiry. Returns the Failure to surface if it expired. */
async function loadLive(tx: TxContext, bookingId: string, now: Date): Promise<{ bundle: BookingBundle | null; expired: Failure | null; refundJobIds: string[] }> {
  const bundle = await readBundle(tx, bookingId);
  if (!bundle) return { bundle: null, expired: null, refundJobIds: [] };
  const kind = dueExpiry(bundle.booking, bundle.trip, bundle.payments, now);
  if (!kind) return { bundle, expired: null, refundJobIds: [] };
  const out = applyExpiry(tx, bundle, kind, now);
  return {
    bundle,
    expired: fail(kind === "expireRequest" ? "request_expired" : "payment_window_closed"),
    refundJobIds: out?.refundJobIds ?? [],
  };
}

function nonEmpty(text: string | undefined | null, min: number, max: number, field: string): string {
  const v = (text ?? "").trim();
  if (v.length < min || v.length > max)
    throw new DomainError("invalid_request", min > 0 ? `Enter ${min}–${max} characters.` : `Keep it under ${max} characters.`, { fields: { [field]: "Invalid length" } });
  return v;
}

function optionalText(text: string | undefined | null, max: number, field: string): string | null {
  const v = (text ?? "").trim();
  if (!v) return null;
  return nonEmpty(v, 1, max, field);
}

function tokens(...parts: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const p of parts) {
    if (!p) continue;
    for (const w of p.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 2) out.add(w);
  }
  return [...out];
}

function otpCheck(
  secrets: BookingSecretsDoc,
  which: "pickup" | "delivery",
  code: string,
  now: Date,
): { ok: true; secrets: BookingSecretsDoc } | { ok: false; secrets: BookingSecretsDoc | null; failure: Failure } {
  const attemptsKey = which === "pickup" ? "pickupAttempts" : "deliveryAttempts";
  const expected = which === "pickup" ? secrets.pickupOtp : secrets.deliveryOtp;
  const used = secrets[attemptsKey];
  if (used >= V2.otpAttempts) return { ok: false, secrets: null, failure: fail("too_many_attempts", "Too many incorrect attempts. Ask the customer to generate a new code.", { details: { attemptsLeft: 0 } }) };
  if (safeEqual(code, expected)) return { ok: true, secrets };
  const attempts = used + 1;
  const left = V2.otpAttempts - attempts;
  const next = { ...secrets, [attemptsKey]: attempts, updatedAt: iso(now) };
  return {
    ok: false,
    secrets: next,
    failure:
      left <= 0
        ? fail("too_many_attempts", "Too many incorrect attempts. Ask the customer to generate a new code.", { details: { attemptsLeft: 0 } })
        : fail("otp_invalid", `That code is incorrect. ${left} attempt${left === 1 ? "" : "s"} left.`, { details: { attemptsLeft: left } }),
  };
}

function requireRole(ctx: Ctx, role: "customer" | "agency" | "driver"): void {
  if (ctx.actor.role !== role) throw new DomainError("forbidden");
}

// ── commands ─────────────────────────────────────────────────────────────────

export const bookings = {
  /** Customer requests a trip for an open shipment. Requires an Idempotency-Key. */
  async request(ctx: Ctx, i: { shipmentId: Id; tripId: Id; idempotencyKey: string }): Promise<RequestBookingResult> {
    requireRole(ctx, "customer");
    const { now, actor } = ctx;
    const idem = idempotencyRef("booking", actor.userId, i.idempotencyKey, { shipmentId: i.shipmentId, tripId: i.tripId });
    const candidates = bookingIdCandidates(3);
    return txn(async (tx) => {
      const replay = await readIdempotency(tx, idem, now);
      if (replay) {
        const id = (replay.body as { bookingId: string }).bookingId;
        const existing = await tx.get<BookingDoc>(C.bookings, id);
        if (existing) return { booking: existing, replayed: true };
      }
      const [shipment, trip, customer] = await Promise.all([
        tx.get<ShipmentDoc>(C.shipments, i.shipmentId),
        tx.get<TripDoc>(C.trips, i.tripId),
        tx.get<CustomerDoc>(C.customers, actor.userId),
      ]);
      const taken = await tx.getMany<BookingDoc>(C.bookings, candidates);
      const agency = trip ? await tx.get<AgencyDoc>(C.agencies, trip.agencyId) : null;

      assertCustomerOwns(actor, shipment);
      if (shipment.currentBookingId)
        throw new DomainError("shipment_has_open_booking", undefined, { details: { bookingId: shipment.currentBookingId } });
      if (shipment.status !== "open") throw new DomainError("invalid_transition", "This shipment can no longer be booked.");
      if (!trip || trip.status !== "published" || !agency) throw new DomainError("trip_not_bookable");
      if (agency.verification.status !== "verified") throw new DomainError("trip_not_bookable");
      if (trip.counts.awaiting + trip.counts.held >= V2.maxBookingsPerTrip) throw new DomainError("trip_not_bookable", "This trip isn't taking more requests.");

      const seg = locateSegment(trip.checkpoints, shipment.source.districtId, shipment.destination.districtId);
      if (!seg) throw new DomainError("not_on_route");
      const problem = goodsProblem(trip.goods, { ...shipment.package });
      if (problem) throw new DomainError(problem);
      const pickupCp = trip.checkpoints[seg.pickupIndex]!;
      const dropCp = trip.checkpoints[seg.dropIndex]!;
      const pickupAt = checkpointDepartureAt(pickupCp, trip.departureAt);
      const respondBy = respondByFor(pickupAt);
      if (now.getTime() >= Date.parse(respondBy) || pickupCp.actualDepartureAt) throw new DomainError("departed");
      if (effectiveAvailableKg(trip, now) < shipment.package.weightKg) throw new DomainError("insufficient_capacity");

      const id = candidates.find((_, k) => !taken[k]);
      if (!id) throw new DomainError("contention");
      const at = iso(now);
      const pricing = quoteV2({
        segmentKm: segmentKm(trip.checkpoints, seg.pickupIndex, seg.dropIndex),
        weightKg: shipment.package.weightKg,
        ratePerKmPaise: trip.rates.perKmPaise,
        ratePerKgPaise: trip.rates.perKgPaise,
        handlingFeeRupees: trip.rates.handlingFeeRupees,
        specialHandling: shipment.package.specialHandling,
      });
      const customerName = customer?.fullName ?? actor.name;
      const routeLabel = `${pickupCp.placeName} → ${dropCp.placeName}`;
      const booking: BookingDoc = {
        id,
        shipmentId: shipment.id,
        tripId: trip.id,
        customerId: actor.userId,
        agencyId: trip.agencyId,
        driverId: trip.driverId,
        vehicleId: trip.vehicleId,
        status: "awaiting_agency",
        tab: "pending" satisfies CustomerTab,
        pickup: { checkpointIndex: seg.pickupIndex, districtId: pickupCp.districtId, placeName: pickupCp.placeName, expectedDepartureAt: pickupAt },
        drop: { checkpointIndex: seg.dropIndex, districtId: dropCp.districtId, placeName: dropCp.placeName, expectedArrivalAt: checkpointArrivalAt(dropCp, trip.arrivalAt) },
        weightKg: shipment.package.weightKg,
        goodsCategory: shipment.package.goodsCategory,
        specialHandling: [...shipment.package.specialHandling],
        pricing,
        respondBy,
        acceptedAt: null,
        paymentDueAt: null,
        paidAt: null,
        paymentId: null,
        statusHistory: [{ status: "awaiting_agency", at, by: actorOfSession(actor) }],
        rejection: null,
        cancellation: null,
        reviewed: false,
        display: {
          customerName,
          agencyName: trip.agencyName,
          routeLabel,
          tripDepartureAt: trip.departureAt,
          vehicleReg: trip.vehicle.registrationNumber,
          driverName: trip.driver.fullName,
        },
        searchTokens: tokens(
          id,
          customerName,
          shipment.receiver.name,
          shipment.source.districtName,
          shipment.destination.districtName,
          pickupCp.placeName,
          dropCp.placeName,
          trip.vehicle.registrationNumber.replace(/\s+/g, ""),
          actor.phone.slice(-4),
        ),
        createdAt: at,
        updatedAt: at,
        version: 1,
      };

      tx.create(C.bookings, id, booking);
      writeEvent(tx, bookingEvent(id, "requested", now, actorOfSession(actor), { placeName: pickupCp.placeName }));
      tx.set(C.shipments, shipment.id, { ...shipment, status: "booked", currentBookingId: id, bookingIds: [...shipment.bookingIds, id], updatedAt: at });
      tx.set(C.trips, trip.id, { ...trip, counts: { ...trip.counts, awaiting: trip.counts.awaiting + 1 }, updatedAt: at, version: trip.version + 1 });
      if (customer) tx.set(C.customers, customer.id, { ...customer, stats: { ...customer.stats, bookings: customer.stats.bookings + 1 }, updatedAt: at });
      notifyMany(
        tx,
        [msg.agency(agency, booking, "booking_requested", "New booking request", `${customerName} requested ${booking.weightKg} kg on ${routeLabel}. Respond before ${respondBy}.`)],
        now,
      );
      writeIdempotency(tx, idem, 201, { bookingId: id }, now);
      return { booking, replayed: false };
    });
  },

  /** Agency accepts: capacity hold (unpaid, dueAt), pricing re-locked, payment window opens. */
  async accept(ctx: Ctx, bookingId: BookingId): Promise<BookingDoc> {
    requireRole(ctx, "agency");
    const { now, actor } = ctx;
    const result = await txn(async (tx) => {
      const { bundle, expired, refundJobIds } = await loadLive(tx, bookingId, now);
      assertAgencyOwns(actor, bundle?.booking ?? null);
      const { booking: b, trip, agency } = bundle!;
      if (expired) return { failure: expired, refundJobIds };
      if (b.status === "pending_payment") return { booking: b, refundJobIds };
      if (b.status !== "awaiting_agency") throw new DomainError("invalid_transition", undefined, { details: { from: b.status, event: "accept" } });
      if (!agency || agency.verification.status !== "verified") throw new DomainError("agency_not_verified");
      if (!trip || trip.status !== "published") throw new DomainError("trip_not_bookable");
      if (!fits(trip, b.weightKg, now, b.id)) throw new DomainError("insufficient_capacity");

      const at = iso(now);
      const pricing = quoteV2({
        segmentKm: segmentKm(trip.checkpoints, b.pickup.checkpointIndex, b.drop.checkpointIndex),
        weightKg: b.weightKg,
        ratePerKmPaise: trip.rates.perKmPaise,
        ratePerKgPaise: trip.rates.perKgPaise,
        handlingFeeRupees: trip.rates.handlingFeeRupees,
        specialHandling: b.specialHandling,
      });
      const windowEnd = addMinutes(now, V2.paymentWindowMinutes).getTime();
      const cutoff = addMinutes(b.pickup.expectedDepartureAt, -V2.paymentCutoffBeforeDepartureMinutes).getTime();
      const paymentDueAt = new Date(Math.min(windowEnd, cutoff)).toISOString();
      const next = transition(b, "accept", now, actorOfSession(actor))!;
      next.pricing = pricing;
      next.acceptedAt = at;
      next.paymentDueAt = paymentDueAt;
      next.display = { ...next.display, driverName: trip.driver.fullName, vehicleReg: trip.vehicle.registrationNumber };

      tx.set(C.bookings, b.id, next);
      tx.set(C.trips, trip.id, {
        ...trip,
        holds: { ...trip.holds, [b.id]: { kg: b.weightKg, kind: "unpaid", dueAt: paymentDueAt } },
        counts: { ...trip.counts, awaiting: Math.max(0, trip.counts.awaiting - 1), held: trip.counts.held + 1 },
        updatedAt: at,
        version: trip.version + 1,
      });
      writeEvent(tx, bookingEvent(b.id, "accepted", now, actorOfSession(actor)));
      const priceNote = pricing.totalPayable !== b.pricing.totalPayable ? ` The price was updated to ₹${pricing.totalPayable}.` : "";
      notifyMany(
        tx,
        [
          msg.customer(
            next,
            "booking_accepted",
            "Booking accepted — complete payment",
            `${next.display.agencyName} accepted ${b.id}. Driver ${trip.driver.fullName}, vehicle ${trip.vehicle.registrationNumber}. Pay ₹${pricing.totalPayable} by ${paymentDueAt}.${priceNote}`,
          ),
        ],
        now,
      );
      return { booking: next, refundJobIds };
    });
    runJobsAfterCommit(result.refundJobIds);
    if ("failure" in result && result.failure) throw result.failure.error;
    return (result as { booking: BookingDoc }).booking;
  },

  /** Agency rejects with a reason (3–300 chars). */
  async reject(ctx: Ctx, bookingId: BookingId, reason: string): Promise<BookingDoc> {
    requireRole(ctx, "agency");
    const note = nonEmpty(reason, 3, V2.reasonMax, "reason");
    const { now, actor } = ctx;
    const r = await txn(async (tx) => {
      const { bundle, expired, refundJobIds } = await loadLive(tx, bookingId, now);
      assertAgencyOwns(actor, bundle?.booking ?? null);
      const b = bundle!.booking;
      // Lazy expiry of a request already rejected it (no_response_before_departure): intent satisfied.
      if (expired) return b.status === "awaiting_agency" ? { refundJobIds } : expired;
      if (b.status === "rejected") return { refundJobIds };
      if (b.status !== "awaiting_agency") throw new DomainError("invalid_transition", "Only pending requests can be declined.");
      const out = closeBooking(tx, { ...bundle!, event: "reject", by: actorOfSession(actor), now, rejectReason: "agency_rejected", note });
      if (out) notifyMany(tx, [msg.customer(out.booking, "booking_rejected", "Booking request declined", `${out.booking.display.agencyName} declined ${b.id}: ${note}. Choose another trip.`)], now);
      return { refundJobIds };
    });
    runJobsAfterCommit(r.refundJobIds);
    return mustReload(bookingId);
  },

  /** Customer cancels before pickup; paid bookings get a refund job. */
  async cancelByCustomer(ctx: Ctx, bookingId: BookingId, note?: string): Promise<BookingDoc> {
    requireRole(ctx, "customer");
    const text = optionalText(note, V2.reasonMax, "reason");
    const { now, actor } = ctx;
    const r = await txn(async (tx) => {
      const { bundle, expired, refundJobIds } = await loadLive(tx, bookingId, now);
      assertCustomerOwns(actor, bundle?.booking ?? null);
      if (expired) return { bookingId, refundJobIds };
      const b = bundle!.booking;
      if (b.status === "cancelled") return { bookingId, refundJobIds };
      if (!CANCELLABLE_STATUSES.includes(b.status)) throw new DomainError("invalid_transition", "This booking can't be cancelled after pickup.");
      const out = closeBooking(tx, {
        ...bundle!,
        event: "cancel",
        by: actorOfSession(actor),
        now,
        cancelReason: "customer_cancelled",
        note: text,
        refundReason: "customer_cancelled",
      });
      if (!out) return { bookingId, refundJobIds };
      const nb = out.booking;
      const refundNote = out.refundJobIds.length ? " A full refund has been started." : "";
      notifyMany(
        tx,
        [
          ...(bundle!.agency ? [msg.agency(bundle!.agency, nb, "booking_cancelled", "Booking cancelled by customer", `${nb.display.customerName} cancelled ${nb.id}.`)] : []),
          ...(b.status === "confirmed" ? [msg.driver(nb, "booking_cancelled", "Pickup cancelled", `${nb.id} at ${nb.pickup.placeName} was cancelled by the customer.`)] : []),
          msg.customer(nb, "booking_cancelled", "Booking cancelled", `You cancelled ${nb.id}.${refundNote}`),
        ],
        now,
      );
      return { bookingId, refundJobIds: [...refundJobIds, ...out.refundJobIds] };
    });
    runJobsAfterCommit(r.refundJobIds);
    return mustReload(r.bookingId);
  },

  /** Assigned driver refuses at pickup (e.g. prohibited goods); full refund. */
  async refusePickup(ctx: Ctx, bookingId: BookingId, reason: string): Promise<BookingDoc> {
    requireRole(ctx, "driver");
    const note = nonEmpty(reason, 5, V2.reasonMax, "reason");
    const { now, actor } = ctx;
    const r = await txn(async (tx) => {
      const bundle = await readBundle(tx, bookingId);
      assertDriverAssigned(actor, bundle?.booking ?? null);
      const b = bundle!.booking;
      if (b.status === "cancelled" && b.cancellation?.reason === "pickup_refused") return { refundJobIds: [] as string[] };
      if (b.status !== "confirmed") throw new DomainError("invalid_transition");
      const out = closeBooking(tx, { ...bundle!, event: "refusePickup", by: actorOfSession(actor), now, cancelReason: "pickup_refused", note, refundReason: "pickup_refused" });
      if (!out) return { refundJobIds: [] as string[] };
      const nb = out.booking;
      notifyMany(
        tx,
        [
          msg.customer(nb, "booking_cancelled", "Pickup refused by driver", `The driver couldn't take ${nb.id}: ${note}. A full refund has been started.`),
          ...(bundle!.agency ? [msg.agency(bundle!.agency, nb, "booking_cancelled", "Pickup refused", `${nb.display.driverName} refused pickup of ${nb.id}: ${note}`)] : []),
        ],
        now,
      );
      return { refundJobIds: out.refundJobIds };
    });
    runJobsAfterCommit(r.refundJobIds);
    return mustReload(bookingId);
  },

  /** Assigned driver confirms pickup with the customer's pickup OTP. */
  async pickup(ctx: Ctx, bookingId: BookingId, otp: string, remarks?: string, clientAt?: IsoDateTime): Promise<BookingDoc> {
    requireRole(ctx, "driver");
    const text = optionalText(remarks, V2.reasonMax, "remarks");
    const { now, actor } = ctx;
    return txn(async (tx) => {
      const b = await tx.get<BookingDoc>(C.bookings, bookingId);
      assertDriverAssigned(actor, b);
      const [trip, secrets] = await Promise.all([tx.get<TripDoc>(C.trips, b.tripId), tx.get<BookingSecretsDoc>(C.bookingSecrets, b.id)]);
      if (b.status === "picked_up") return b;
      if (b.status !== "confirmed") throw new DomainError("invalid_transition");
      if (!trip || (trip.status !== "published" && trip.status !== "in_progress")) throw new DomainError("invalid_transition", "This trip isn't active.");
      if (now.getTime() < Date.parse(b.pickup.expectedDepartureAt) - V2.pickupWindowHours * 3_600_000) throw new DomainError("too_early");
      if (!secrets) throw new DomainError("internal", "Pickup code missing for this booking.");
      const check = otpCheck(secrets, "pickup", otp, now);
      if (!check.ok) {
        if (check.secrets) tx.set(C.bookingSecrets, b.id, check.secrets);
        return check.failure;
      }
      const at = iso(now);
      const next = transition(b, "pickup", now, actorOfSession(actor), text ?? undefined)!;
      tx.set(C.bookings, b.id, next);
      tx.set(C.bookingSecrets, b.id, { ...secrets, pickupUsedAt: at, updatedAt: at });
      writeEvent(tx, bookingEvent(b.id, "picked_up", now, actorOfSession(actor), { placeName: b.pickup.placeName, checkpointIndex: b.pickup.checkpointIndex, remarks: text, clientAt: clientAt ?? null }));
      notifyMany(tx, [msg.customer(next, "pickup_confirmed", "Shipment picked up", `${next.display.driverName} picked up ${b.id} at ${b.pickup.placeName}.`)], now);
      return next;
    });
  },

  /** Manual fallback (normally automatic on departing a checkpoint ≥ pickup). */
  async startTransit(ctx: Ctx, bookingId: BookingId, remarks?: string): Promise<BookingDoc> {
    return manualStep(ctx, bookingId, "startTransit", remarks);
  },

  /** Manual fallback (normally automatic on arriving at the drop checkpoint). */
  async outForDelivery(ctx: Ctx, bookingId: BookingId, remarks?: string): Promise<BookingDoc> {
    return manualStep(ctx, bookingId, "outForDelivery", remarks);
  },

  /** Delivery OTP + proof files (uploaded beforehand via files/uploads.ts; discarded if this fails). */
  async deliver(ctx: Ctx, bookingId: BookingId, i: { otp: string; proofFileIds: Id[]; remarks?: string; clientAt?: IsoDateTime }): Promise<BookingDoc> {
    try {
      return await deliverTx(ctx, bookingId, i);
    } catch (e) {
      await discardUploads(i.proofFileIds, ctx.now).catch(() => undefined);
      throw e;
    }
  },

  /** Driver remark on a booking (visible to customer and agency). */
  async addRemark(ctx: Ctx, bookingId: BookingId, text: string): Promise<BookingEventDoc> {
    requireRole(ctx, "driver");
    const remark = nonEmpty(text, 1, V2.reasonMax, "text");
    const { now, actor } = ctx;
    return txn(async (tx) => {
      const b = await tx.get<BookingDoc>(C.bookings, bookingId);
      assertDriverAssigned(actor, b);
      if (!DRIVER_VISIBLE_STATUSES.includes(b.status)) throw new DomainError("invalid_transition");
      const ev = bookingEvent(b.id, "remark", now, actorOfSession(actor), { remarks: remark });
      writeEvent(tx, ev);
      return ev;
    });
  },

  /** Customer review after delivery (once). */
  async review(ctx: Ctx, bookingId: BookingId, i: { rating: number; comment?: string }): Promise<ReviewDoc> {
    requireRole(ctx, "customer");
    if (!Number.isInteger(i.rating) || i.rating < 1 || i.rating > 5) throw new DomainError("invalid_request", "Choose a rating from 1 to 5.", { fields: { rating: "1–5" } });
    const comment = optionalText(i.comment, V2.reviewCommentMax, "comment");
    const { now, actor } = ctx;
    return txn(async (tx) => {
      const b = await tx.get<BookingDoc>(C.bookings, bookingId);
      assertCustomerOwns(actor, b);
      const [existing, driver, agency, customer] = await Promise.all([
        tx.get<ReviewDoc>(C.reviews, b.id),
        tx.get<DriverDoc>(C.drivers, b.driverId),
        tx.get<AgencyDoc>(C.agencies, b.agencyId),
        tx.get<CustomerDoc>(C.customers, b.customerId),
      ]);
      if (existing || b.reviewed) throw new DomainError("already_reviewed");
      if (b.status !== "delivered") throw new DomainError("invalid_transition", "You can review once the shipment is delivered.");
      const futureTrips = await tx.query<TripDoc>(C.trips, { where: [["driverId", "==", b.driverId], ["status", "in", ["draft", "published"]]] });
      const at = iso(now);
      const review: ReviewDoc = {
        id: b.id,
        bookingId: b.id,
        customerId: b.customerId,
        customerFirstName: (customer?.fullName ?? actor.name).trim().split(/\s+/)[0] ?? "Customer",
        driverId: b.driverId,
        agencyId: b.agencyId,
        tripId: b.tripId,
        rating: i.rating as ReviewDoc["rating"],
        comment,
        createdAt: at,
        updatedAt: at,
      };
      tx.create(C.reviews, b.id, review);
      tx.set(C.bookings, b.id, { ...b, reviewed: true, updatedAt: at, version: b.version + 1 });
      if (driver) {
        const r = addRating(driver.stats.ratingAvg, driver.stats.ratingCount, i.rating);
        tx.set(C.drivers, driver.id, { ...driver, stats: { ...driver.stats, ...r }, updatedAt: at });
        for (const t of futureTrips) tx.set(C.trips, t.id, { ...t, driver: { ...t.driver, ...r }, updatedAt: at, version: t.version + 1 });
      }
      if (agency) {
        const r = addRating(agency.stats.ratingAvg, agency.stats.ratingCount, i.rating);
        tx.set(C.agencies, agency.id, { ...agency, stats: { ...agency.stats, ...r }, updatedAt: at });
      }
      const body = `${review.customerFirstName} rated ${b.id} ${i.rating}/5${comment ? `: “${comment}”` : "."}`;
      notifyMany(
        tx,
        [
          ...(agency ? [msg.agency(agency, b, "review_received", "New review", body)] : []),
          msg.driver(b, "review_received", "New review", body),
        ],
        now,
      );
      return review;
    });
  },

  /** Customer regenerates an OTP — only after the driver exhausted its attempts. */
  async regenerateOtp(ctx: Ctx, bookingId: BookingId, which: "pickup" | "delivery"): Promise<BookingSecretsDoc> {
    requireRole(ctx, "customer");
    const { now, actor } = ctx;
    return txn(async (tx) => {
      const b = await tx.get<BookingDoc>(C.bookings, bookingId);
      assertCustomerOwns(actor, b);
      const secrets = await tx.get<BookingSecretsDoc>(C.bookingSecrets, b.id);
      if (!secrets) throw new DomainError("invalid_transition");
      const okStatus = which === "pickup" ? b.status === "confirmed" : ["picked_up", "in_transit", "out_for_delivery"].includes(b.status);
      if (!okStatus) throw new DomainError("invalid_transition");
      const attempts = which === "pickup" ? secrets.pickupAttempts : secrets.deliveryAttempts;
      if (attempts < V2.otpAttempts) throw new DomainError("otp_not_exhausted");
      const at = iso(now);
      const next: BookingSecretsDoc =
        which === "pickup"
          ? { ...secrets, pickupOtp: newOtp(secrets.deliveryOtp), pickupAttempts: 0, updatedAt: at }
          : { ...secrets, deliveryOtp: newOtp(secrets.pickupOtp), deliveryAttempts: 0, updatedAt: at };
      tx.set(C.bookingSecrets, b.id, next);
      return next;
    });
  },
};

/** A fresh 6-digit OTP different from `other` (pickup and delivery codes never collide). */
export function newOtp(other?: string): string {
  for (;;) {
    const c = randomDigits(6);
    if (c !== other) return c;
  }
}

async function reload(id: string): Promise<BookingDoc | null> {
  return getDocStore().get<BookingDoc>(C.bookings, id);
}

async function mustReload(id: string): Promise<BookingDoc> {
  const b = await reload(id);
  if (!b) throw new DomainError("not_found");
  return b;
}

async function manualStep(ctx: Ctx, bookingId: BookingId, event: "startTransit" | "outForDelivery", remarks?: string): Promise<BookingDoc> {
  requireRole(ctx, "driver");
  const text = optionalText(remarks, V2.reasonMax, "remarks");
  const { now, actor } = ctx;
  return txn(async (tx) => {
    const b = await tx.get<BookingDoc>(C.bookings, bookingId);
    assertDriverAssigned(actor, b);
    const next = transition(b, event, now, actorOfSession(actor), text ?? undefined);
    if (!next) return b;
    tx.set(C.bookings, b.id, next);
    if (event === "startTransit") {
      writeEvent(tx, bookingEvent(b.id, "in_transit", now, actorOfSession(actor), { remarks: text }));
    } else {
      writeEvent(tx, bookingEvent(b.id, "out_for_delivery", now, actorOfSession(actor), { remarks: text, placeName: b.drop.placeName, checkpointIndex: b.drop.checkpointIndex }));
      notifyMany(tx, [msg.customer(next, "out_for_delivery", "Out for delivery", `${b.id} is out for delivery at ${b.drop.placeName}.`)], now);
    }
    return next;
  });
}

async function deliverTx(ctx: Ctx, bookingId: BookingId, i: { otp: string; proofFileIds: Id[]; remarks?: string; clientAt?: IsoDateTime }): Promise<BookingDoc> {
  requireRole(ctx, "driver");
  const text = optionalText(i.remarks, V2.reasonMax, "remarks");
  const { now, actor } = ctx;
  const proofIds = [...new Set(i.proofFileIds)];
  if (proofIds.length > V2.maxProofFiles) throw new DomainError("invalid_request", `Add at most ${V2.maxProofFiles} photos.`, { fields: { proof: "Too many files" } });
  if (proofIds.length === 0 && requireDeliveryProof()) throw new DomainError("proof_required");
  return txn(async (tx) => {
    const b = await tx.get<BookingDoc>(C.bookings, bookingId);
    assertDriverAssigned(actor, b);
    const [trip, secrets, shipment, driver, agency, customer] = await Promise.all([
      tx.get<TripDoc>(C.trips, b.tripId),
      tx.get<BookingSecretsDoc>(C.bookingSecrets, b.id),
      tx.get<ShipmentDoc>(C.shipments, b.shipmentId),
      tx.get<DriverDoc>(C.drivers, b.driverId),
      tx.get<AgencyDoc>(C.agencies, b.agencyId),
      tx.get<CustomerDoc>(C.customers, b.customerId),
    ]);
    const files = proofIds.length ? await tx.getMany<FileDoc>(C.files, proofIds) : [];
    if (b.status === "delivered") return b;
    if (b.status !== "out_for_delivery") throw new DomainError("invalid_transition", "Mark the shipment out for delivery first.");
    for (const f of files) {
      if (!f || f.kind !== "delivery_proof" || f.ownerType !== "booking" || f.ownerId !== b.id || f.status !== "active")
        throw new DomainError("invalid_request", "A delivery photo is invalid. Upload it again.", { fields: { proof: "Invalid file" } });
    }
    if (!secrets) throw new DomainError("internal", "Delivery code missing for this booking.");
    const check = otpCheck(secrets, "delivery", i.otp, now);
    if (!check.ok) {
      if (check.secrets) tx.set(C.bookingSecrets, b.id, check.secrets);
      return check.failure;
    }
    const at = iso(now);
    const by = actorOfSession(actor);
    const next = transition(b, "deliver", now, by, text ?? undefined)!;
    tx.set(C.bookings, b.id, next);
    tx.set(C.bookingSecrets, b.id, { ...secrets, deliveryUsedAt: at, updatedAt: at });
    const earning: EarningDoc = {
      id: b.id,
      bookingId: b.id,
      agencyId: b.agencyId,
      tripId: b.tripId,
      driverId: b.driverId,
      customerPaid: b.pricing.totalPayable,
      transportationCharge: b.pricing.transportationCharge,
      handlingFee: b.pricing.handlingFee,
      platformFee: b.pricing.serviceFee,
      agencyNet: b.pricing.transportationCharge + b.pricing.handlingFee,
      routeLabel: b.display.routeLabel,
      deliveredAt: at,
      status: "pending",
      settlementId: null,
      settledAt: null,
      createdAt: at,
      updatedAt: at,
    };
    tx.create(C.earnings, b.id, earning);
    if (trip) tx.set(C.trips, trip.id, { ...trip, counts: { ...trip.counts, delivered: trip.counts.delivered + 1 }, updatedAt: at, version: trip.version + 1 });
    if (shipment) tx.set(C.shipments, shipment.id, { ...shipment, status: "completed", updatedAt: at });
    if (driver) tx.set(C.drivers, driver.id, { ...driver, stats: { ...driver.stats, delivered: driver.stats.delivered + 1 }, updatedAt: at });
    if (agency) tx.set(C.agencies, agency.id, { ...agency, stats: { ...agency.stats, delivered: agency.stats.delivered + 1 }, updatedAt: at });
    if (customer) tx.set(C.customers, customer.id, { ...customer, stats: { ...customer.stats, delivered: customer.stats.delivered + 1 }, updatedAt: at });
    writeEvent(
      tx,
      bookingEvent(b.id, "delivered", now, by, {
        placeName: b.drop.placeName,
        checkpointIndex: b.drop.checkpointIndex,
        remarks: text,
        clientAt: i.clientAt ?? null,
        files: proofIds.map((fileId) => ({ fileId })),
      }),
    );
    notifyMany(
      tx,
      [
        msg.customer(next, "delivered", "Delivered", `${b.id} was delivered at ${b.drop.placeName}. Rate your experience.`),
        ...(agency ? [msg.agency(agency, next, "delivered", "Shipment delivered", `${b.id} (${b.display.routeLabel}) was delivered. ₹${earning.agencyNet} added to pending earnings.`)] : []),
      ],
      now,
    );
    return next;
  });
}

/** For tests and the sweep: the events of a booking, oldest first. */
export async function bookingEvents(tx: Pick<TxContext, "query">, bookingId: string): Promise<BookingEventDoc[]> {
  return tx.query<BookingEventDoc>(sub.bookingEvents(bookingId), { orderBy: [["at", "asc"]] });
}
