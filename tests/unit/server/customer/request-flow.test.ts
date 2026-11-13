import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDocStoreForTests } from "@/server/db";
import { cancelBooking, requestBooking, tabCounts } from "@/server/modules/customer/bookings";
import { createShipment } from "@/server/modules/customer/shipments";
import { tripDetails } from "@/server/modules/customer/search";
import type { MemoryDocStore } from "../../../support/memory-docstore";
import { NOW, customerSession, seededStore, shipmentInput, tripDoc } from "./fixtures";

const TRIP = "trp_aaaaaaaaaaaaaaaaaaaa";
const me = customerSession();
let store: MemoryDocStore;

beforeEach(() => {
  store = seededStore();
  setDocStoreForTests(store);
  store.put("trips", TRIP, tripDoc({ id: TRIP }));
});
afterEach(() => setDocStoreForTests(null));

describe("request → awaiting agency (D3 → core.bookings.request)", () => {
  it("creates one booking per Idempotency-Key and replays it", async () => {
    const shp = await createShipment(me, shipmentInput(), NOW);
    const first = await requestBooking(me, { shipmentId: shp.id, tripId: TRIP, idempotencyKey: "bkg_test_key_0001" }, NOW);
    expect(first.replayed).toBe(false);
    expect(first.booking.status).toBe("awaiting_agency");
    expect(first.booking.tab).toBe("pending");
    // Nothing the customer may not see yet.
    expect(first.booking.driver).toBeNull();
    expect(first.booking.otps).toBeNull();
    expect(first.booking.canPay).toBe(false);

    const again = await requestBooking(me, { shipmentId: shp.id, tripId: TRIP, idempotencyKey: "bkg_test_key_0001" }, NOW);
    expect(again.replayed).toBe(true);
    expect(again.booking.id).toBe(first.booking.id);
    expect((await tabCounts(me)).pending).toBe(1);
  });

  it("refuses a second open booking for the same shipment and links to it", async () => {
    const shp = await createShipment(me, shipmentInput(), NOW);
    const { booking } = await requestBooking(me, { shipmentId: shp.id, tripId: TRIP, idempotencyKey: "bkg_test_key_0002" }, NOW);
    await expect(requestBooking(me, { shipmentId: shp.id, tripId: TRIP, idempotencyKey: "bkg_test_key_0003" }, NOW)).rejects.toMatchObject({
      code: "shipment_has_open_booking",
      details: { bookingId: booking.id },
    });
    const d = await tripDetails(me, TRIP, { shipmentId: shp.id }, NOW);
    expect(d.existingBookingId).toBe(booking.id);
  });

  it("refuses goods the trip doesn't accept, as search does", async () => {
    const shp = await createShipment(me, shipmentInput({ goods: "electronics" }), NOW);
    const d = await tripDetails(me, TRIP, { shipmentId: shp.id }, NOW);
    expect(d.problem).toBe("goods_not_accepted");
    await expect(requestBooking(me, { shipmentId: shp.id, tripId: TRIP, idempotencyKey: "bkg_test_key_0004" }, NOW)).rejects.toMatchObject({ code: "goods_not_accepted" });
  });

  it("lets the customer cancel while awaiting the agency", async () => {
    const shp = await createShipment(me, shipmentInput(), NOW);
    const { booking } = await requestBooking(me, { shipmentId: shp.id, tripId: TRIP, idempotencyKey: "bkg_test_key_0005" }, NOW);
    expect(booking.canCancel).toBe(true);
    const cancelled = await cancelBooking(me, booking.id, undefined, NOW);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.tab).toBe("cancelled");
    expect(cancelled.canCancel).toBe(false);
  });
});
