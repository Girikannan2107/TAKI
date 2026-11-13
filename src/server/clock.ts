import "server-only";
/**
 * Server clock. Everything that needs "now" receives it from here (via the handler
 * wrapper's `now`) so tests can pin time. The override only works under vitest.
 */

let testNow: Date | null = null;

export function now(): Date {
  if (testNow && process.env.VITEST === "true") return new Date(testNow.getTime());
  const fromEnv = process.env.VITEST === "true" ? process.env.TEST_CLOCK : undefined;
  if (fromEnv) return new Date(fromEnv);
  return new Date();
}

export function nowIso(): string {
  return now().toISOString();
}

/** Vitest only: pin the clock (pass null to release). */
export function setTestNow(d: Date | string | null): void {
  if (process.env.VITEST !== "true") throw new Error("setTestNow is only available under vitest");
  testNow = d === null ? null : new Date(d);
}
