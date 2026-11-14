import "server-only";
/**
 * Fail fast when the Firestore emulator isn't running.
 *
 * Without this, firebase-admin keeps retrying an unreachable FIRESTORE_EMULATOR_HOST and every
 * API call (login, search…) hangs for tens of seconds with a spinner. A 1 s TCP probe turns that
 * into an immediate 503 `database_unavailable` with a clear hint. Successful probes are cached for
 * a few seconds, so the cost is one local TCP connect every 5 s at most. Production (real Firestore,
 * no emulator host) and vitest with an injected store skip the probe entirely.
 */
import { connect } from "node:net";
import { DomainError } from "@/lib/api/contracts/errors";
import { isProduction } from "../env";
import { docStoreKind } from "./index";

const OK_TTL_MS = 5_000;
const PROBE_TIMEOUT_MS = 1_000;
let lastOkAt = 0;
let inFlight: Promise<boolean> | null = null;

function probe(hostPort: string): Promise<boolean> {
  const i = hostPort.lastIndexOf(":");
  const host = (i > 0 ? hostPort.slice(0, i) : hostPort).replace(/^\[|\]$/g, "") || "127.0.0.1";
  const port = Number(i > 0 ? hostPort.slice(i + 1) : 8080);
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), PROBE_TIMEOUT_MS);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** Throws DomainError("database_unavailable") when the configured Firestore emulator is unreachable. */
export async function ensureDatabaseReachable(now = Date.now()): Promise<void> {
  if (docStoreKind() !== "firestore-emulator") return;
  if (now - lastOkAt < OK_TTL_MS) return;
  const hostPort = process.env.FIRESTORE_EMULATOR_HOST!.trim();
  inFlight ??= probe(hostPort).finally(() => {
    inFlight = null;
  });
  if (await inFlight) {
    lastOkAt = Date.now();
    return;
  }
  throw new DomainError(
    "database_unavailable",
    isProduction()
      ? undefined
      : `The local database isn't running (nothing on ${hostPort}). Start it with "npm run emulators", then load demo data with "npm run seed -- --reset".`,
  );
}

/** Vitest only. */
export function resetDatabaseProbeForTests(): void {
  lastOkAt = 0;
  inFlight = null;
}
