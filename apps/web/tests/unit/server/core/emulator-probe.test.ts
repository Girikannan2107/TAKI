import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { setDocStoreForTests } from "@/server/db";
import { ensureDatabaseReachable, resetDatabaseProbeForTests } from "@/server/db/emulator-probe";

/** Fail fast (503) instead of hanging when FIRESTORE_EMULATOR_HOST points at nothing. */
describe("ensureDatabaseReachable", () => {
  const saved = process.env.FIRESTORE_EMULATOR_HOST;
  let server: Server | null = null;
  afterEach(async () => {
    if (saved === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = saved;
    resetDatabaseProbeForTests();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  async function freePort(): Promise<number> {
    const s = createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    const port = (s.address() as { port: number }).port;
    await new Promise<void>((r) => s.close(() => r()));
    return port;
  }

  it("throws database_unavailable quickly when nothing listens on the emulator port", async () => {
    setDocStoreForTests(null);
    process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${await freePort()}`;
    const started = Date.now();
    await expect(ensureDatabaseReachable()).rejects.toMatchObject({ code: "database_unavailable" });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("passes when the emulator port accepts connections", async () => {
    setDocStoreForTests(null);
    server = createServer((sock) => sock.end());
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${(server.address() as { port: number }).port}`;
    await expect(ensureDatabaseReachable()).resolves.toBeUndefined();
  });

  it("is skipped without an emulator host (production Firestore)", async () => {
    setDocStoreForTests(null);
    delete process.env.FIRESTORE_EMULATOR_HOST;
    await expect(ensureDatabaseReachable()).resolves.toBeUndefined();
  });
});
