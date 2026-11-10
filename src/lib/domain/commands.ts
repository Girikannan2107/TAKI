/**
 * Business commands. Each takes a MUTABLE draft Db (the caller clones first),
 * applies one use case atomically, and returns its result. Throws DomainError
 * (user-facing message) on any rule violation, leaving the caller's real state
 * untouched. Framework-free so a Firestore/Cloud Functions port can reuse it.
 */
import { CAPACITY_HOLDING, InvalidTransitionError, transition, type BookingEvent } from "./booking-machine";
import { cityName, cumulativeKm, isCityId } from "./cities";
import { LIMITS } from "./constants";
import { addDaysIso, departureMs, isIsoDate, isTimeOfDay, todayIst } from "./dates";
import { DomainError, type CommandContext, type Db } from "./db";
import { earningsSummary } from "./earnings";
import { genBookingId, genId } from "./ids";
import { estimateDurationMins, quote } from "./pricing";
import { hasDeparted, OFFER_PROBLEM_MESSAGE, offerFromRoute, offerProblem } from "./search";
import type {
  Booking,
  BookingId,
  Id,
  Notification,
  NotificationKind,
  Payment,
  PaymentMethod,
  Payout,
  Role,
  Route,
  RouteDraft,
  Shipment,
  Vehicle,
} from "./types";
import { getVehicleModel } from "./vehicles";

const iso = (ctx: CommandContext) => ctx.now.toISOString();

function apply(booking: Booking, event: BookingEvent, ctx: CommandContext, by: "customer" | "driver" | "system", note?: string): Booking {
  try {
    return transition(booking, event, { at: iso(ctx), by, note });
  } catch (e) {
    if (e instanceof InvalidTransitionError) throw new DomainError("invalid_transition", e.message);
    throw e;
  }
}

export function notify(
  db: Db,
  ctx: CommandContext,
  n: { recipientRole: Role; recipientId: Id; kind: NotificationKind; title: string; body: string; bookingId?: BookingId; routeId?: Id },
): Notification {
  const note: Notification = { id: genId("ntf", ctx.rand), createdAt: iso(ctx), ...n };
  db.notifications[note.id] = note;
  return note;
}

function getBooking(db: Db, id: BookingId): Booking {
  const b = db.bookings[id];
  if (!b) throw new DomainError("booking_not_found", "We couldn't find that booking.");
  return b;
}

export function validateShipment(s: Shipment, now: Date): void {
  if (!isCityId(s.sourceCityId) || !isCityId(s.destinationCityId)) throw new DomainError("invalid_city", "Choose a source and destination from the list.");
  if (s.sourceCityId === s.destinationCityId) throw new DomainError("same_city", "Source and destination must be different.");
  if (!Number.isInteger(s.weightKg) || s.weightKg < LIMITS.weightKg.min || s.weightKg > LIMITS.weightKg.max)
    throw new DomainError("invalid_weight", `Weight must be between ${LIMITS.weightKg.min} kg and 25,000 kg.`);
  const today = todayIst(now);
  if (!isIsoDate(s.pickupDate) || s.pickupDate < today) throw new DomainError("past_date", "Pickup date can't be in the past.");
  if (s.pickupDate > addDaysIso(today, LIMITS.bookingWindowDays))
    throw new DomainError("date_too_far", `Pickup date must be within ${LIMITS.bookingWindowDays} days.`);
}

// ───────────────────────────── Customer booking ─────────────────────────────

/**
 * "Book This Vehicle": re-validates the offer and creates a booking in
 * `pending_payment` with an immutable pricing snapshot. Re-uses an existing
 * unpaid booking for the same customer + route + shipment (no duplicates on back/forward).
 */
export function createBookingForPayment(db: Db, ctx: CommandContext, input: { customerId: Id; routeId: Id; shipment: Shipment }): Booking {
  const { customerId, routeId, shipment } = input;
  if (!db.customers[customerId]) throw new DomainError("not_customer", "Sign in as a customer to book.");
  validateShipment(shipment, ctx.now);
  const route = db.routes[routeId];
  const problem = offerProblem(db, route, shipment, ctx.now);
  if (problem) throw new DomainError(problem, OFFER_PROBLEM_MESSAGE[problem]);
  const offer = offerFromRoute(db, route!, shipment)!;

  const existing = Object.values(db.bookings).find(
    (b) =>
      b.customerId === customerId &&
      b.routeId === routeId &&
      (b.status === "pending_payment" || b.status === "payment_failed") &&
      b.shipment.sourceCityId === shipment.sourceCityId &&
      b.shipment.destinationCityId === shipment.destinationCityId &&
      b.shipment.weightKg === shipment.weightKg &&
      b.shipment.pickupDate === shipment.pickupDate,
  );
  if (existing) return existing;

  const at = iso(ctx);
  const draft: Booking = {
    id: genBookingId(db.bookings, ctx.rand),
    customerId,
    driverId: route!.driverId,
    routeId,
    vehicleId: route!.vehicleId,
    shipment: { ...shipment },
    pricing: offer.pricing,
    status: "draft",
    statusHistory: [{ status: "draft", at, by: "customer" }],
    createdAt: at,
    updatedAt: at,
  };
  const booking = apply(draft, "bookThisVehicle", ctx, "customer");
  db.bookings[booking.id] = booking;
  return booking;
}

/**
 * Record a payment attempt outcome. Idempotent per `idempotencyKey`, and a booking
 * can only ever be paid once (a second attempt returns the existing succeeded payment).
 */
export function recordPayment(
  db: Db,
  ctx: CommandContext,
  input: { customerId: Id; bookingId: BookingId; method: PaymentMethod; idempotencyKey: string; outcome: "succeeded" | "failed"; mode: "demo" | "live"; failureReason?: string },
): Payment {
  const replay = Object.values(db.payments).find((p) => p.idempotencyKey === input.idempotencyKey);
  if (replay) return replay;
  let booking = getBooking(db, input.bookingId);
  if (booking.customerId !== input.customerId) throw new DomainError("forbidden", "This booking belongs to another account.");
  const alreadyPaid = Object.values(db.payments).find((p) => p.bookingId === booking.id && p.status === "succeeded");
  if (alreadyPaid) return alreadyPaid;
  if (booking.status === "payment_failed") booking = apply(booking, "retryPayment", ctx, "customer");
  if (booking.status !== "pending_payment") throw new DomainError("not_payable", "This booking can't be paid any more.");

  // Re-check the route before taking money.
  const route = db.routes[booking.routeId];
  if (input.outcome === "succeeded") {
    const problem = offerProblem(db, route, booking.shipment, ctx.now);
    if (problem) throw new DomainError(problem, OFFER_PROBLEM_MESSAGE[problem]);
  }

  const at = iso(ctx);
  const payment: Payment = {
    id: genId("pay", ctx.rand),
    bookingId: booking.id,
    customerId: input.customerId,
    amount: booking.pricing.totalPayable,
    method: input.method,
    status: input.outcome,
    mode: input.mode,
    idempotencyKey: input.idempotencyKey,
    methodLabel: input.method === "upi" ? "UPI" : input.method === "card" ? "Card" : "Net Banking",
    createdAt: at,
    ...(input.outcome === "succeeded" ? { completedAt: at } : { failureReason: input.failureReason ?? "Payment was not completed." }),
  };
  db.payments[payment.id] = payment;

  if (input.outcome === "succeeded") {
    booking = apply(booking, "paymentSucceeded", ctx, "system", input.mode === "demo" ? "Demo payment" : undefined);
    const customer = db.customers[booking.customerId];
    notify(db, ctx, {
      recipientRole: "driver",
      recipientId: booking.driverId,
      kind: "booking_requested",
      title: `New booking request from ${customer ? shortCustomerName(customer.fullName) : "a customer"}`,
      body: `${cityName(booking.shipment.sourceCityId)} → ${cityName(booking.shipment.destinationCityId)} · ${booking.shipment.weightKg} kg`,
      bookingId: booking.id,
      routeId: booking.routeId,
    });
    notify(db, ctx, {
      recipientRole: "customer",
      recipientId: booking.customerId,
      kind: "payment_succeeded",
      title: `Payment received for ${booking.id}`,
      body: input.mode === "demo" ? "Demo payment — no money moved. Waiting for the driver to confirm." : "Waiting for the driver to confirm.",
      bookingId: booking.id,
    });
  } else {
    booking = apply(booking, "paymentFailed", ctx, "system");
    notify(db, ctx, { recipientRole: "customer", recipientId: booking.customerId, kind: "payment_failed", title: `Payment failed for ${booking.id}`, body: "You can try again.", bookingId: booking.id });
  }
  db.bookings[booking.id] = booking;
  return payment;
}

function refundPayments(db: Db, ctx: CommandContext, bookingId: BookingId): void {
  for (const p of Object.values(db.payments)) {
    if (p.bookingId === bookingId && p.status === "succeeded") {
      db.payments[p.id] = { ...p, status: "refunded", refundedAt: iso(ctx) };
    }
  }
}

/** Customer cancels. Releases capacity if the booking was holding it; refunds paid bookings. */
export function cancelBooking(db: Db, ctx: CommandContext, input: { customerId: Id; bookingId: BookingId }): Booking {
  let booking = getBooking(db, input.bookingId);
  if (booking.customerId !== input.customerId) throw new DomainError("forbidden", "This booking belongs to another account.");
  if (booking.status === "cancelled") return booking;
  const route = db.routes[booking.routeId];
  if (booking.status === "confirmed" && route && hasDeparted(route, ctx.now))
    throw new DomainError("departed", "This vehicle has already departed, so the booking can't be cancelled.");
  const heldCapacity = CAPACITY_HOLDING.includes(booking.status);
  const wasPaid = ["awaiting_driver", "confirmed"].includes(booking.status);
  booking = apply(booking, "cancel", ctx, "customer");
  booking = { ...booking, cancelReason: "customer_cancelled" };
  db.bookings[booking.id] = booking;
  if (heldCapacity && route) db.routes[route.id] = { ...route, availableCapacityKg: route.availableCapacityKg + booking.shipment.weightKg };
  if (wasPaid) refundPayments(db, ctx, booking.id);
  return booking;
}

// ───────────────────────────── Driver requests ─────────────────────────────

/** Accept a request: capacity-checked, idempotent (double-tap never deducts twice). */
export function acceptBooking(db: Db, ctx: CommandContext, input: { driverId: Id; bookingId: BookingId; by?: "driver" | "system" }): Booking {
  const booking = getBooking(db, input.bookingId);
  if (booking.driverId !== input.driverId) throw new DomainError("forbidden", "This request belongs to another driver.");
  if (booking.status === "confirmed" || ["picked_up", "in_transit", "out_for_delivery", "delivered"].includes(booking.status)) return booking;
  if (booking.status !== "awaiting_driver") throw new DomainError("invalid_transition", "This request is no longer pending.");
  const route = db.routes[booking.routeId];
  if (!route || route.status !== "published") throw new DomainError("not_published", "This route is no longer active.");
  if (hasDeparted(route, ctx.now)) throw new DomainError("departed", "This route has already departed.");
  if (booking.shipment.weightKg > route.availableCapacityKg)
    throw new DomainError("insufficient_capacity", `Not enough capacity (${route.availableCapacityKg.toLocaleString("en-IN")} kg left).`);
  const next = apply(booking, "accept", ctx, input.by ?? "driver");
  db.bookings[next.id] = next;
  db.routes[route.id] = { ...route, availableCapacityKg: route.availableCapacityKg - booking.shipment.weightKg };
  const driver = db.drivers[booking.driverId];
  notify(db, ctx, {
    recipientRole: "customer",
    recipientId: booking.customerId,
    kind: "booking_accepted",
    title: `${driver?.businessName ?? "Your driver"} confirmed ${booking.id}`,
    body: `Pickup on ${booking.shipment.pickupDate}.`,
    bookingId: booking.id,
  });
  return next;
}

/** Decline a request: never changes capacity; the customer's payment is refunded. */
export function declineBooking(db: Db, ctx: CommandContext, input: { driverId: Id; bookingId: BookingId }): Booking {
  const booking = getBooking(db, input.bookingId);
  if (booking.driverId !== input.driverId) throw new DomainError("forbidden", "This request belongs to another driver.");
  if (booking.status === "declined") return booking;
  if (booking.status !== "awaiting_driver") throw new DomainError("invalid_transition", "Only pending requests can be declined.");
  const next = apply(booking, "decline", ctx, "driver");
  db.bookings[next.id] = next;
  refundPayments(db, ctx, booking.id);
  notify(db, ctx, {
    recipientRole: "customer",
    recipientId: booking.customerId,
    kind: "booking_declined",
    title: `${booking.id} was declined`,
    body: "Your payment has been refunded (demo). Try another vehicle on your route.",
    bookingId: booking.id,
  });
  return next;
}

const PROGRESS: Array<{ from: Booking["status"]; event: BookingEvent }> = [
  { from: "confirmed", event: "markPickedUp" },
  { from: "picked_up", event: "startTransit" },
  { from: "in_transit", event: "markOutForDelivery" },
  { from: "out_for_delivery", event: "markDelivered" },
];

/** Move an accepted shipment one step forward; delivery credits the driver's earnings. */
export function advanceShipment(db: Db, ctx: CommandContext, input: { bookingId: BookingId; by: "driver" | "system"; driverId?: Id; note?: string }): Booking {
  const booking = getBooking(db, input.bookingId);
  if (input.driverId && booking.driverId !== input.driverId) throw new DomainError("forbidden", "This shipment belongs to another driver.");
  const step = PROGRESS.find((p) => p.from === booking.status);
  if (!step) throw new DomainError("invalid_transition", "This shipment can't be advanced.");
  let next = apply(booking, step.event, ctx, input.by, input.note);
  if (step.event === "markPickedUp") {
    const outAt = new Date(ctx.now.getTime() + (estimateDurationMins(booking.pricing.distanceKm) - 60) * 60_000);
    const rounded = Math.round(outAt.getTime() / 1_800_000) * 1_800_000;
    next = { ...next, expectedOutForDeliveryAt: new Date(rounded).toISOString() };
  }
  db.bookings[next.id] = next;
  if (step.event === "markDelivered") {
    const entry = {
      id: genId("ern", ctx.rand),
      driverId: booking.driverId,
      bookingId: booking.id,
      routeId: booking.routeId,
      sourceCityId: booking.shipment.sourceCityId,
      destinationCityId: booking.shipment.destinationCityId,
      amount: booking.pricing.transportationCharge,
      status: "paid" as const,
      creditedAt: iso(ctx),
    };
    db.earnings[entry.id] = entry;
  }
  notify(db, ctx, {
    recipientRole: "customer",
    recipientId: booking.customerId,
    kind: "booking_status_changed",
    title: `${booking.id}: ${next.status.replace(/_/g, " ")}`,
    body: `${cityName(booking.shipment.sourceCityId)} → ${cityName(booking.shipment.destinationCityId)}`,
    bookingId: booking.id,
  });
  return next;
}

/**
 * DEMO ONLY — "Simulate next update" on the tracking page. Accepts (through the
 * same capacity checks as the driver) or advances the shipment one step.
 */
export function simulateNextUpdate(db: Db, ctx: CommandContext, input: { customerId: Id; bookingId: BookingId }): Booking {
  const booking = getBooking(db, input.bookingId);
  if (booking.customerId !== input.customerId) throw new DomainError("forbidden", "This booking belongs to another account.");
  if (booking.status === "awaiting_driver") return acceptBooking(db, ctx, { driverId: booking.driverId, bookingId: booking.id, by: "system" });
  return advanceShipment(db, ctx, { bookingId: booking.id, by: "system", note: "Demo simulation" });
}

// ───────────────────────────── Driver routes ─────────────────────────────

export interface PublishRouteInput {
  driverId: Id;
  draft: RouteDraft;
}

/** Validate a draft and publish it as a Route (creates the vehicle for "new:<model>" selections). */
export function publishRoute(db: Db, ctx: CommandContext, { driverId, draft }: PublishRouteInput): Route {
  const driver = db.drivers[driverId];
  if (!driver) throw new DomainError("not_driver", "Sign in as a driver to publish routes.");
  const { originCityId, destinationCityId, stopCityIds, travelDate, departureTime, vehicleId, totalCapacityKg, offeredCapacityKg, ratePerKmPaise, ratePerKgPaise } = draft;
  if (!originCityId || !destinationCityId || !isCityId(originCityId) || !isCityId(destinationCityId))
    throw new DomainError("invalid_city", "Choose the From and To cities.");
  if (originCityId === destinationCityId) throw new DomainError("same_city", "From and To must be different cities.");
  const stops = stopCityIds ?? [];
  if (stops.length > LIMITS.maxStops) throw new DomainError("too_many_stops", `Add at most ${LIMITS.maxStops} stops.`);
  const all = [originCityId, ...stops, destinationCityId];
  if (new Set(all).size !== all.length || stops.some((s) => !isCityId(s))) throw new DomainError("invalid_stops", "Stops must be different cities from each other and from From/To.");
  if (!travelDate || !isIsoDate(travelDate)) throw new DomainError("invalid_date", "Choose a travel date.");
  if (!departureTime || !isTimeOfDay(departureTime)) throw new DomainError("invalid_time", "Choose a departure time.");
  const today = todayIst(ctx.now);
  if (travelDate < today) throw new DomainError("past_date", "Travel date can't be in the past.");
  if (travelDate > addDaysIso(today, LIMITS.bookingWindowDays)) throw new DomainError("date_too_far", `Travel date must be within ${LIMITS.bookingWindowDays} days.`);
  if (departureMs(travelDate, departureTime) < ctx.now.getTime() + LIMITS.sameDayLeadMinutes * 60_000)
    throw new DomainError("departure_too_soon", "Departure must be at least 1 hour from now.");
  if (!vehicleId) throw new DomainError("no_vehicle", "Choose a vehicle type.");

  let vehicle: Vehicle | undefined;
  if (vehicleId.startsWith("new:")) {
    const model = getVehicleModel(vehicleId.slice(4));
    if (!model) throw new DomainError("no_vehicle", "Choose a valid vehicle type.");
    vehicle = Object.values(db.vehicles).find((v) => v.driverId === driverId && v.modelId === model.id);
    if (!vehicle) {
      vehicle = {
        id: genId("veh", ctx.rand),
        driverId,
        modelId: model.id,
        registrationNumber: "Not added yet",
        capacity: { maxPayloadKg: model.maxPayloadKg, bodyType: "tarpaulin" },
        imageKey: model.imageKey,
      };
      db.vehicles[vehicle.id] = vehicle;
    }
  } else {
    vehicle = db.vehicles[vehicleId];
    if (!vehicle || vehicle.driverId !== driverId) throw new DomainError("no_vehicle", "Choose one of your vehicles.");
  }
  const maxKg = vehicle.capacity.maxPayloadKg;
  if (!Number.isInteger(totalCapacityKg) || totalCapacityKg! < LIMITS.capacityKg.min) throw new DomainError("invalid_capacity", "Total capacity must be at least 100 kg.");
  if (totalCapacityKg! > maxKg) throw new DomainError("over_vehicle_max", `Total capacity can't exceed the vehicle's ${maxKg.toLocaleString("en-IN")} kg limit.`);
  if (!Number.isInteger(offeredCapacityKg) || offeredCapacityKg! < LIMITS.capacityKg.min) throw new DomainError("invalid_capacity", "Available capacity must be at least 100 kg.");
  if (offeredCapacityKg! > totalCapacityKg!) throw new DomainError("available_gt_total", "Available capacity can't exceed total capacity.");
  if (!Number.isInteger(ratePerKmPaise) || ratePerKmPaise! < LIMITS.ratePerKmPaise.min || ratePerKmPaise! > LIMITS.ratePerKmPaise.max)
    throw new DomainError("invalid_rate", "Per kilometre rate must be between ₹1 and ₹100.");
  if (!Number.isInteger(ratePerKgPaise) || ratePerKgPaise! < LIMITS.ratePerKgPaise.min || ratePerKgPaise! > LIMITS.ratePerKgPaise.max)
    throw new DomainError("invalid_rate", "Per kilogram rate must be between ₹0 and ₹20.");
  const clash = Object.values(db.routes).find((r) => r.vehicleId === vehicle!.id && r.status === "published" && r.travelDate === travelDate);
  if (clash) throw new DomainError("vehicle_busy", "This vehicle already has a published route on that date.");

  const cum = cumulativeKm(all);
  const distanceKm = cum[cum.length - 1]!;
  const at = iso(ctx);
  const route: Route = {
    id: genId("rte", ctx.rand),
    driverId,
    vehicleId: vehicle.id,
    originCityId,
    destinationCityId,
    stops: stops.map((cityId, i) => ({ cityId, kmFromOrigin: cum[i + 1]! })),
    distanceKm,
    durationMins: estimateDurationMins(distanceKm),
    travelDate,
    departureTime,
    ratePerKmPaise: ratePerKmPaise!,
    ratePerKgPaise: ratePerKgPaise!,
    totalCapacityKg: totalCapacityKg!,
    offeredCapacityKg: offeredCapacityKg!,
    availableCapacityKg: offeredCapacityKg!,
    status: "published",
    createdAt: at,
    publishedAt: at,
  };
  db.routes[route.id] = route;
  notify(db, ctx, { recipientRole: "driver", recipientId: driverId, kind: "route_published", title: "Route published", body: `${cityName(originCityId)} → ${cityName(destinationCityId)} on ${travelDate}`, routeId: route.id });
  return route;
}

/** Distance and example preview for a draft (Set Pricing). */
export function draftDistanceKm(draft: RouteDraft): number | null {
  if (!draft.originCityId || !draft.destinationCityId) return null;
  try {
    const cum = cumulativeKm([draft.originCityId, ...(draft.stopCityIds ?? []), draft.destinationCityId]);
    return cum[cum.length - 1] ?? null;
  } catch {
    return null;
  }
}

export function previewQuote(distanceKm: number, ratePerKmPaise: number, ratePerKgPaise: number, weightKg: number) {
  return quote({ distanceKm, weightKg, ratePerKmPaise, ratePerKgPaise });
}

// ───────────────────────────── Earnings ─────────────────────────────

/** DEMO payout request: simulated, never moves money. Idempotent per key. */
export function requestPayout(db: Db, ctx: CommandContext, input: { driverId: Id; amount: number; idempotencyKey: string }): Payout {
  const replay = Object.values(db.payouts).find((p) => p.idempotencyKey === input.idempotencyKey);
  if (replay) return replay;
  const driver = db.drivers[input.driverId];
  if (!driver) throw new DomainError("not_driver", "Sign in as a driver to withdraw.");
  const { availableForPayout } = earningsSummary(db, input.driverId, ctx.now);
  if (!Number.isInteger(input.amount) || input.amount < LIMITS.minWithdrawal) throw new DomainError("min_withdrawal", "Minimum withdrawal is ₹100.");
  if (input.amount > availableForPayout) throw new DomainError("insufficient_balance", "You can't withdraw more than your available balance.");
  const at = iso(ctx);
  const payout: Payout = {
    id: genId("pyo", ctx.rand),
    driverId: input.driverId,
    amount: input.amount,
    status: "completed",
    mode: "demo",
    idempotencyKey: input.idempotencyKey,
    destinationLabel: driver.payoutAccount ? `${driver.payoutAccount.bankName} ••••${driver.payoutAccount.accountLast4}` : "Bank account (demo)",
    requestedAt: at,
    completedAt: at,
  };
  db.payouts[payout.id] = payout;
  notify(db, ctx, { recipientRole: "driver", recipientId: input.driverId, kind: "payout_completed", title: "Demo payout simulated", body: "No money was moved — demo mode." });
  return payout;
}

export function shortCustomerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1]![0]}.`;
}
