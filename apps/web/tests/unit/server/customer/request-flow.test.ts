import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDocStoreForTests } from "@/server/db";
import type { SessionContext } from "@/server/auth/guards";
import { bookings as coreBookings } from "@/server/core/bookings";
import { devTokenFor } from "@/server/payments/dev";
import { payments } from "@/server/payments/service";
import { cancelBooking, listBookings, loadBookingView, requestBooking, tabCounts } from "@/server/modules/customer/bookings";
import { listPayments } from "@/server/modules/customer/payments";
import { createShipment } from "@/server/modules/customer/shipments";
import { tripDetails } from "@/server/modules/customer/search";
import type { MemoryDocStore } from "../../../support/memory-docstore";
import { AGENCY_ID, NOW, customerSession, seededStore, shipmentInput, tripDoc } from "./fixtures";

const TRIP = "trp_aaaaaaaaaaaaaaaaaaaa";
const me = customerSession();
const agencyOwner = {
  userId: "usr_ownraaaaaaaaaaaaaaaa",
  role: "agency",
  sessionId: "sess_agency",
  phone: "+919800000009",
  profileId: AGENCY_ID,
  agencyId: AGENCY_ID,
  expiresAt: "2026-12-01T00:00:00.000Z",
  createdAt: NOW.toISOString(),
  name: "Owner",
} as SessionContext;
const later = (min: number) => new Date(NOW.getTime() + min * 60_000);
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

describe("request → agency accepts (core) → pay (D5 dev gateway) → confirmed", () => {
  it("shows the driver, payment window and OTPs only at the right steps", async () => {
    const shp = await createShipment(me, shipmentInput(), NOW);
    const { booking } = await requestBooking(me, { shipmentId: shp.id, tripId: TRIP, idempotencyKey: "bkg_test_key_0100" }, NOW);

    await coreBookings.accept({ now: later(5), actor: agencyOwner }, booking.id);
    const accepted = await loadBookingView(me, booking.id, later(6));
    expect(accepted.status).toBe("pending_payment");
    expect(accepted.tab).toBe("pending");
    expect(accepted.canPay).toBe(true);
    expect(accepted.paymentDueAt).not.toBeNull();
    expect(accepted.driver?.name).toBe("Ravi Kumar");
    expect(accepted.driver?.phone ?? null).toBeNull();
    expect(accepted.otps).toBeNull();

    const ctx = { now: later(7), actor: me };
    const order = await payments.createOrder(ctx, booking.id, "pay_test_key_0100");
    expect(order).toMatchObject({ provider: "dev", amountRupees: accepted.pricing.totalPayable });
    expect(order.checkout).toMatchObject({ kind: "dev", url: expect.stringContaining("/customer/payment/dev-gateway?paymentId=") });
    // Nothing confirms on its own.
    expect((await loadBookingView(me, booking.id, later(8))).status).toBe("pending_payment");

    await payments.devConfirm(ctx, { paymentId: order.paymentId, outcome: "success", devToken: devTokenFor(order.paymentId) });
    const paid = await loadBookingView(me, booking.id, later(9));
    expect(paid.status).toBe("confirmed");
    expect(paid.tab).toBe("confirmed");
    expect(paid.canPay).toBe(false);
    expect(paid.canCancel).toBe(true);
    expect(paid.driver?.phone).toBeTruthy();
    expect(paid.otps?.pickup).toMatch(/^\d{6}$/);

    expect((await tabCounts(me)).confirmed).toBe(1);
    expect((await listBookings(me, { tab: "confirmed", limit: 10 })).items.map((b) => b.id)).toEqual([booking.id]);
    const history = await listPayments(me, { limit: 10 });
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ bookingId: booking.id });
  });

  it("refuses a request once the trip has left (or is within the lead time of) the pickup", async () => {
    const shp = await createShipment(me, shipmentInput(), NOW);
    // Pickup departs 08:00 IST tomorrow; 07:30 IST is inside the lead window.
    const tooLate = new Date("2026-11-21T02:00:00.000Z");
    const d = await tripDetails(me, TRIP, { shipmentId: shp.id }, tooLate);
    expect(d.problem).toBe("departed");
    await expect(requestBooking(me, { shipmentId: shp.id, tripId: TRIP, idempotencyKey: "bkg_test_key_0101" }, tooLate)).rejects.toMatchObject({ code: expect.stringMatching(/departed|trip_not_bookable|request_expired/) });
  });
});
