import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDocStoreForTests } from "@/server/db";
import type { TripDoc, TripEventDoc } from "@/server/db/schema";
import { nextTripStep } from "@/server/views/driver";
import type { MemoryDocStore } from "../../../support/memory-docstore";
import { addBooking, baseStore, bookingDoc, DRIVER_ID, NOW, OTHER_DRIVER_ID, session, TRIP_ID, tripDoc } from "./fixtures";

/** Checkpoint ordering / auto transitions are D5 core's; the stub records the event so the view can be checked. */
const core = vi.hoisted(() => ({ store: null as MemoryDocStore | null, calls: [] as unknown[][] }));

vi.mock("@/server/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/core")>();
  const { DomainError: DE } = await import("@/lib/api/contracts/errors");
  return {
    ...actual,
    tripsLifecycle: {
      ...actual.tripsLifecycle,
      async checkpoint(_ctx: unknown, tripId: string, index: number, kind: "arrive" | "depart", i: { remarks?: string }) {
        core.calls.push([tripId, index, kind, i.remarks]);
        const s = core.store!;
        const t = (await s.get<TripDoc>("trips", tripId))!;
        const at = NOW.toISOString();
        const checkpoints = t.checkpoints.map((c) =>
          c.index === index ? { ...c, ...(kind === "arrive" ? { actualArrivalAt: at } : { actualDepartureAt: at }) } : c,
        );
        const next = { ...t, checkpoints, status: "in_progress" as const, startedAt: t.startedAt ?? at };
        s.put("trips", tripId, next);
        const ev: TripEventDoc = {
          id: `tev_${index}${kind}`,
          tripId,
          type: kind === "arrive" ? "checkpoint_arrived" : index === 0 ? "started" : "checkpoint_departed",
          checkpointIndex: index,
          at,
          clientAt: null,
          actor: { role: "driver", userId: t.driverId },
          remarks: i.remarks ?? null,
        };
        s.put(`trips/${tripId}/events`, ev.id, ev);
        return next;
      },
      async complete(_ctx: unknown, tripId: string) {
        const s = core.store!;
        const t = (await s.get<TripDoc>("trips", tripId))!;
        if (!t.checkpoints.at(-1)!.actualArrivalAt) throw new DE("checkpoint_out_of_order");
        const next = { ...t, status: "completed" as const, completedAt: NOW.toISOString() };
        s.put("trips", tripId, next);
        return next;
      },
    },
  };
});

const { completeTrip, getTrip, listTrips, recordCheckpoint } = await import("@/server/modules/driver/trips");
const { getDashboard } = await import("@/server/modules/driver/dashboard");
const { listHistory, monthRange, normalizeBookingQuery } = await import("@/server/modules/driver/history");

let store: MemoryDocStore;
beforeEach(() => {
  store = baseStore();
  core.store = store;
  core.calls = [];
  setDocStoreForTests(store);
});
afterEach(() => setDocStoreForTests(null));

describe("driver trips", () => {
  it("lists trips by filter for this driver only", async () => {
    store.put("trips", "trp_bbbbbbbbbbbbbbbbbbbb", tripDoc({ id: "trp_bbbbbbbbbbbbbbbbbbbb", driverId: OTHER_DRIVER_ID }));
    store.put("trips", "trp_cccccccccccccccccccc", tripDoc({ id: "trp_cccccccccccccccccccc" }, "completed"));
    store.put("trips", "trp_dddddddddddddddddddd", tripDoc({ id: "trp_dddddddddddddddddddd" }, "draft"));
    expect((await listTrips(session(), "upcoming")).items.map((t) => t.id)).toEqual([TRIP_ID]);
    expect((await listTrips(session(), "completed")).items.map((t) => t.id)).toEqual(["trp_cccccccccccccccccccc"]);
    expect((await listTrips(session(), "active")).items).toEqual([]);
  });

  it("hides drafts and other drivers' trips (404)", async () => {
    store.put("trips", "trp_bbbbbbbbbbbbbbbbbbbb", tripDoc({ id: "trp_bbbbbbbbbbbbbbbbbbbb", driverId: OTHER_DRIVER_ID }));
    store.put("trips", "trp_dddddddddddddddddddd", tripDoc({ id: "trp_dddddddddddddddddddd" }, "draft"));
    await expect(getTrip(session(), "trp_bbbbbbbbbbbbbbbbbbbb")).rejects.toMatchObject({ code: "not_found" });
    await expect(getTrip(session(), "trp_dddddddddddddddddddd")).rejects.toMatchObject({ code: "not_found" });
    await expect(recordCheckpoint(session(), "trp_bbbbbbbbbbbbbbbbbbbb", 0, "depart", {}, NOW)).rejects.toMatchObject({ code: "not_found" });
    expect(core.calls).toEqual([]);
  });

  it("shows pickups/drops per checkpoint and the next step", async () => {
    addBooking(store, bookingDoc("TAKI100001", "confirmed"));
    addBooking(store, bookingDoc("TAKI100002", "awaiting_agency"));
    store.put("trips", TRIP_ID, tripDoc({ holds: { TAKI100001: { kg: 50, kind: "paid", dueAt: null }, TAKI100009: { kg: 20, kind: "unpaid", dueAt: NOW.toISOString() } } }));
    const t = await getTrip(session(), TRIP_ID);
    expect(t.routeLabel).toBe("Coimbatore → Salem");
    expect(t.capacity).toEqual({ offeredKg: 1000, bookedKg: 50, reservedKg: 20 });
    expect(t.shipmentCount).toBe(1);
    expect(t.checkpoints[0]!.pickups.map((b) => b.bookingId)).toEqual(["TAKI100001"]);
    expect(t.checkpoints[2]!.drops.map((b) => b.bookingId)).toEqual(["TAKI100001"]);
    expect(t.nextStep).toEqual({ kind: "depart", index: 0, placeName: "Coimbatore", expectedAt: "2026-11-20T06:00:00.000Z" });
    expect(t.canComplete).toBe(false);
  });

  it("records checkpoint events through core and returns the updated trip", async () => {
    const t1 = await recordCheckpoint(session(), TRIP_ID, 0, "depart", { remarks: "Loaded" }, NOW);
    expect(core.calls).toEqual([[TRIP_ID, 0, "depart", "Loaded"]]);
    expect(t1.status).toBe("in_progress");
    expect(t1.checkpoints[0]!.actualDepartureAt).toBe(NOW.toISOString());
    expect(t1.events).toHaveLength(1);
    expect(t1.nextStep).toMatchObject({ kind: "arrive", index: 1 });
    const t2 = await recordCheckpoint(session(), TRIP_ID, 1, "arrive", {}, NOW);
    expect(t2.nextStep).toMatchObject({ kind: "depart", index: 1 });
  });

  it("allows completing only after arriving at the destination with nothing undelivered", async () => {
    const t = tripDoc({}, "in_progress");
    t.checkpoints = t.checkpoints.map((c) => ({ ...c, actualArrivalAt: NOW.toISOString(), actualDepartureAt: NOW.toISOString() }));
    store.put("trips", TRIP_ID, t);
    addBooking(store, bookingDoc("TAKI100001", "out_for_delivery"));
    expect((await getTrip(session(), TRIP_ID)).canComplete).toBe(false);
    addBooking(store, bookingDoc("TAKI100001", "delivered"));
    const v = await getTrip(session(), TRIP_ID);
    expect(v.nextStep).toBeNull();
    expect(v.canComplete).toBe(true);
    expect((await completeTrip(session(), TRIP_ID, NOW)).status).toBe("completed");
  });

  it("computes the next step in route order", () => {
    const t = tripDoc({}, "in_progress");
    expect(nextTripStep(t)).toMatchObject({ kind: "depart", index: 0 });
    t.checkpoints[0]!.actualDepartureAt = "x";
    t.checkpoints[1]!.actualArrivalAt = "x";
    t.checkpoints[1]!.actualDepartureAt = "x";
    expect(nextTripStep(t)).toMatchObject({ kind: "arrive", index: 2 });
    expect(nextTripStep({ ...t, status: "completed" })).toBeNull();
  });

  it("requires an approved driver", async () => {
    store = baseStore("pending");
    setDocStoreForTests(store);
    await expect(listTrips(session(), "upcoming")).rejects.toMatchObject({ code: "driver_not_linked" });
    await expect(getTrip(session(), TRIP_ID)).rejects.toMatchObject({ code: "driver_not_linked" });
  });
});

describe("driver dashboard", () => {
  it("shows only the pending state until the agency approves", async () => {
    store = baseStore("pending");
    setDocStoreForTests(store);
    addBooking(store, bookingDoc("TAKI100001", "confirmed"));
    const d = await getDashboard(session());
    expect(d.approved).toBe(false);
    expect(d.agency).toEqual({ agencyId: "agc_aaaaaaaaaaaaaaaaaaaa", agencyName: "Kovai Travels", status: "pending" });
    expect(d).toMatchObject({ activeTrips: 0, pendingPickups: 0, inTransit: 0, completedDeliveries: 0, nextTrip: null, nextActions: [] });
  });

  it("counts real records and picks the in-progress trip first", async () => {
    store.put("trips", "trp_eeeeeeeeeeeeeeeeeeee", tripDoc({ id: "trp_eeeeeeeeeeeeeeeeeeee", departureAt: "2026-11-19T06:00:00.000Z" }, "in_progress"));
    store.put("trips", "trp_ffffffffffffffffffff", tripDoc({ id: "trp_ffffffffffffffffffff" }, "completed"));
    addBooking(store, bookingDoc("TAKI100001", "confirmed"));
    addBooking(store, bookingDoc("TAKI100002", "confirmed", { pickup: { checkpointIndex: 1, districtId: "erode", placeName: "Erode", expectedDepartureAt: "2026-11-20T08:30:00.000Z" } }));
    addBooking(store, bookingDoc("TAKI100003", "picked_up"));
    addBooking(store, bookingDoc("TAKI100004", "out_for_delivery"));
    addBooking(store, bookingDoc("TAKI100005", "delivered"));
    addBooking(store, bookingDoc("TAKI100006", "confirmed", { driverId: OTHER_DRIVER_ID }));
    const d = await getDashboard(session());
    expect(d).toMatchObject({ approved: true, activeTrips: 2, pendingPickups: 2, inTransit: 2, completedDeliveries: 1 });
    expect(d.nextTrip?.id).toBe("trp_eeeeeeeeeeeeeeeeeeee");
    expect(d.nextActions.map((a) => a.bookingId)).toEqual(["TAKI100001", "TAKI100002"]);
    expect(d.driver.fullName).toBe("Ravi Kumar");
  });

  it("is empty (no fabricated rows) for a new approved driver", async () => {
    store.put("trips", TRIP_ID, tripDoc({ driverId: OTHER_DRIVER_ID }));
    const d = await getDashboard(session());
    expect(d).toMatchObject({ approved: true, activeTrips: 0, pendingPickups: 0, inTransit: 0, completedDeliveries: 0, nextTrip: null, nextActions: [] });
  });
});

describe("driver history", () => {
  it("lists delivered shipments only, newest first, with month and booking-id filters", async () => {
    addBooking(store, bookingDoc("TAKI100001", "delivered", { updatedAt: "2026-10-31T19:00:00.000Z" })); // 1 Nov IST
    addBooking(store, bookingDoc("TAKI100002", "delivered", { updatedAt: "2026-10-31T17:00:00.000Z" })); // 31 Oct IST
    addBooking(store, bookingDoc("TAKI100003", "in_transit"));
    addBooking(store, bookingDoc("TAKI100004", "delivered", { driverId: OTHER_DRIVER_ID }));

    expect((await listHistory(session(), { limit: 20 })).items.map((i) => i.bookingId)).toEqual(["TAKI100001", "TAKI100002"]);
    expect((await listHistory(session(), { limit: 20, month: "2026-11" })).items.map((i) => i.bookingId)).toEqual(["TAKI100001"]);
    expect((await listHistory(session(), { limit: 20, month: "2026-10" })).items.map((i) => i.bookingId)).toEqual(["TAKI100002"]);
    expect((await listHistory(session(), { limit: 20, q: "taki100002" })).items.map((i) => i.bookingId)).toEqual(["TAKI100002"]);
    expect((await listHistory(session(), { limit: 20, q: "100003" })).items).toEqual([]);
    expect((await listHistory(session(), { limit: 20, q: "TAKI100004" })).items).toEqual([]);
    expect((await listHistory(session(), { limit: 20, q: "nonsense" })).items).toEqual([]);
  });

  it("includes the first delivery-proof photo as a thumbnail", async () => {
    addBooking(store, bookingDoc("TAKI100001", "delivered"));
    addBooking(store, bookingDoc("TAKI100002", "delivered"));
    store.put("bookings/TAKI100001/events", "evt_deliv", {
      id: "evt_deliv",
      bookingId: "TAKI100001",
      type: "delivered",
      at: NOW.toISOString(),
      clientAt: null,
      actor: { role: "driver", userId: DRIVER_ID },
      checkpointIndex: 1,
      placeName: "Madurai",
      remarks: null,
      files: [{ fileId: "fil_proofaaaaaaaaaaaaaaa" }, { fileId: "fil_proofbbbbbbbbbbbbbbb" }],
    });
    const items = (await listHistory(session(), { limit: 20 })).items;
    const byId = Object.fromEntries(items.map((i) => [i.bookingId, i.proofThumbUrl]));
    expect(byId.TAKI100001).toBe("/api/files/fil_proofaaaaaaaaaaaaaaa");
    expect(byId.TAKI100002).toBeNull();
  });

  it("keeps records visible after the agency link ends", async () => {
    store = baseStore("rejected");
    setDocStoreForTests(store);
    addBooking(store, bookingDoc("TAKI100001", "delivered"));
    expect((await listHistory(session(), { limit: 20 })).items).toHaveLength(1);
  });

  it("parses booking queries and IST month ranges", () => {
    expect(normalizeBookingQuery(" taki 123456 ")).toBe("TAKI123456");
    expect(normalizeBookingQuery("123456")).toBe("TAKI123456");
    expect(normalizeBookingQuery("12345")).toBeNull();
    expect(monthRange("2026-12")).toEqual({ from: "2026-11-30T18:30:00.000Z", to: "2026-12-31T18:30:00.000Z" });
  });
});
