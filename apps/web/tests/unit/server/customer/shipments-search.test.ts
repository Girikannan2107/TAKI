import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CreateShipmentBody, GuestSearchQuery, OffersQuery } from "@/lib/api/contracts/customer";
import { setDocStoreForTests } from "@/server/db";
import type { ShipmentDoc } from "@/server/db/schema";
import { createShipment, getShipmentWithBookings, listShipments, updateShipment, withdrawShipment } from "@/server/modules/customer/shipments";
import { guestSearch, offersForShipment, tripDetails } from "@/server/modules/customer/search";
import type { MemoryDocStore } from "../../../support/memory-docstore";
import {
  AGENCY_ID,
  NOW,
  OTHER_CUSTOMER_ID,
  TODAY,
  TOMORROW,
  UNVERIFIED_AGENCY_ID,
  bookingDoc,
  customerSession,
  seededStore,
  shipmentDoc,
  shipmentInput,
  tripDoc,
} from "./fixtures";

let store: MemoryDocStore;
const me = customerSession();
const other = customerSession(OTHER_CUSTOMER_ID);
const filters = (q: Record<string, unknown> = {}) => OffersQuery.parse(q);

beforeEach(() => {
  store = seededStore();
  setDocStoreForTests(store);
});
afterEach(() => setDocStoreForTests(null));

describe("CreateShipmentBody", () => {
  it("validates addresses, pincode/state and distinct districts", () => {
    expect(CreateShipmentBody.safeParse(shipmentInput()).success).toBe(true);
    const sameDistrict = CreateShipmentBody.safeParse(shipmentInput({ to: "coimbatore" }));
    expect(sameDistrict.success).toBe(false);
    const badPin = shipmentInput();
    badPin.destination.pincode = "560001"; // Karnataka prefix for a TN address
    expect(CreateShipmentBody.safeParse(badPin).success).toBe(false);
    const noDeclaration = { ...shipmentInput(), package: { ...shipmentInput().package, prohibitedItemsDeclaration: false } };
    expect(CreateShipmentBody.safeParse(noDeclaration).success).toBe(false);
  });
});

describe("shipments module", () => {
  it("creates an open shipment with server-derived district names", async () => {
    const s = await createShipment(me, CreateShipmentBody.parse(shipmentInput()), NOW);
    expect(s.id).toMatch(/^shp_[a-z2-7]{20}$/);
    expect(s).toMatchObject({ customerId: me.userId, status: "open", currentBookingId: null, shippingDate: TOMORROW });
    expect(s.source.districtName).toBe("Coimbatore");
    expect(s.destination.districtName).toBe("Chennai");
    expect(store.dump<ShipmentDoc>("shipments")[s.id]).toBeTruthy();
  });

  it("rejects past and far-future shipping dates", async () => {
    await expect(createShipment(me, CreateShipmentBody.parse(shipmentInput({ date: "2026-11-19" })), NOW)).rejects.toMatchObject({ code: "past_date" });
    await expect(createShipment(me, CreateShipmentBody.parse(shipmentInput({ date: "2027-02-01" })), NOW)).rejects.toMatchObject({ code: "date_too_far" });
    await expect(createShipment(me, CreateShipmentBody.parse(shipmentInput({ date: TODAY })), NOW)).resolves.toBeTruthy();
  });

  it("hides other customers' shipments (404) and blocks edits with an open booking", async () => {
    const s = await createShipment(me, CreateShipmentBody.parse(shipmentInput()), NOW);
    await expect(getShipmentWithBookings(other, s.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(updateShipment(other, s.id, CreateShipmentBody.parse(shipmentInput()), NOW)).rejects.toMatchObject({ code: "not_found" });

    const edited = await updateShipment(me, s.id, CreateShipmentBody.parse(shipmentInput({ weightKg: 750 })), NOW);
    expect(edited.package.weightKg).toBe(750);

    store.put("shipments", s.id, { ...edited, status: "booked", currentBookingId: "TAKI123456" });
    await expect(updateShipment(me, s.id, CreateShipmentBody.parse(shipmentInput()), NOW)).rejects.toMatchObject({ code: "shipment_has_open_booking" });
    await expect(withdrawShipment(me, s.id, NOW)).rejects.toMatchObject({ code: "shipment_has_open_booking" });
  });

  it("lists open unbooked shipments, and by tab through bookings", async () => {
    store.put("trips", "trp_aaaaaaaaaaaaaaaaaaaa", tripDoc({ id: "trp_aaaaaaaaaaaaaaaaaaaa" }));
    store.put("shipments", "shp_open1aaaaaaaaaaaaaaa", shipmentDoc({ id: "shp_open1aaaaaaaaaaaaaaa", createdAt: "2026-11-20T01:00:00.000Z" }));
    store.put("shipments", "shp_open2aaaaaaaaaaaaaaa", shipmentDoc({ id: "shp_open2aaaaaaaaaaaaaaa", createdAt: "2026-11-20T02:00:00.000Z" }));
    store.put("shipments", "shp_bookdaaaaaaaaaaaaaaa", shipmentDoc({ id: "shp_bookdaaaaaaaaaaaaaaa", status: "booked", currentBookingId: "TAKI100001", bookingIds: ["TAKI100001"] }));
    store.put("shipments", "shp_otheraaaaaaaaaaaaaaa", shipmentDoc({ id: "shp_otheraaaaaaaaaaaaaaa", customerId: OTHER_CUSTOMER_ID }));
    store.put("bookings", "TAKI100001", bookingDoc({ id: "TAKI100001", status: "confirmed", shipmentId: "shp_bookdaaaaaaaaaaaaaaa" }));

    const open = await listShipments(me, { limit: 20 });
    expect(open.items.map((s) => s.id)).toEqual(["shp_open2aaaaaaaaaaaaaaa", "shp_open1aaaaaaaaaaaaaaa"]);

    const confirmed = await listShipments(me, { tab: "confirmed", limit: 20 });
    expect(confirmed.items).toHaveLength(1);
    expect(confirmed.items[0]!.currentBooking).toMatchObject({ id: "TAKI100001", status: "confirmed", vehicleClass: "Light Truck" });

    const detail = await getShipmentWithBookings(me, "shp_bookdaaaaaaaaaaaaaaa");
    expect(detail.bookings.map((b) => b.id)).toEqual(["TAKI100001"]);
    expect(detail.editable).toBe(false);

    await withdrawShipment(me, "shp_open1aaaaaaaaaaaaaaa", NOW);
    expect((await listShipments(me, { limit: 20 })).items.map((s) => s.id)).toEqual(["shp_open2aaaaaaaaaaaaaaa"]);
  });
});

describe("search", () => {
  beforeEach(() => {
    // Matching, cheap (higher rate on a shorter segment is irrelevant: same route).
    store.put("trips", "trp_aaaaaaaaaaaaaaaaaaaa", tripDoc({ id: "trp_aaaaaaaaaaaaaaaaaaaa" }));
    // Matching, pricier, Mini Truck, leaves Coimbatore later.
    store.put(
      "trips",
      "trp_bbbbbbbbbbbbbbbbbbbb",
      tripDoc({
        id: "trp_bbbbbbbbbbbbbbbbbbbb",
        rates: { perKmPaise: 1500, perKgPaise: 80, handlingFeeRupees: 0 },
        vehicle: { vehicleClass: "Mini Truck", makeModel: "Tata Ace", registrationNumber: "TN 01 X 1", bodyType: "open", photo: null, imageKey: "mini_delivery_truck_taki" },
        checkpoints: tripDoc({ id: "trp_x", date: TOMORROW }).checkpoints.map((c) => ({
          ...c,
          expectedDepartureAt: c.expectedDepartureAt ? new Date(Date.parse(c.expectedDepartureAt) + 2 * 3600_000).toISOString() : null,
          expectedArrivalAt: c.expectedArrivalAt ? new Date(Date.parse(c.expectedArrivalAt) + 2 * 3600_000).toISOString() : null,
        })),
      }),
    );
    // Not enough space.
    store.put("trips", "trp_cccccccccccccccccccc", tripDoc({ id: "trp_cccccccccccccccccccc", capacity: { vehicleMaxKg: 3000, offeredKg: 300 } }));
    // Restricted goods.
    store.put("trips", "trp_dddddddddddddddddddd", tripDoc({ id: "trp_dddddddddddddddddddd", goods: { accepted: ["construction"], handlingSupported: [], maxPackageKg: null, notes: null } }));
    // Unverified agency (never shown).
    store.put("trips", "trp_eeeeeeeeeeeeeeeeeeee", tripDoc({ id: "trp_eeeeeeeeeeeeeeeeeeee", agencyId: UNVERIFIED_AGENCY_ID }));
    // Other day, reverse direction, draft.
    store.put("trips", "trp_ffffffffffffffffffff", tripDoc({ id: "trp_ffffffffffffffffffff", date: "2026-11-23" }));
    store.put("trips", "trp_gggggggggggggggggggg", tripDoc({ id: "trp_gggggggggggggggggggg", status: "draft" }));
  });

  it("returns only matching trips with excluded counts, badges and sort", async () => {
    const s = await createShipment(me, CreateShipmentBody.parse(shipmentInput()), NOW);
    const r = await offersForShipment(me, s.id, filters(), NOW);
    expect(r.date).toBe(TOMORROW);
    expect(r.items.map((o) => o.tripId)).toEqual(["trp_aaaaaaaaaaaaaaaaaaaa", "trp_bbbbbbbbbbbbbbbbbbbb"]);
    expect(r.excludedForCapacity).toBe(1);
    expect(r.excludedForRestrictions).toBe(1);
    const first = r.items[0]!;
    expect(first.badge).toBe("best_price");
    expect(first.agency).toMatchObject({ id: AGENCY_ID, name: "Kovai Travels", verified: true, ratingAvg: 4.2 });
    expect(first.driver).toEqual({ ratingAvg: 4.6, ratingCount: 5, deliveries: 12 });
    expect(first.route.map((x) => x.role)).toEqual(["pickup", null, null, "drop"]);
    expect(first.route.every((x) => x.inSegment)).toBe(true);
    expect(first.vehicle.photoUrl).toBe("/api/files/fil_vehaaaaaaaaaaaaaaaaa");
    // No driver identity before acceptance.
    expect(JSON.stringify(first)).not.toContain("Ravi");
    expect(JSON.stringify(first)).not.toContain("TN 37 AB 1234");

    const desc = await offersForShipment(me, s.id, filters({ sort: "price_desc" }), NOW);
    expect(desc.items[0]!.tripId).toBe("trp_bbbbbbbbbbbbbbbbbbbb");
    const dep = await offersForShipment(me, s.id, filters({ sort: "departure_asc" }), NOW);
    expect(dep.items[0]!.tripId).toBe("trp_aaaaaaaaaaaaaaaaaaaa");
  });

  it("applies user filters and the date override", async () => {
    const s = await createShipment(me, CreateShipmentBody.parse(shipmentInput()), NOW);
    expect((await offersForShipment(me, s.id, filters({ vehicleClass: "Mini Truck" }), NOW)).items.map((o) => o.tripId)).toEqual(["trp_bbbbbbbbbbbbbbbbbbbb"]);
    const cheapest = (await offersForShipment(me, s.id, filters(), NOW)).items[0]!.pricing.totalPayable;
    expect((await offersForShipment(me, s.id, filters({ maxPrice: String(cheapest) }), NOW)).items).toHaveLength(1);
    expect((await offersForShipment(me, s.id, filters({ minPrice: String(cheapest + 1) }), NOW)).items).toHaveLength(1);
    expect((await offersForShipment(me, s.id, filters({ minCapacityKg: "5000" }), NOW)).items).toHaveLength(0);
    const other = await offersForShipment(me, s.id, filters({ date: "2026-11-23" }), NOW);
    expect(other.items.map((o) => o.tripId)).toEqual(["trp_ffffffffffffffffffff"]);
    await expect(offersForShipment(customerSession(OTHER_CUSTOMER_ID), s.id, filters(), NOW)).rejects.toMatchObject({ code: "not_found" });
  });

  it("lets guests search without exposing vehicle photo URLs", async () => {
    const q = GuestSearchQuery.parse({ from: "salem", to: "vellore", weightKg: "200", date: TOMORROW, goods: "agriculture" });
    const r = await guestSearch(q, NOW, null);
    expect(r.items.map((o) => o.tripId)).toEqual(["trp_aaaaaaaaaaaaaaaaaaaa", "trp_cccccccccccccccccccc", "trp_bbbbbbbbbbbbbbbbbbbb"]);
    expect(r.items[0]!.segmentKm).toBe(205);
    expect(r.items.every((o) => o.vehicle.photoUrl === null)).toBe(true);
    expect(GuestSearchQuery.safeParse({ from: "salem", to: "salem", weightKg: "200" }).success).toBe(false);
  });

  it("returns vehicle details with a problem instead of hiding the trip", async () => {
    const s = await createShipment(me, CreateShipmentBody.parse(shipmentInput()), NOW);
    const ok = await tripDetails(me, "trp_aaaaaaaaaaaaaaaaaaaa", { shipmentId: s.id }, NOW);
    expect(ok.problem).toBeNull();
    expect(ok.agencyInfo).toMatchObject({ districtName: "Coimbatore", statesCovered: ["TN", "KL"], memberSince: "2025-06-01", delivered: 7 });
    expect(ok.reviews).toEqual([]);
    const full = await tripDetails(me, "trp_cccccccccccccccccccc", { shipmentId: s.id }, NOW);
    expect(full.problem).toBe("insufficient_capacity");
    expect(full.problemMessage).toMatch(/space/);

    await expect(tripDetails(me, "trp_gggggggggggggggggggg", { shipmentId: s.id }, NOW)).rejects.toMatchObject({ code: "not_found" });
    await expect(tripDetails(me, "trp_eeeeeeeeeeeeeeeeeeee", { shipmentId: s.id }, NOW)).rejects.toMatchObject({ code: "not_found" });
    await expect(tripDetails(null, "trp_aaaaaaaaaaaaaaaaaaaa", { shipmentId: s.id }, NOW)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(tripDetails(me, "trp_aaaaaaaaaaaaaaaaaaaa", {}, NOW)).rejects.toMatchObject({ code: "invalid_request" });
    const guest = await tripDetails(null, "trp_aaaaaaaaaaaaaaaaaaaa", { from: "vellore", to: "chennai", weightKg: 100 }, NOW);
    expect(guest.segmentKm).toBe(128);
    expect(guest.vehicle.photoUrl).toBeNull();
    await expect(tripDetails(null, "trp_aaaaaaaaaaaaaaaaaaaa", { from: "chennai", to: "salem", weightKg: 100 }, NOW)).rejects.toMatchObject({ code: "not_on_route" });

    store.put("shipments", s.id, { ...store.dump<ShipmentDoc>("shipments")[s.id]!, currentBookingId: "TAKI100009", status: "booked" });
    expect((await tripDetails(me, "trp_aaaaaaaaaaaaaaaaaaaa", { shipmentId: s.id }, NOW)).existingBookingId).toBe("TAKI100009");
  });
});
