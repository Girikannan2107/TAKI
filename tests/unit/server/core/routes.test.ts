/**
 * D5 route handlers called as Next would (Request + params promise): payments, notifications,
 * reviews, internal sweep, health, public contact/agencies. AuthN/authZ, validation, envelopes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueSession } from "@/server/auth/sessions";
import { setTestNow } from "@/server/clock";
import { getDocStore } from "@/server/db";
import { C } from "@/server/db/collections";
import type { ContactMessageDoc, UserDoc } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { GET as healthGET } from "@/app/api/health/route";
import { GET as sweepGET, POST as sweepPOST } from "@/app/api/internal/sweep/route";
import { GET as notificationsGET } from "@/app/api/notifications/route";
import { POST as readPOST } from "@/app/api/notifications/read/route";
import { GET as unreadGET } from "@/app/api/notifications/unread-count/route";
import { GET as paymentGET } from "@/app/api/payments/[paymentId]/route";
import { POST as devConfirmPOST } from "@/app/api/payments/dev/confirm/route";
import { POST as ordersPOST } from "@/app/api/payments/orders/route";
import { GET as agenciesGET } from "@/app/api/public/agencies/route";
import { POST as contactPOST } from "@/app/api/public/contact/route";
import { GET as reviewsGET } from "@/app/api/reviews/route";
import { ON_EMULATOR, freshStore } from "../../../support/harness";
import { createTrip, createWorld, requestAndAccept, type World } from "../../../support/world";
import type { BookingDoc } from "@/server/db/schema";
import type { SessionContext } from "@/server/core/context";

const T0 = new Date("2026-11-20T04:30:00.000Z");
const ORIGIN = "http://localhost:3000";
const noParams = { params: Promise.resolve({}) };
const TIMEOUT = ON_EMULATOR ? 120_000 : 20_000;

async function cookieFor(s: SessionContext): Promise<string> {
  const user = (await getDocStore().get<UserDoc>(C.users, s.userId))!;
  const issued = await issueSession(user, T0);
  return issued.setCookie.split(";")[0]!;
}

function req(path: string, o: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { ...o.headers };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.method && o.method !== "GET" && !("origin" in headers)) headers.origin = ORIGIN;
  return new Request(`${ORIGIN}${path}`, { method: o.method ?? "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
}

describe("D5 routes", () => {
  let w: World;
  let booking: BookingDoc;
  let customerCookie: string;
  beforeEach(async () => {
    await freshStore();
    setTestNow(T0);
    w = await createWorld(T0, { customers: 2 });
    const t = await createTrip(w);
    booking = await requestAndAccept(w, t, 0, 150);
    customerCookie = await cookieFor(w.customers[0]!.session);
  }, TIMEOUT);
  afterEach(() => {
    delete process.env.CRON_SECRET;
    resetEnvCache();
    setTestNow(null);
  });

  it("health reports the backends", async () => {
    const res = await healthGET(req("/api/health"), noParams);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: true, payments: "dev", sms: "dev" });
  });

  it("sweep requires the cron secret (GET and POST)", async () => {
    expect((await sweepPOST(req("/api/internal/sweep", { method: "POST", headers: { origin: "https://evil.example" } }), noParams)).status).toBe(503);
    process.env.CRON_SECRET = "cron-secret-for-tests";
    resetEnvCache();
    expect((await sweepPOST(req("/api/internal/sweep", { method: "POST", headers: { authorization: "Bearer nope" } }), noParams)).status).toBe(401);
    const ok = await sweepGET(req("/api/internal/sweep", { headers: { authorization: "Bearer cron-secret-for-tests" } }), noParams);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ expiredRequests: 0, expiredPayments: 0, jobsRun: 0 });
  });

  it(
    "payments: idempotency key required, create/reuse, owner-only status, dev Approve",
    async () => {
      const body = { bookingId: booking.id };
      const missing = await ordersPOST(req("/api/payments/orders", { method: "POST", body, cookie: customerCookie }), noParams);
      expect(missing.status).toBe(400);
      expect((await missing.json()).error.code).toBe("idempotency_key_required");
      const anon = await ordersPOST(req("/api/payments/orders", { method: "POST", body, headers: { "idempotency-key": "k-12345678" } }), noParams);
      expect(anon.status).toBe(401);
      const agencyCookie = await cookieFor(w.owner);
      expect((await ordersPOST(req("/api/payments/orders", { method: "POST", body, cookie: agencyCookie, headers: { "idempotency-key": "k-12345678" } }), noParams)).status).toBe(403);
      const first = await ordersPOST(req("/api/payments/orders", { method: "POST", body, cookie: customerCookie, headers: { "idempotency-key": "k-12345678" } }), noParams);
      expect(first.status).toBe(201);
      const order = await first.json();
      const again = await ordersPOST(req("/api/payments/orders", { method: "POST", body, cookie: customerCookie, headers: { "idempotency-key": "k-12345678" } }), noParams);
      expect(again.status).toBe(200);
      expect((await again.json()).paymentId).toBe(order.paymentId);

      const other = await cookieFor(w.customers[1]!.session);
      expect((await paymentGET(req(`/api/payments/${order.paymentId}`, { cookie: other }), { params: Promise.resolve({ paymentId: order.paymentId }) })).status).toBe(404);
      const st = await paymentGET(req(`/api/payments/${order.paymentId}`, { cookie: customerCookie }), { params: Promise.resolve({ paymentId: order.paymentId }) });
      expect(await st.json()).toMatchObject({ status: "pending", bookingStatus: "pending_payment" });

      const token = new URL(order.checkout.url, ORIGIN).searchParams.get("token");
      const bad = await devConfirmPOST(req("/api/payments/dev/confirm", { method: "POST", cookie: customerCookie, body: { paymentId: order.paymentId, outcome: "success", devToken: "x".repeat(32) } }), noParams);
      expect(bad.status).toBe(403);
      const ok = await devConfirmPOST(req("/api/payments/dev/confirm", { method: "POST", cookie: customerCookie, body: { paymentId: order.paymentId, outcome: "success", devToken: token } }), noParams);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ status: "succeeded", bookingStatus: "confirmed" });
    },
    TIMEOUT,
  );

  it(
    "notifications: list, unread count, mark read (own only)",
    async () => {
      expect((await notificationsGET(req("/api/notifications"), noParams)).status).toBe(401);
      const list = await notificationsGET(req("/api/notifications?limit=1", { cookie: customerCookie }), noParams);
      const page = await list.json();
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ kind: "booking_accepted", readAt: null });
      expect(page.items[0]).not.toHaveProperty("userId");
      expect((await (await unreadGET(req("/api/notifications/unread-count", { cookie: customerCookie }), noParams)).json()).count).toBe(1);
      // Another user can't mark it read.
      const other = await cookieFor(w.customers[1]!.session);
      expect((await readPOST(req("/api/notifications/read", { method: "POST", cookie: other, body: { ids: [page.items[0].id] } }), noParams)).status).toBe(204);
      expect((await (await unreadGET(req("/api/notifications/unread-count", { cookie: customerCookie }), noParams)).json()).count).toBe(1);
      expect((await readPOST(req("/api/notifications/read", { method: "POST", cookie: customerCookie, body: { all: true } }), noParams)).status).toBe(204);
      expect((await (await unreadGET(req("/api/notifications/unread-count", { cookie: customerCookie }), noParams)).json()).count).toBe(0);
      expect((await readPOST(req("/api/notifications/read", { method: "POST", cookie: customerCookie, body: {} }), noParams)).status).toBe(400);
    },
    TIMEOUT,
  );

  it("reviews need exactly one of driverId / agencyId", async () => {
    expect((await reviewsGET(req("/api/reviews", { cookie: customerCookie }), noParams)).status).toBe(400);
    const res = await reviewsGET(req(`/api/reviews?driverId=${w.drivers[0]!.doc.id}`, { cookie: customerCookie }), noParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it(
    "public contact: origin-checked, validated, stored, rate-limited; agencies picker lists verified ones",
    async () => {
      const body = { name: "Meena", phone: "9876543210", role: "customer", message: "Do you serve Madurai to Kochi?" };
      expect((await contactPOST(req("/api/public/contact", { method: "POST", body, headers: { origin: "https://evil.example" } }), noParams)).status).toBe(403);
      const invalid = await contactPOST(req("/api/public/contact", { method: "POST", body: { name: "M", message: "short" } }), noParams);
      expect(invalid.status).toBe(400);
      const ok = await contactPOST(req("/api/public/contact", { method: "POST", body }), noParams);
      expect(ok.status).toBe(201);
      const { id } = await ok.json();
      expect(await getDocStore().get<ContactMessageDoc>(C.contactMessages, id)).toMatchObject({ name: "Meena", phone: "+919876543210", status: "new" });
      for (let i = 0; i < 3; i++) expect((await contactPOST(req("/api/public/contact", { method: "POST", body }), noParams)).status).toBe(201);
      expect((await contactPOST(req("/api/public/contact", { method: "POST", body }), noParams)).status).toBe(201);
      const limited = await contactPOST(req("/api/public/contact", { method: "POST", body }), noParams);
      expect(limited.status).toBe(429);

      const agencies = await (await agenciesGET(req("/api/public/agencies?q=kovai"), noParams)).json();
      expect(agencies.items).toEqual([{ id: w.agency.id, agencyName: "Kovai Freight Lines", districtName: "Coimbatore", state: "TN" }]);
    },
    TIMEOUT,
  );
});
