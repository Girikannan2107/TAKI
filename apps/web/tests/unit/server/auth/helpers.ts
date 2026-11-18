/** Auth test helpers (D1): fresh memory stores per test and one-call OTP → proof → signup flows. */
import { setDocStoreForTests } from "@/server/db";
import { setFileStoreForTests } from "@/server/files/filestore";
import { sendOtp, verifyOtp } from "@/server/auth/otp";
import { resolveSession } from "@/server/auth/sessions";
import { readCookie } from "@/server/auth/session-cookie";
import type { SessionContext } from "@/server/core/context";
import { signupAgency, signupCustomer, signupDriver } from "@/server/modules/auth/service";
import type { PublicRole } from "@/lib/domain/model";
import { DISTRICTS } from "@/lib/domain/places/districts";
import { verhoeffValid } from "@/server/modules/profile/document-numbers";
import { MemoryDocStore } from "../../../support/memory-docstore";
import { MemoryFileStore } from "../../../support/memory-filestore";

export const NOW = new Date("2026-11-20T04:30:00.000Z");
export const PASSWORD = "Sunrise2026";
export const IP = "203.0.113.7";

export function at(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

export function freshStores(): { store: MemoryDocStore; files: MemoryFileStore } {
  const store = new MemoryDocStore();
  const files = new MemoryFileStore();
  setDocStoreForTests(store);
  setFileStoreForTests(files);
  return { store, files };
}

export function clearStores(): void {
  setDocStoreForTests(null);
  setFileStoreForTests(null);
}

/** E.164 for a 10-digit national number. */
export function e164(n: string): string {
  return `+91${n}`;
}

/** Signup OTP: send → read the Dev OTP → verify. Returns the proof token. */
export async function signupProof(phone: string, role: PublicRole, now = NOW): Promise<{ proofToken: string; invite?: { inviteId: string } }> {
  const ch = await sendOtp({ phone: e164(phone), role, purpose: "signup" }, now, IP);
  if (!ch.devOtp) throw new Error("expected a Dev OTP in tests");
  return verifyOtp(ch.challengeId, ch.devOtp.code, now, IP);
}

/** Session from a Set-Cookie header (as the browser would send it back). */
export async function sessionFrom(setCookie: string, now = NOW): Promise<SessionContext | null> {
  const pair = setCookie.split(";")[0]!;
  return resolveSession(readCookie(pair), now);
}

export async function makeCustomer(phone = "9876500001") {
  const proof = await signupProof(phone, "customer");
  const r = await signupCustomer(
    { proofToken: proof.proofToken, fullName: "Asha Raman", dob: "1990-05-01", acceptTerms: true, password: PASSWORD, confirmPassword: PASSWORD },
    NOW,
    { ip: IP },
  );
  return { ...r, session: (await sessionFrom(r.setCookie))! };
}

export async function makeAgency(phone = "9876500002") {
  const proof = await signupProof(phone, "agency");
  const r = await signupAgency(
    {
      proofToken: proof.proofToken,
      ownerName: "Kumar Selvam",
      agencyName: "Selvam Travels",
      districtId: DISTRICT_ID,
      vehicleCountRange: "6-10",
      statesCovered: ["KL"],
      acceptTerms: true,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    },
    NOW,
    { ip: IP },
  );
  return { ...r, session: (await sessionFrom(r.setCookie))! };
}

export async function makeDriver(agencyId: string, phone = "9876500003") {
  const proof = await signupProof(phone, "driver");
  const r = await signupDriver(
    { proofToken: proof.proofToken, fullName: "Ravi Kumar", agencyId, acceptTerms: true, password: PASSWORD, confirmPassword: PASSWORD },
    NOW,
    { ip: IP },
  );
  return { ...r, session: (await sessionFrom(r.setCookie))! };
}

/** A real district id from the places dataset (first Tamil Nadu district). */
export const DISTRICT_ID = DISTRICTS.find((d) => d.state === "TN")!.id;

/** Smallest valid JPEG / PDF headers (the upload layer sniffs magic bytes). */
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
export const PDF = new TextEncoder().encode("%PDF-1.4\n%test\n");

export function fileOf(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes as BlobPart], name, { type });
}

/** A Verhoeff-valid Aadhaar test number (check digit computed, not hard-coded). */
export const AADHAAR = (() => {
  const base = "23412341234";
  for (let d = 0; d <= 9; d++) if (verhoeffValid(base + d)) return base + d;
  throw new Error("no check digit");
})();
