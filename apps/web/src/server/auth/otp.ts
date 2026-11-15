import "server-only";
import { DomainError } from "@/lib/api/contracts/errors";
import type { OtpChallengeDTO, OtpVerifyResultDTO } from "@/lib/api/contracts/auth";
import { OTP } from "@/lib/domain/constants";
import { newId } from "@/lib/domain/ids";
import type { Id, Mobile, Role } from "@/lib/domain/model";
import { C, getDocStore, type TxContext } from "@/server/db";
import type { DriverInviteDoc, OtpChallengeDoc } from "@/server/db/schema";
import { deriveKey, hmac, randomOtpCode, randomToken, safeEqual, sha256 } from "./crypto";
import { findUserByPhone } from "./accounts";
import { AUTH_LIMITS, hitRateLimits } from "./rate-limits";
import { getSmsProvider, type OtpPurpose } from "./sms";
import { devFixedOtps } from "@/server/env";

/** A fresh code, or the fixed local-testing code when DEV_FIXED_OTPS is on (never in production). */
const issueCode = (): string => devFixedOtps()?.phone ?? randomOtpCode();

/*
 * Server OTP (P2 §3.4): 6-digit code, only its HMAC stored; 5-minute expiry; 5 attempts per challenge
 * (cumulative across resends); 30 s resend cooldown, max 3 resends; per-phone and per-IP rate limits.
 * A successful verify returns a one-time proof token (15 min) that signup / reset / phone-change consume.
 */

export const PROOF_TTL_MS = 15 * 60_000;

function codeHash(challengeId: string, code: string): string {
  return hmac(deriveKey("taki-otp-v1"), `${challengeId}:${code}`);
}

export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  return `+91 ••••• •${d.slice(-4)}`;
}

function toDTO(c: OtpChallengeDoc, devCode?: string): OtpChallengeDTO {
  return {
    challengeId: c.id,
    phoneMasked: maskPhone(c.phone),
    expiresAt: c.expiresAt,
    resendAvailableAt: c.resendAvailableAt,
    attemptsLeft: Math.max(0, OTP.maxAttempts - c.attempts),
    resendsLeft: Math.max(0, OTP.maxResends - c.resends),
    ...(devCode ? { devOtp: { code: devCode, label: "Dev OTP" as const } } : {}),
  };
}

async function deliver(c: OtpChallengeDoc, code: string): Promise<string | undefined> {
  try {
    const sms = getSmsProvider();
    const res = await sms.sendOtp({ to: c.phone, code, purpose: c.purpose, expiresInMinutes: Math.round(OTP.expirySeconds / 60) });
    return sms.name === "dev" ? res.devCode : undefined;
  } catch (e) {
    await getDocStore().runTransaction(async (tx) => {
      tx.update(C.otpChallenges, c.id, { dead: true, updatedAt: new Date().toISOString() });
    });
    throw e;
  }
}

export interface SendOtpInput {
  phone: Mobile;
  /** Requested role (signup), or the role tab used for recovery. */
  role: Role;
  purpose: OtpPurpose;
  /** change_phone: the signed-in user. */
  userId?: Id | null;
}

/**
 * Starts a challenge. signup / change_phone: the phone must be free (409 phone_taken, details.role).
 * reset_password: an unknown phone gets an identical-looking challenge that never verifies (no SMS).
 */
export async function sendOtp(input: SendOtpInput, now: Date, ip: string): Promise<OtpChallengeDTO> {
  const existing = await findUserByPhone(input.phone);
  if ((input.purpose === "signup" || input.purpose === "change_phone") && existing) {
    throw new DomainError("phone_taken", undefined, { details: { role: existing.role } });
  }
  await hitRateLimits(
    [AUTH_LIMITS.otpSendIp(ip), AUTH_LIMITS.otpSendPhoneHour(input.phone), AUTH_LIMITS.otpSendPhoneDay(input.phone)],
    now,
  );

  const decoy = input.purpose === "reset_password" && (!existing || existing.status !== "active");
  const id = newId("otp");
  const code = issueCode();
  const expires = new Date(now.getTime() + OTP.expirySeconds * 1000);
  const doc: OtpChallengeDoc = {
    id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    phone: input.phone,
    role: input.purpose === "reset_password" && existing ? existing.role : input.role,
    purpose: input.purpose,
    userId: input.purpose === "change_phone" ? (input.userId ?? null) : input.purpose === "reset_password" ? (existing?.id ?? null) : null,
    // A decoy stores the hash of a code nobody ever sees.
    codeHash: codeHash(id, decoy ? randomOtpCode() + "x" : code),
    expiresAt: expires.toISOString(),
    expiresAtTs: expires,
    resendAvailableAt: new Date(now.getTime() + OTP.resendCooldownSeconds * 1000).toISOString(),
    attempts: 0,
    resends: 0,
    verifiedAt: null,
    proofHash: null,
    proofExpiresAt: null,
    consumedAt: null,
    dead: false,
  };
  await getDocStore().runTransaction(async (tx) => tx.create(C.otpChallenges, id, doc));
  const devCode = decoy ? undefined : await deliver(doc, code);
  return toDTO(doc, devCode);
}

/** New code for the same challenge (old code stops working). Attempts carry over. */
export async function resendOtp(challengeId: string, now: Date, ip: string): Promise<OtpChallengeDTO> {
  const store = getDocStore();
  const current = await store.get<OtpChallengeDoc>(C.otpChallenges, challengeId);
  if (!current || current.dead || current.consumedAt || current.verifiedAt) throw new DomainError("otp_expired", "This code is no longer valid. Start again.");
  if (current.resends >= OTP.maxResends) throw new DomainError("too_many_resends", "You've requested too many codes. Start again in a few minutes.");
  const waitMs = Date.parse(current.resendAvailableAt) - now.getTime();
  if (waitMs > 0) {
    throw new DomainError("resend_cooldown", undefined, { details: { retryAfterSeconds: Math.ceil(waitMs / 1000) } });
  }
  await hitRateLimits([AUTH_LIMITS.otpSendIp(ip), AUTH_LIMITS.otpSendPhoneHour(current.phone), AUTH_LIMITS.otpSendPhoneDay(current.phone)], now);

  const decoy = current.purpose === "reset_password" && !current.userId;
  const code = issueCode();
  const expires = new Date(now.getTime() + OTP.expirySeconds * 1000);
  const updated = await store.runTransaction(async (tx) => {
    const c = await tx.get<OtpChallengeDoc>(C.otpChallenges, challengeId);
    if (!c || c.dead || c.verifiedAt || c.resends >= OTP.maxResends) throw new DomainError("otp_expired", "This code is no longer valid. Start again.");
    const next: OtpChallengeDoc = {
      ...c,
      codeHash: codeHash(c.id, decoy ? randomOtpCode() + "x" : code),
      expiresAt: expires.toISOString(),
      expiresAtTs: expires,
      resendAvailableAt: new Date(now.getTime() + OTP.resendCooldownSeconds * 1000).toISOString(),
      resends: c.resends + 1,
      updatedAt: now.toISOString(),
    };
    tx.set(C.otpChallenges, c.id, next);
    return next;
  });
  const devCode = decoy ? undefined : await deliver(updated, code);
  return toDTO(updated, devCode);
}

type VerifyOutcome =
  | { kind: "ok"; challenge: OtpChallengeDoc; proofToken: string }
  | { kind: "invalid"; attemptsLeft: number }
  | { kind: "too_many" }
  | { kind: "expired" };

/** Checks a code. Wrong codes are counted even though the call throws. */
export async function verifyOtp(challengeId: string, code: string, now: Date, ip: string): Promise<OtpVerifyResultDTO> {
  await hitRateLimits([AUTH_LIMITS.otpVerifyIp(ip)], now);
  const proofToken = randomToken(32);
  const outcome = await getDocStore().runTransaction<VerifyOutcome>(async (tx) => {
    const c = await tx.get<OtpChallengeDoc>(C.otpChallenges, challengeId);
    if (!c || c.consumedAt || c.verifiedAt) return { kind: "expired" };
    if (c.dead || c.attempts >= OTP.maxAttempts) return { kind: "too_many" };
    if (Date.parse(c.expiresAt) <= now.getTime()) return { kind: "expired" };
    if (!safeEqual(codeHash(c.id, code), c.codeHash)) {
      const attempts = c.attempts + 1;
      const dead = attempts >= OTP.maxAttempts;
      tx.update(C.otpChallenges, c.id, { attempts, dead, updatedAt: now.toISOString() });
      return dead ? { kind: "too_many" } : { kind: "invalid", attemptsLeft: OTP.maxAttempts - attempts };
    }
    const proofExpiresAt = new Date(now.getTime() + PROOF_TTL_MS).toISOString();
    const verified: OtpChallengeDoc = {
      ...c,
      verifiedAt: now.toISOString(),
      proofHash: sha256(proofToken),
      proofExpiresAt,
      updatedAt: now.toISOString(),
    };
    tx.set(C.otpChallenges, c.id, verified);
    return { kind: "ok", challenge: verified, proofToken };
  });

  switch (outcome.kind) {
    case "expired":
      throw new DomainError("otp_expired");
    case "too_many":
      throw new DomainError("too_many_attempts", "Too many incorrect attempts. Request a new code.", { details: { attemptsLeft: 0 } });
    case "invalid":
      throw new DomainError(
        "otp_invalid",
        `That code is incorrect. ${outcome.attemptsLeft} ${outcome.attemptsLeft === 1 ? "attempt" : "attempts"} left.`,
        { details: { attemptsLeft: outcome.attemptsLeft } },
      );
    case "ok": {
      const c = outcome.challenge;
      const result: OtpVerifyResultDTO = { proofToken: outcome.proofToken, expiresAt: c.proofExpiresAt! };
      if (c.purpose === "signup" && c.role === "driver") {
        const invite = await findPendingInvite(c.phone, now);
        if (invite) result.invite = { inviteId: invite.id, agencyName: invite.agencyName, fullName: invite.fullName };
      }
      return result;
    }
  }
}

export async function findPendingInvite(phone: Mobile, now: Date): Promise<DriverInviteDoc | null> {
  const invites = await getDocStore().query<DriverInviteDoc>(C.driverInvites, {
    where: [
      ["phone", "==", phone],
      ["status", "==", "pending"],
    ],
    limit: 5,
  });
  return invites.find((i) => Date.parse(i.expiresAt) > now.getTime()) ?? null;
}

/**
 * Inside a transaction (READ phase): loads the verified challenge for a proof token and checks purpose,
 * expiry and single use. Throws 410 proof_expired. Call `markProofConsumed` in the write phase.
 */
export async function readProof(tx: TxContext, proofToken: string, purpose: OtpPurpose, now: Date): Promise<OtpChallengeDoc> {
  const found = await tx.query<OtpChallengeDoc>(C.otpChallenges, { where: [["proofHash", "==", sha256(proofToken)]], limit: 1 });
  const c = found[0];
  if (!c || c.purpose !== purpose || !c.verifiedAt || c.consumedAt || c.dead || !c.proofExpiresAt || Date.parse(c.proofExpiresAt) <= now.getTime()) {
    throw new DomainError("proof_expired");
  }
  return c;
}

export function markProofConsumed(tx: TxContext, c: OtpChallengeDoc, now: Date): void {
  tx.update(C.otpChallenges, c.id, { consumedAt: now.toISOString(), updatedAt: now.toISOString() });
}
