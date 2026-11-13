import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BookingStatus } from "@/lib/domain/model";
import { setDocStoreForTests } from "@/server/db";
import type { BookingDoc } from "@/server/db/schema";
import { cancelBooking, listBookings, loadBookingView, tabCounts } from "@/server/modules/customer/bookings";
import { customerDashboard } from "@/server/modules/customer/dashboard";
import { listPayments } from "@/server/modules/customer/payments";
import type { MemoryDocStore } from "../../../support/memory-docstore";
import {
  CUSTOMER_ID,
  NOW,
  OTHER_CUSTOMER_ID,
  bookingDoc,
  customerSession,
  paymentDoc,
  secretsDoc,
  seededStore,
  shipmentDoc,
  tripDoc,
} from "./fixtures";

let store: MemoryDocStore;
const me = customerSession();
const SHP = "shp_aaaaaaaaaaaaaaaaaaaa";
const later = new Date(NOW.getTime() + 3600_000).toISOString();

function put(id: string, status: BookingStatus, over: Partial<BookingDoc> = {}) {
  store.put("bookings", id, bookingDoc({ id, status, shipmentId: SHP, ...over }));
}

beforeEach(() => {
  store = seededStore();
  setDocStoreForTests(store);
  store.put("trips", "trp_aaaaaaaaaaaaaaaaaaaa", tripDoc({ id: "trp_aaaaaaaaaaaaaaaaaaaa" }));
  store.put("shipments", SHP, shipmentDoc({ id: SHP, status: "booked", currentBookingId: "TAKI100001", bookingIds: ["TAKI100001"] }));
});
afterEach(() => setDocStoreForTests(null));

describe("toCustomerBookingView visibility (P2 §4.4)", () => {
  it("hides driver identity, registration and OTPs while awaiting the agency", async () => {
    put("TAKI100001", "awaiting_agency");
    const v = await loadBookingView(me, "TAKI100001", NOW);
    expect(v.driver).toBeNull();
    expect(v.vehicle).toBeNull();
    expect(v.otps).toBeNull();
    expect(v).toMatchObject({ status: "awaiting_agency", tab: "pending", canCancel: true, canPay: false, canReview: false });
    expect(JSON.stringify(v)).not.toContain("TN 37 AB 1234");
    expect(JSON.stringify(v)).not.toContain("+919811111111");
  });

  it("shares driver name and registration (not phone) once accepted; pay only inside the window", async () => {
    put("TAKI100001", "pending_payment", { paymentDueAt: later, acceptedAt: NOW.toISOString() });
    const v = await loadBookingView(me, "TAKI100001", NOW);
    expect(v.driver).toMatchObject({ name: "Ravi Kumar", phone: null, ratingAvg: 4.6 });
    expect(v.vehicle?.registrationNumber).toBe("TN 37 AB 1234");
    expect(v.canPay).toBe(true);
    expect(v.otps).toBeNull();
    const closed = await loadBookingView(me, "TAKI100001", new Date(Date.parse(later) + 1));
    expect(closed.canPay).toBe(false);
  });

  it("shows the driver phone and OTPs from confirmed; hides each OTP once used", async () => {
    put("TAKI100001", "confirmed", { paymentId: "pay_aaaaaaaaaaaaaaaaaaaa", paidAt: NOW.toISOString() });
    store.put("bookingSecrets", "TAKI100001", secretsDoc("TAKI100001"));
    store.put("payments", "pay_aaaaaaaaaaaaaaaaaaaa", paymentDoc("pay_aaaaaaaaaaaaaaaaaaaa", "TAKI100001"));
    const v = await loadBookingView(me, "TAKI100001", NOW);
    expect(v.driver?.phone).toBe("+919811111111");
    expect(v.otps).toEqual({ pickup: "123456", delivery: "654321", pickupUsed: false, deliveryUsed: false, pickupLocked: false, deliveryLocked: false });
    expect(v.payment).toMatchObject({ status: "succeeded", amountRupees: 6576, methodLabel: "UPI" });
    expect(v.canCancel).toBe(true);

    put("TAKI100001", "in_transit", { paymentId: "pay_aaaaaaaaaaaaaaaaaaaa" });
    store.put("bookingSecrets", "TAKI100001", secretsDoc("TAKI100001", { pickupUsedAt: NOW.toISOString(), deliveryAttempts: 5 }));
    const t = await loadBookingView(me, "TAKI100001", NOW);
    expect(t.otps).toMatchObject({ pickup: null, pickupUsed: true, delivery: "654321", deliveryLocked: true });
    expect(t.canCancel).toBe(false);

    put("TAKI100001", "delivered", { paymentId: "pay_aaaaaaaaaaaaaaaaaaaa" });
    const d = await loadBookingView(me, "TAKI100001", NOW);
    expect(d.otps).toBeNull();
    expect(d.canReview).toBe(true);
  });

  it("is a 404 for other customers", async () => {
    put("TAKI100001", "confirmed");
    await expect(loadBookingView(customerSession(OTHER_CUSTOMER_ID), "TAKI100001", NOW)).rejects.toMatchObject({ code: "not_found" });
    await expect(loadBookingView(me, "TAKI999999", NOW)).rejects.toMatchObject({ code: "not_found" });
    await expect(cancelBooking(customerSession(OTHER_CUSTOMER_ID), "TAKI100001", undefined, NOW)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("lists, counts, dashboard, payments", () => {
  beforeEach(() => {
    const at = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
    put("TAKI100001", "awaiting_agency", { updatedAt: at(1) });
    put("TAKI100002", "pending_payment", { updatedAt: at(2), paymentDueAt: later });
    put("TAKI100003", "confirmed", { updatedAt: at(3) });
    put("TAKI100004", "out_for_delivery", { updatedAt: at(4) });
    put("TAKI100005", "delivered", { updatedAt: at(5) });
    put("TAKI100006", "rejected", { updatedAt: at(6) });
    put("TAKI100007", "cancelled", { updatedAt: at(7), customerId: OTHER_CUSTOMER_ID });
    store.put("shipments", "shp_openaaaaaaaaaaaaaaaa", shipmentDoc({ id: "shp_openaaaaaaaaaaaaaaaa" }));
    store.put("payments", "pay_aaaaaaaaaaaaaaaaaaaa", paymentDoc("pay_aaaaaaaaaaaaaaaaaaaa", "TAKI100003"));
    store.put("payments", "pay_bbbbbbbbbbbbbbbbbbbb", paymentDoc("pay_bbbbbbbbbbbbbbbbbbbb", "TAKI100007", { customerId: OTHER_CUSTOMER_ID }));
    store.put("notifications", "ntf_aaaaaaaaaaaaaaaaaaaa", {
      id: "ntf_aaaaaaaaaaaaaaaaaaaa",
      userId: CUSTOMER_ID,
      role: "customer",
      kind: "booking_accepted",
      title: "Booking accepted",
      body: "Pay to confirm",
      link: { type: "booking", id: "TAKI100002" },
      createdAt: NOW.toISOString(),
      readAt: null,
    });
  });

  it("counts per tab and lists by tab / active, newest first", async () => {
    expect(await tabCounts(me)).toEqual({ pending: 2, confirmed: 1, picked_up: 0, in_transit: 1, delivered: 1, rejected: 1, cancelled: 0 });
    expect((await listBookings(me, { tab: "pending", limit: 20 })).items.map((b) => b.id)).toEqual(["TAKI100001", "TAKI100002"]);
    expect((await listBookings(me, { active: true, limit: 20 })).items.map((b) => b.id)).toEqual(["TAKI100001", "TAKI100002", "TAKI100003", "TAKI100004"]);
    const page1 = await listBookings(me, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    const page2 = await listBookings(me, { limit: 10, cursor: page1.nextCursor! });
    expect(page2.items.map((b) => b.id)).toEqual(["TAKI100003", "TAKI100004", "TAKI100005", "TAKI100006"]);
  });

  it("builds the dashboard from real records only", async () => {
    const d = await customerDashboard(me);
    expect(d.firstName).toBe("Priya");
    expect(d.counts.pending).toBe(2);
    expect(d.active.map((b) => b.id)).toEqual(["TAKI100001", "TAKI100002", "TAKI100003", "TAKI100004"]);
    expect(d.openShipments.map((s) => s.id)).toEqual(["shp_openaaaaaaaaaaaaaaaa"]);
    expect(d.recentActivity.map((n) => n.title)).toEqual(["Booking accepted"]);
  });

  it("lists only the customer's own payments", async () => {
    const p = await listPayments(me, { limit: 20 });
    expect(p.items).toEqual([expect.objectContaining({ id: "pay_aaaaaaaaaaaaaaaaaaaa", bookingId: "TAKI100003", amountRupees: 6576, routeLabel: "Coimbatore → Chennai" })]);
  });
});
