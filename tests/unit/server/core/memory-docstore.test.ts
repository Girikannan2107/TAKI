import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/api/contracts/errors";
import { MemoryDocStore } from "../../../support/memory-docstore";

describe("MemoryDocStore", () => {
  it("queries with where/orderBy/startAfter and checks indexes", async () => {
    const s = new MemoryDocStore();
    for (let i = 0; i < 5; i++)
      s.put("bookings", `TAKI10000${i}`, { id: `TAKI10000${i}`, agencyId: "a", status: i % 2 ? "confirmed" : "awaiting_agency", createdAt: `2026-11-1${i}T00:00:00Z` });
    const q = { where: [["agencyId", "==", "a"]] as const, orderBy: [["createdAt", "desc"], ["__name__", "desc"]] as const, limit: 2 };
    const page1 = await s.query<{ id: string; createdAt: string }>("bookings", q);
    expect(page1.map((b) => b.id)).toEqual(["TAKI100004", "TAKI100003"]);
    const page2 = await s.query<{ id: string }>("bookings", { ...q, startAfter: [page1[1]!.createdAt, page1[1]!.id] });
    expect(page2.map((b) => b.id)).toEqual(["TAKI100002", "TAKI100001"]);
    expect(await s.count("bookings", { where: [["status", "==", "confirmed"]] })).toBe(2);
    await expect(s.query("bookings", { where: [["customerId", "==", "x"]], orderBy: [["status", "asc"]] })).rejects.toThrow(/missing_index/);
  });

  it("retries conflicting transactions and enforces reads before writes", async () => {
    const s = new MemoryDocStore();
    s.put("counters", "c", { id: "c", n: 0 });
    await Promise.all(
      Array.from({ length: 10 }, () =>
        s.runTransaction(
          async (tx) => {
            const c = await tx.get<{ n: number }>("counters", "c");
            tx.update("counters", "c", { n: c!.n + 1 });
          },
          { maxAttempts: 20 },
        ),
      ),
    );
    expect((await s.get<{ n: number }>("counters", "c"))!.n).toBe(10);
    expect(s.conflicts).toBeGreaterThan(0);
    await expect(
      s.runTransaction(async (tx) => {
        tx.set("x", "1", { id: "1" });
        await tx.get("x", "1");
      }),
    ).rejects.toThrow(/before the first write/);
  });

  it("fails create on existing docs and supports dotted updates/deletes", async () => {
    const s = new MemoryDocStore();
    s.put("trips", "t", { id: "t", holds: { TAKI100001: { kg: 1 } } });
    await expect(s.runTransaction(async (tx) => tx.create("trips", "t", { id: "t" }))).rejects.toBeInstanceOf(DomainError);
    await s.runTransaction(async (tx) => tx.update("trips", "t", { "holds.TAKI100002": { kg: 2 }, "holds.TAKI100001": undefined }));
    expect((await s.get<{ holds: object }>("trips", "t"))!.holds).toEqual({ TAKI100002: { kg: 2 } });
  });
});
