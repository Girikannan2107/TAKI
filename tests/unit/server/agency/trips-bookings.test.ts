/** Agency trips (drafts, publish via core, overlap, edits) and bookings (accept/reject via core, contact visibility) (D2). */
import { beforeEach, describe, expect, it } from "vitest";
import type { TripInput } from "@/lib/api/contracts/agency";
import { getDocStore } from "@/server/db";
import { C } from "@/server/db/collections";
import type { TripDoc } from "@/server/db/schema";
import { bookings as coreBookings } from "@/server/core/bookings";
import { acceptBooking, getBooking, listBookings, rejectBooking } from "@/server/modules/agency/bookings";
import { getDashboard } from "@/server/modules/agency/dashboard";
import { searchHistory } from "@/server/modules/agency/history";
import { cancelTrip, createTrip, deleteDraft, getTrip, listTrips, previewTrip, publishTrip, tripFormOptions, unpublishTrip, updateTrip } from "@/server/modules/agency/trips";
import { freshStore } from "../../../support/harness";
import { createShipment, createTrip as worldTrip, createWorld, ctxOf, idemKey, payDev, type World } from "../../../support/world";

const NOW = new Date("2026-11-20T04:30:00.000Z");
const H = 3_600_000;
const at = (h: number) => new Date(NOW.getTime() + h * H).toISOString();
let w: World;

function tripInput(over: Partial<TripInput> = {}, startH = 24): TripInput {
  return {
    vehicleId: w.vehicles[0]!.id,
    driverId: w.drivers[0]!.doc.id,
    offeredKg: 1000,
    acceptedGoods: ["general_goods", "textiles"],
    checkpoints: [
      { placeId: "coimbatore", expectedArrivalAt: null, expectedDepartureAt: at(startH) },
      { placeId: "erode", expectedArrivalAt: at(startH + 2), expectedDepartureAt: at(startH + 2.5) },
      { placeId: "salem", expectedArrivalAt: at(startH + 4), expectedDepartureAt: null },
    ],
    ...over,
  };
}

beforeEach(async () => {
  await freshStore();
  w = await createWorld(NOW);
});

describe("trips", () => {
  it("saves a draft with computed km and default rates, then publishes it through core", async () => {
    const draft = await createTrip(w.owner, tripInput(), NOW);
    expect(draft.status).toBe("draft");
    expect(draft.checkpoints.map((c) => c.placeName)).toEqual(["Coimbatore", "Erode", "Salem"]);
    expect(draft.distanceKm).toBeGreaterThan(100);
    expect(draft.publishBlockers).toEqual([]);

    const priced = await updateTrip(w.owner, draft.id, { ratePerKmPaise: 1500, ratePerKgPaise: 75 }, NOW);
    expect(priced.rates).toMatchObject({ perKmPaise: 1500, perKgPaise: 75 });

    const pub = await publishTrip(w.owner, draft.id, NOW);
    expect(pub.status).toBe("published");
    expect(pub.publishedAt).not.toBeNull();
    // Replay is a no-op.
    await expect(publishTrip(w.owner, draft.id, NOW)).resolves.toMatchObject({ status: "published" });

    const list = await listTrips(w.owner, { tab: "upcoming", limit: 20 }, NOW);
    expect(list.items.map((t) => t.id)).toContain(draft.id);
    expect(list.counts.upcoming).toBe(1);
    expect(list.counts.drafts).toBe(0);
  });

  it("refuses to publish for an unverified agency but allows drafts", async () => {
    await freshStore();
    w = await createWorld(NOW, { agencyStatus: "pending" });
    await expect(createTrip(w.owner, { ...tripInput(), publish: true, ratePerKmPaise: 1200, ratePerKgPaise: 50 }, NOW)).rejects.toMatchObject({ code: "agency_not_verified" });
    const draft = await createTrip(w.owner, tripInput(), NOW);
    expect(draft.publishBlockers[0]).toMatch(/verified/);
    await expect(publishTrip(w.owner, draft.id, NOW)).rejects.toMatchObject({ code: "agency_not_verified" });
    const opts = await tripFormOptions(w.owner, {}, NOW);
    expect(opts.verification).toBe("pending");
  });

  it("prevents overlapping assignments for the same driver or vehicle", async () => {
    const first = await createTrip(w.owner, { ...tripInput(), publish: true, ratePerKmPaise: 1200, ratePerKgPaise: 50 }, NOW);
    expect(first.status).toBe("published");

    // Same driver, other vehicle, overlapping window.
    await expect(
      createTrip(w.owner, { ...tripInput({ vehicleId: w.vehicles[1]!.id }, 25), publish: true, ratePerKmPaise: 1200, ratePerKgPaise: 50 }, NOW),
    ).rejects.toMatchObject({ code: "driver_schedule_conflict", fields: { driverId: expect.any(String) } });
    // Same vehicle, other driver.
    await expect(
      createTrip(w.owner, { ...tripInput({ driverId: w.drivers[1]!.doc.id }, 25), publish: true, ratePerKmPaise: 1200, ratePerKgPaise: 50 }, NOW),
    ).rejects.toMatchObject({ code: "vehicle_schedule_conflict" });

    // The form options flag both as busy in that window; a later window is free.
    const busy = await tripFormOptions(w.owner, { departureAt: at(25), arrivalAt: at(29) }, NOW);
    expect(busy.drivers.find((d) => d.id === w.drivers[0]!.doc.id)?.busy?.tripId).toBe(first.id);
    expect(busy.vehicles.find((v) => v.id === w.vehicles[0]!.id)?.busy?.tripId).toBe(first.id);
    const free = await createTrip(w.owner, { ...tripInput({}, 72), publish: true, ratePerKmPaise: 1200, ratePerKgPaise: 50 }, NOW);
    expect(free.status).toBe("published");
  });

  it("validates capacity and goods against the vehicle", async () => {
    await expect(createTrip(w.owner, tripInput({ offeredKg: 9000 }), NOW)).rejects.toMatchObject({ fields: { offeredKg: expect.any(String) } });
    await expect(createTrip(w.owner, tripInput({ maxCapacityKg: 1000, offeredKg: 1500 }), NOW)).rejects.toMatchObject({ fields: { offeredKg: expect.any(String) } });
  });

  it("locks route/time edits on a published trip but allows rates and capacity ≥ held", async () => {
    const t = await worldTrip(w, { offeredKg: 1000 });
    await expect(updateTrip(w.owner, t.id, { acceptedGoods: ["general_goods"] }, NOW)).rejects.toMatchObject({ code: "trip_has_bookings" });
    const s = await createShipment(w, 0, { weightKg: 300 });
    const { booking } = await coreBookings.request(ctxOf(w.customers[0]!.session, NOW), { shipmentId: s.id, tripId: t.id, idempotencyKey: idemKey() });
    await coreBookings.accept(ctxOf(w.owner, NOW), booking.id);
    await expect(updateTrip(w.owner, t.id, { offeredKg: 200 }, NOW)).rejects.toMatchObject({ code: "capacity_below_booked" });
    const ok = await updateTrip(w.owner, t.id, { offeredKg: 800, ratePerKmPaise: 1300 }, NOW);
    expect(ok.capacity.offeredKg).toBe(800);
    expect(ok.rates.perKmPaise).toBe(1300);
    // Unpublishing is refused while a hold exists.
    await expect(unpublishTrip(w.owner, t.id, NOW)).rejects.toMatchObject({ code: "trip_has_bookings" });
  });

  it("deletes never-published drafts only, and cancels published trips through core", async () => {
    const draft = await createTrip(w.owner, tripInput(), NOW);
    await deleteDraft(w.owner, draft.id);
    expect(await getDocStore().get<TripDoc>(C.trips, draft.id)).toBeNull();

    const pub = await worldTrip(w);
    await expect(deleteDraft(w.owner, pub.id)).rejects.toMatchObject({ code: "invalid_transition" });
    const cancelled = await cancelTrip(w.owner, pub.id, "Vehicle breakdown", NOW);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelReason).toBe("Vehicle breakdown");
  });

  it("previews distance and earnings for a route", () => {
    const p = previewTrip({ checkpoints: [{ placeId: "coimbatore" }, { placeId: "salem" }], ratePerKmPaise: 1200, ratePerKgPaise: 50, sampleWeightKg: 500 });
    expect(p.distanceKm).toBeGreaterThan(100);
    expect(p.earningsPreview.earnings).toBe(p.earningsPreview.distanceCharge + p.earningsPreview.weightCharge);
  });

  it("hides other agencies' trips", async () => {
    const t = await worldTrip(w);
    const other = await createWorld(NOW);
    await expect(getTrip(other.owner, t.id, NOW)).rejects.toMatchObject({ code: "not_found" });
    await expect(cancelTrip(other.owner, t.id, "nope nope", NOW)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("bookings", () => {
  async function requested(weightKg = 300) {
    const trip = await worldTrip(w, { offeredKg: 1000 });
    const s = await createShipment(w, 0, { weightKg });
    const { booking } = await coreBookings.request(ctxOf(w.customers[0]!.session, NOW), { shipmentId: s.id, tripId: trip.id, idempotencyKey: idemKey() });
    return { trip, booking };
  }

  it("lists pending requests with capacity after accepting, and hides contact details until accepted", async () => {
    const { booking } = await requested(300);
    const list = await listBookings(w.owner, { tab: "pending", limit: 20 }, NOW);
    expect(list.counts.pending).toBe(1);
    expect(list.items[0]).toMatchObject({ id: booking.id, capacity: { availableKg: 1000, afterAcceptKg: 700 } });

    const before = await getBooking(w.owner, booking.id, NOW);
    expect(before.customer.phone).toBeNull();
    expect(before.receiver).toBeNull();
    expect(before.addresses.pickup.line).toBeNull();

    const accepted = await acceptBooking(w.owner, booking.id, NOW);
    expect(accepted.status).toBe("pending_payment");
    expect(accepted.customer.phone).not.toBeNull();
    expect(accepted.addresses.pickup.line).not.toBeNull();
    expect(accepted.receiver).toBeNull(); // receiver only after payment confirms

    await payDev(w, 0, booking.id);
    const confirmed = await getBooking(w.owner, booking.id, NOW);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.receiver).not.toBeNull();
    expect(confirmed.sharedWithDriver).toBe(true);
    expect((await listBookings(w.owner, { tab: "confirmed", limit: 20 }, NOW)).items.map((b) => b.id)).toContain(booking.id);
  });

  it("refuses to accept a request that no longer fits", async () => {
    const trip = await worldTrip(w, { offeredKg: 500 });
    const a = await createShipment(w, 0, { weightKg: 400 });
    const b = await createShipment(w, 1, { weightKg: 400 });
    const ra = await coreBookings.request(ctxOf(w.customers[0]!.session, NOW), { shipmentId: a.id, tripId: trip.id, idempotencyKey: idemKey() });
    const rb = await coreBookings.request(ctxOf(w.customers[1]!.session, NOW), { shipmentId: b.id, tripId: trip.id, idempotencyKey: idemKey() });
    await acceptBooking(w.owner, ra.booking.id, NOW);
    await expect(acceptBooking(w.owner, rb.booking.id, NOW)).rejects.toMatchObject({ code: "insufficient_capacity" });
  });

  it("rejects with a reason (customer notified, nothing held)", async () => {
    const { trip, booking } = await requested();
    const r = await rejectBooking(w.owner, booking.id, "Goods not accepted", NOW);
    expect(r.status).toBe("rejected");
    expect(r.rejection?.note).toContain("Goods not accepted");
    const t = await getTrip(w.owner, trip.id, NOW);
    expect(t.capacity.availableKg).toBe(1000);
    const notes = await getDocStore().query<{ userId: string }>(C.notifications, { where: [["userId", "==", w.customers[0]!.doc.id]] });
    expect(notes.length).toBeGreaterThan(0);
  });

  it("does not let another agency read or decide a booking", async () => {
    const { booking } = await requested();
    const other = await createWorld(NOW);
    await expect(getBooking(other.owner, booking.id, NOW)).rejects.toMatchObject({ code: "not_found" });
    await expect(acceptBooking(other.owner, booking.id, NOW)).rejects.toMatchObject({ code: "not_found" });
    await expect(rejectBooking(other.owner, booking.id, "Nope nope", NOW)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("dashboard & history", () => {
  it("counts live records only", async () => {
    const empty = await getDashboard(w.owner, NOW);
    expect(empty).toMatchObject({ totals: { vehicles: 2, drivers: 2 }, pendingBookings: 0, completedShipments: 0, revenue: { thisMonth: 0, total: 0 } });

    const trip = await worldTrip(w);
    const s = await createShipment(w, 0, { weightKg: 200 });
    await coreBookings.request(ctxOf(w.customers[0]!.session, NOW), { shipmentId: s.id, tripId: trip.id, idempotencyKey: idemKey() });
    const d = await getDashboard(w.owner, NOW);
    expect(d.trips.upcoming).toBe(1);
    expect(d.pendingBookings).toBe(1);
    expect(d.upcomingTrips.map((t) => t.id)).toEqual([trip.id]);
  });

  it("searches bookings, vehicles and drivers", async () => {
    const trip = await worldTrip(w);
    const s = await createShipment(w, 0, { weightKg: 200 });
    const { booking } = await coreBookings.request(ctxOf(w.customers[0]!.session, NOW), { shipmentId: s.id, tripId: trip.id, idempotencyKey: idemKey() });

    const byId = await searchHistory(w.owner, { type: "bookings", q: booking.id });
    expect(byId.items.map((r) => r.id)).toContain(booking.id);
    const vehicles = await searchHistory(w.owner, { type: "vehicles", q: w.vehicles[0]!.registrationNumber });
    expect(vehicles.items.map((r) => r.id)).toContain(w.vehicles[0]!.id);
    const drivers = await searchHistory(w.owner, { type: "drivers", q: "driver 2" });
    expect(drivers.items.map((r) => r.id)).toEqual([w.drivers[1]!.doc.id]);
    const none = await searchHistory(w.owner, { type: "bookings", q: "zzzz-nothing" });
    expect(none.items).toEqual([]);
  });
});
