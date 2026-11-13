/**
 * The dev seed is also an end-to-end smoke test of the core: it must run cleanly at any time of
 * day, produce bookings in every status, and leave every trip's capacity invariant intact.
 * Memory store (+ MemoryFileStore) by default; the emulator pass runs it against Firestore.
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { capacityInvariant, effectiveAvailableKg as capacityLeft } from "@/lib/domain/capacity";
import { setTestNow } from "@/server/clock";
import { getDocStore } from "@/server/db";
import { C } from "@/server/db/collections";
import type { BookingDoc, BookingSecretsDoc, EarningDoc, PaymentDoc, SettlementDoc, TripDoc, UserDoc } from "@/server/db/schema";
import { setFileStoreForTests } from "@/server/files/filestore";
import { SEED_DEFAULT_PASSWORD, runSeed } from "@/server/seed";
import { verifyPassword } from "@/server/auth/passwords";
import { ON_EMULATOR, freshStore } from "../../../support/harness";
import { MemoryFileStore } from "../../../support/memory-filestore";

const ASSETS = path.resolve(__dirname, "../../../../scripts/seed/assets");
const STATUSES = ["awaiting_agency", "pending_payment", "payment_failed", "confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered", "rejected", "cancelled"];

describe(`seed (${ON_EMULATOR ? "firestore emulator" : "memory"})`, () => {
  afterEach(() => {
    setFileStoreForTests(null);
    setTestNow(null);
  });

  // 15:00 IST and 23:40 IST (late-night runs must not create schedule overlaps).
  for (const at of ["2026-11-20T09:30:00.000Z", "2026-11-20T18:10:00.000Z"]) {
    it(
      `seeds every booking status through the core (now = ${at})`,
      async () => {
        await freshStore();
        setFileStoreForTests(new MemoryFileStore());
        const now = new Date(at);
        const r = await runSeed({ now, password: SEED_DEFAULT_PASSWORD, assetsDir: ASSETS });
        for (const s of STATUSES) expect(r.counts[`booking:${s}`] ?? 0, s).toBeGreaterThan(0);
        expect(r.counts.trips).toBeGreaterThanOrEqual(15);

        const store = getDocStore();
        const trips = await store.query<TripDoc>(C.trips, {});
        expect(trips.filter((t) => t.status === "published").length).toBeGreaterThanOrEqual(12);
        expect(trips.filter((t) => t.status === "in_progress")).toHaveLength(1);
        expect(trips.filter((t) => t.status === "completed")).toHaveLength(2);
        expect(trips.filter((t) => t.status === "draft")).toHaveLength(1);
        const all = await store.query<BookingDoc>(C.bookings, {});
        for (const t of trips) expect(capacityInvariant(t, all.filter((b) => b.tripId === t.id), now), t.id).toEqual([]);

        const settled = await store.query<SettlementDoc>(C.settlements, {});
        expect(settled.map((s) => s.reference)).toEqual(["SEED-UTR-0001"]);
        const earnings = await store.query<EarningDoc>(C.earnings, {});
        expect(earnings.some((e) => e.status === "pending")).toBe(true);
        expect(earnings.some((e) => e.status === "settled")).toBe(true);
        const refunded = await store.query<PaymentDoc>(C.payments, { where: [["status", "==", "refunded"]] });
        expect(refunded.length).toBeGreaterThan(0);

        // Demo accounts: password works; demo customer has a CONFIRMED booking with the demo driver.
        const customer = (await store.query<UserDoc>(C.users, { where: [["phone", "==", "+919876543210"]] }))[0]!;
        const driver = (await store.query<UserDoc>(C.users, { where: [["phone", "==", "+919876543211"]] }))[0]!;
        expect((await verifyPassword(SEED_DEFAULT_PASSWORD, customer.passwordHash)).ok).toBe(true);
        const demo = all.filter((b) => b.customerId === customer.id && b.driverId === driver.id && b.status === "confirmed");
        expect(demo.length).toBeGreaterThan(0);
        expect(await store.get<BookingSecretsDoc>(C.bookingSecrets, demo[0]!.id)).not.toBeNull();
        expect(all.some((b) => b.driverId === driver.id && b.status === "delivered")).toBe(true);
        // D3: the demo customer also has an in-transit and a delivered booking.
        for (const st of ["in_transit", "delivered"]) expect(all.some((b) => b.customerId === customer.id && b.status === st), st).toBe(true);
        // A published Coimbatore → Chennai trip with at least 100 kg free.
        const cbeMaa = trips.filter((t) => t.status === "published" && t.checkpoints[0]!.districtId === "coimbatore" && t.checkpoints.at(-1)!.districtId === "chennai");
        expect(cbeMaa.some((t) => capacityLeft(t, now) >= 100)).toBe(true);
      },
      ON_EMULATOR ? 300_000 : 60_000,
    );
  }
});
