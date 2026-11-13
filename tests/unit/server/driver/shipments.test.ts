import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/api/contracts/errors";
import { setDocStoreForTests } from "@/server/db";
import type { BookingDoc, BookingEventDoc, FileDoc } from "@/server/db/schema";
import { setFileStoreForTests } from "@/server/files/filestore";
import { MemoryFileStore } from "../../../support/memory-filestore";
import type { MemoryDocStore } from "../../../support/memory-docstore";
import { addBooking, baseStore, bookingDoc, NOW, OTHER_DRIVER_ID, session } from "./fixtures";

/**
 * Core transitions are D5's (tested in tests/unit/server/core). Here they are stubbed with the
 * minimum state change so the driver module's authorisation, uploads and projections are tested.
 */
const core = vi.hoisted(() => ({
  store: null as MemoryDocStore | null,
  calls: [] as Array<{ fn: string; args: unknown[] }>,
}));

vi.mock("@/server/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/core")>();
  const { DomainError: DE } = await import("@/lib/api/contracts/errors");
  const setStatus = async (id: string, status: BookingDoc["status"], extra: Partial<BookingEventDoc> = {}) => {
    const s = core.store!;
    const b = (await s.get<BookingDoc>("bookings", id))!;
    s.put("bookings", id, { ...b, status, statusHistory: [...b.statusHistory, { status, at: NOW.toISOString(), by: { role: "driver", userId: b.driverId } }], updatedAt: NOW.toISOString() });
    const ev: BookingEventDoc = {
      id: `bev_${status}`,
      bookingId: id,
      type: status === "cancelled" ? "cancelled" : (status as BookingEventDoc["type"]),
      at: NOW.toISOString(),
      clientAt: null,
      actor: { role: "driver", userId: b.driverId },
      checkpointIndex: null,
      placeName: null,
      remarks: null,
      files: [],
      ...extra,
    };
    s.put(`bookings/${id}/events`, ev.id, ev);
    return (await s.get<BookingDoc>("bookings", id))!;
  };
  return {
    ...actual,
    bookings: {
      ...actual.bookings,
      async pickup(_ctx: unknown, id: string, otp: string, remarks?: string) {
        core.calls.push({ fn: "pickup", args: [id, otp, remarks] });
        if (otp !== "123456") throw new DE("otp_invalid", undefined, { details: { attemptsLeft: 4 } });
        return setStatus(id, "picked_up", { remarks: remarks ?? null });
      },
      async refusePickup(_ctx: unknown, id: string, reason: string) {
        core.calls.push({ fn: "refusePickup", args: [id, reason] });
        return setStatus(id, "cancelled");
      },
      async startTransit(_ctx: unknown, id: string) {
        return setStatus(id, "in_transit");
      },
      async outForDelivery(_ctx: unknown, id: string) {
        return setStatus(id, "out_for_delivery");
      },
      async deliver(_ctx: unknown, id: string, i: { otp: string; proofFileIds: string[]; remarks?: string }) {
        core.calls.push({ fn: "deliver", args: [id, i] });
        if (i.otp !== "654321") throw new DE("otp_invalid");
        return setStatus(id, "delivered", { remarks: i.remarks ?? null, files: i.proofFileIds.map((fileId) => ({ fileId })) });
      },
      async addRemark(_ctx: unknown, id: string, text: string) {
        const ev: BookingEventDoc = {
          id: "bev_remark",
          bookingId: id,
          type: "remark",
          at: NOW.toISOString(),
          clientAt: null,
          actor: { role: "driver", userId: "x" },
          checkpointIndex: null,
          placeName: null,
          remarks: text,
          files: [],
        };
        core.store!.put(`bookings/${id}/events`, ev.id, ev);
        return ev;
      },
    },
  };
});

const { addRemark, confirmDelivery, confirmPickup, getShipment, listShipments, outForDelivery, refusePickup, startTransit, deliveryRemarks } = await import(
  "@/server/modules/driver/shipments"
);

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const jpeg = (name = "proof.jpg") => new File([JPEG], name, { type: "image/jpeg" });

let store: MemoryDocStore;
let files: MemoryFileStore;

beforeEach(() => {
  store = baseStore();
  core.store = store;
  core.calls = [];
  files = new MemoryFileStore();
  setDocStoreForTests(store);
  setFileStoreForTests(files);
});
afterEach(() => {
  setDocStoreForTests(null);
  setFileStoreForTests(null);
});

describe("driver shipments — visibility", () => {
  it("lists only this driver's bookings per tab, earliest pickup first", async () => {
    addBooking(store, bookingDoc("TAKI100001", "confirmed", { pickup: { checkpointIndex: 1, districtId: "erode", placeName: "Erode", expectedDepartureAt: "2026-11-20T08:30:00.000Z" } }));
    addBooking(store, bookingDoc("TAKI100002", "confirmed"));
    addBooking(store, bookingDoc("TAKI100003", "in_transit"));
    addBooking(store, bookingDoc("TAKI100004", "out_for_delivery"));
    addBooking(store, bookingDoc("TAKI100005", "delivered"));
    addBooking(store, bookingDoc("TAKI100006", "pending_payment"));
    addBooking(store, bookingDoc("TAKI100007", "confirmed", { driverId: OTHER_DRIVER_ID }));

    const pickup = await listShipments(session(), { tab: "pending_pickup", limit: 20 });
    expect(pickup.items.map((i) => i.bookingId)).toEqual(["TAKI100002", "TAKI100001"]);
    expect(pickup.items[0]).toMatchObject({ customerName: "Asha", receiverName: "Meena", trip: { routeLabel: "Coimbatore → Salem" } });

    const transit = await listShipments(session(), { tab: "in_transit", limit: 20 });
    expect(transit.items.map((i) => i.bookingId).sort()).toEqual(["TAKI100003", "TAKI100004"]);

    const delivered = await listShipments(session(), { tab: "delivered", limit: 20 });
    expect(delivered.items.map((i) => i.bookingId)).toEqual(["TAKI100005"]);
    expect(delivered.items[0]!.deliveredAt).not.toBeNull();
  });

  it("paginates with an opaque cursor", async () => {
    for (let i = 1; i <= 5; i++) addBooking(store, bookingDoc(`TAKI20000${i}`, "in_transit"));
    const p1 = await listShipments(session(), { tab: "in_transit", limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await listShipments(session(), { tab: "in_transit", limit: 2, cursor: p1.nextCursor! });
    const p3 = await listShipments(session(), { tab: "in_transit", limit: 2, cursor: p2.nextCursor! });
    const all = [...p1.items, ...p2.items, ...p3.items].map((i) => i.bookingId);
    expect(new Set(all).size).toBe(5);
    expect(p3.nextCursor).toBeNull();
  });

  it("requires an active agency link", async () => {
    store = baseStore("pending");
    setDocStoreForTests(store);
    await expect(listShipments(session(), { tab: "pending_pickup", limit: 20 })).rejects.toMatchObject({ code: "driver_not_linked" });
  });

  it("shows contacts and full addresses for an assigned confirmed booking, never pricing or OTP", async () => {
    addBooking(store, bookingDoc("TAKI100001", "confirmed"));
    const v = await getShipment(session(), "TAKI100001");
    expect(v.customer).toEqual({ name: "Asha", phone: "+919822222222" });
    expect(v.receiver).toEqual({ name: "Meena", phone: "+919811111111" });
    expect(v.pickupAddress?.line1).toBe("12 Market Road");
    expect(v.dropAddress?.mapsUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    expect(v.allowedActions).toEqual(["pickup", "refuse_pickup", "remark"]);
    expect(v.checkpoints.map((c) => [c.index, c.isPickup, c.isDrop])).toEqual([
      [0, true, false],
      [1, false, false],
      [2, false, true],
    ]);
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/pricing|totalPayable|otp/i);
  });

  it("returns 404 for another driver's booking and for bookings not yet confirmed", async () => {
    addBooking(store, bookingDoc("TAKI100001", "confirmed", { driverId: OTHER_DRIVER_ID }));
    addBooking(store, bookingDoc("TAKI100002", "pending_payment"));
    await expect(getShipment(session(), "TAKI100001")).rejects.toMatchObject({ code: "not_found" });
    await expect(getShipment(session(), "TAKI100002")).rejects.toMatchObject({ code: "not_found" });
    await expect(getShipment(session(), "TAKI999999")).rejects.toMatchObject({ code: "not_found" });
  });

  it("redacts contacts once a confirmed booking is cancelled", async () => {
    addBooking(store, bookingDoc("TAKI100001", "cancelled"));
    const v = await getShipment(session(), "TAKI100001");
    expect(v.customer.phone).toBeNull();
    expect(v.receiver.phone).toBeNull();
    expect(v.pickupAddress).toBeNull();
    expect(v.description).toBeNull();
    expect(v.cancellation).toMatchObject({ reason: "pickup_refused" });
    expect(v.allowedActions).toEqual([]);
  });
});

describe("driver shipments — actions", () => {
  it("confirms pickup through core and returns the refreshed view", async () => {
    addBooking(store, bookingDoc("TAKI100001", "confirmed"));
    const v = await confirmPickup(session(), "TAKI100001", { otp: "123456", remarks: "2 boxes" }, NOW);
    expect(v.status).toBe("picked_up");
    expect(v.events.at(-1)).toMatchObject({ type: "picked_up", remarks: "2 boxes" });
    expect(core.calls[0]).toEqual({ fn: "pickup", args: ["TAKI100001", "123456", "2 boxes"] });
  });

  it("passes core OTP errors through unchanged (with attemptsLeft)", async () => {
    addBooking(store, bookingDoc("TAKI100001", "confirmed"));
    const err = await confirmPickup(session(), "TAKI100001", { otp: "000000" }, NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({ code: "otp_invalid", details: { attemptsLeft: 4 } });
  });

  it("never calls core for a booking the driver cannot see", async () => {
    addBooking(store, bookingDoc("TAKI100001", "confirmed", { driverId: OTHER_DRIVER_ID }));
    await expect(confirmPickup(session(), "TAKI100001", { otp: "123456" }, NOW)).rejects.toMatchObject({ code: "not_found" });
    await expect(refusePickup(session(), "TAKI100001", "Prohibited goods", NOW)).rejects.toMatchObject({ code: "not_found" });
    expect(core.calls).toEqual([]);
  });

  it("moves picked_up → in_transit → out_for_delivery and records remarks", async () => {
    addBooking(store, bookingDoc("TAKI100001", "picked_up"));
    expect((await startTransit(session(), "TAKI100001", {}, NOW)).status).toBe("in_transit");
    const v = await outForDelivery(session(), "TAKI100001", {}, NOW);
    expect(v.status).toBe("out_for_delivery");
    expect(v.allowedActions).toEqual(["deliver", "remark"]);
    const ev = await addRemark(session(), "TAKI100001", "Receiver asked to call on arrival", NOW);
    expect(ev).toMatchObject({ type: "remark", remarks: "Receiver asked to call on arrival" });
  });

  it("refuse pickup leaves a redacted record", async () => {
    addBooking(store, bookingDoc("TAKI100001", "confirmed"));
    const v = await refusePickup(session(), "TAKI100001", "Prohibited goods", NOW);
    expect(v.status).toBe("cancelled");
    expect(v.customer.phone).toBeNull();
  });
});

describe("driver shipments — delivery with proof", () => {
  function deliverForm(over: Record<string, string> = {}, photos: File[] = [jpeg()]): FormData {
    const f = new FormData();
    f.set("otp", over.otp ?? "654321");
    if (over.receivedBy) f.set("receivedBy", over.receivedBy);
    if (over.remarks) f.set("remarks", over.remarks);
    for (const p of photos) f.append("proof", p);
    return f;
  }

  it("uploads proof photos, then delivers with their file ids", async () => {
    addBooking(store, bookingDoc("TAKI100001", "out_for_delivery"));
    const v = await confirmDelivery(session(), "TAKI100001", deliverForm({ receivedBy: "Meena", remarks: "Left at shop" }, [jpeg("a.jpg"), jpeg("b.jpg")]), NOW);
    expect(v.status).toBe("delivered");
    expect(v.delivery?.proofUrls).toHaveLength(2);
    expect(v.delivery?.remarks).toBe("Received by Meena. Left at shop");
    const call = core.calls.find((c) => c.fn === "deliver")!.args[1] as { proofFileIds: string[] };
    const docs = await store.getMany<FileDoc>("files", call.proofFileIds);
    expect(docs.every((d) => d?.kind === "delivery_proof" && d.ownerType === "booking" && d.ownerId === "TAKI100001" && d.status === "active")).toBe(true);
    expect(files.files.size).toBe(2);
  });

  it("requires at least one photo and at most three", async () => {
    addBooking(store, bookingDoc("TAKI100001", "out_for_delivery"));
    await expect(confirmDelivery(session(), "TAKI100001", deliverForm({}, []), NOW)).rejects.toMatchObject({ code: "proof_required" });
    await expect(confirmDelivery(session(), "TAKI100001", deliverForm({}, [jpeg(), jpeg(), jpeg(), jpeg()]), NOW)).rejects.toMatchObject({ code: "invalid_request" });
    expect(files.files.size).toBe(0);
  });

  it("rejects non-image proof by magic bytes", async () => {
    addBooking(store, bookingDoc("TAKI100001", "out_for_delivery"));
    const fake = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], "x.jpg", { type: "image/jpeg" });
    await expect(confirmDelivery(session(), "TAKI100001", deliverForm({}, [fake]), NOW)).rejects.toMatchObject({ code: "file_invalid" });
  });

  it("discards uploaded proofs when the OTP is wrong", async () => {
    addBooking(store, bookingDoc("TAKI100001", "out_for_delivery"));
    await expect(confirmDelivery(session(), "TAKI100001", deliverForm({ otp: "111111" }), NOW)).rejects.toMatchObject({ code: "otp_invalid" });
    const all = await store.query<FileDoc>("files", {});
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("deleted");
    expect(files.files.size).toBe(0);
    expect((await store.get<BookingDoc>("bookings", "TAKI100001"))!.status).toBe("out_for_delivery");
  });

  it("is idempotent: a retry after success uploads nothing and returns the delivered view", async () => {
    addBooking(store, bookingDoc("TAKI100001", "out_for_delivery"));
    await confirmDelivery(session(), "TAKI100001", deliverForm(), NOW);
    const before = files.files.size;
    const again = await confirmDelivery(session(), "TAKI100001", deliverForm(), NOW);
    expect(again.status).toBe("delivered");
    expect(files.files.size).toBe(before);
    expect(core.calls.filter((c) => c.fn === "deliver")).toHaveLength(1);
  });

  it("refuses delivery before out-for-delivery without uploading", async () => {
    addBooking(store, bookingDoc("TAKI100001", "in_transit"));
    await expect(confirmDelivery(session(), "TAKI100001", deliverForm(), NOW)).rejects.toMatchObject({ code: "invalid_transition" });
    expect(files.files.size).toBe(0);
  });

  it("validates the OTP format before uploading", async () => {
    addBooking(store, bookingDoc("TAKI100001", "out_for_delivery"));
    await expect(confirmDelivery(session(), "TAKI100001", deliverForm({ otp: "12" }), NOW)).rejects.toThrow();
    expect(files.files.size).toBe(0);
  });

  it("builds delivery remarks", () => {
    expect(deliveryRemarks("Meena", "ok")).toBe("Received by Meena. ok");
    expect(deliveryRemarks(undefined, undefined)).toBeUndefined();
    expect(deliveryRemarks("  ", "")).toBeUndefined();
  });
});
