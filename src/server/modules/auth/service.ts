import "server-only";
import { z } from "zod";
import {
  AgencySignupBody,
  CustomerSignupBody,
  DriverSignupBody,
  LoginBody,
  ResetPasswordBody,
  type SessionUserDTO,
} from "@/lib/api/contracts/auth";
import { DomainError } from "@/lib/api/contracts/errors";
import { LOGIN_LOCK } from "@/lib/domain/constants";
import { newId } from "@/lib/domain/ids";
import type { PublicRole } from "@/lib/domain/model";
import { getDistrict } from "@/lib/domain/places/districts";
import { findUserByPhone, phoneIndexKey } from "@/server/auth/accounts";
import { readProof, markProofConsumed } from "@/server/auth/otp";
import { hashPassword, passwordProblem, verifyPassword } from "@/server/auth/passwords";
import { AUTH_LIMITS, hitRateLimits } from "@/server/auth/rate-limits";
import { issueSession, revokeSession, revokeUserSessions, type SessionMeta } from "@/server/auth/sessions";
import type { SessionContext } from "@/server/auth/guards";
import { C, getDocStore, type TxContext } from "@/server/db";
import type {
  AgencyDoc,
  CustomerDoc,
  DriverDoc,
  DriverInviteDoc,
  OtpChallengeDoc,
  PhoneIndexDoc,
  UserDoc,
  VerificationState,
} from "@/server/db/schema";
import { devAutoVerifyAgencies } from "@/server/env";
import { buildSessionUser } from "./session-user";

export interface AuthResult {
  user: SessionUserDTO;
  /** Set-Cookie header for the new session. */
  setCookie: string;
}

type CustomerSignup = z.output<typeof CustomerSignupBody>;
type AgencySignup = z.output<typeof AgencySignupBody>;
type DriverSignup = z.output<typeof DriverSignupBody>;
type Login = z.output<typeof LoginBody>;
type ResetPassword = z.output<typeof ResetPasswordBody>;

function policyError(problem: string): DomainError {
  return new DomainError("invalid_request", problem, { fields: { password: problem } });
}

function newUser(id: string, role: UserDoc["role"], c: OtpChallengeDoc, passwordHash: string, displayName: string, now: Date, agencyId: string | null): UserDoc {
  const at = now.toISOString();
  return {
    id,
    createdAt: at,
    updatedAt: at,
    role,
    phone: c.phone,
    phoneVerifiedAt: c.verifiedAt ?? at,
    passwordHash,
    passwordChangedAt: at,
    status: "active",
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: at,
    agencyId,
    displayName,
  };
}

function pendingVerification(): VerificationState {
  return { status: "pending", submittedAt: null as unknown as string, reviewedAt: null, reviewedBy: null, reason: null };
}

/** Lowercase word prefixes (≥ 2 chars) for agency name search. */
export function searchTokensFor(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const w of t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
      for (let i = 2; i <= Math.min(w.length, 15); i++) out.add(w.slice(0, i));
    }
  }
  return [...out].slice(0, 60);
}

/**
 * READ phase shared by every signup: proof (purpose signup + role), phone still free, password policy.
 * Returns the challenge. Must run before any write in `tx`.
 */
async function readSignupPreconditions(tx: TxContext, role: PublicRole, proofToken: string, password: string, now: Date): Promise<OtpChallengeDoc> {
  const challenge = await readProof(tx, proofToken, "signup", now);
  if (challenge.role !== role) throw new DomainError("proof_expired", "Verification was for a different account type. Please verify your phone again.");
  const taken = await tx.get<PhoneIndexDoc>(C.phoneIndex, phoneIndexKey(challenge.phone));
  if (taken) throw new DomainError("phone_taken", undefined, { details: { role: taken.role } });
  const problem = passwordProblem(password, challenge.phone);
  if (problem) throw policyError(problem);
  return challenge;
}

function writeAccount(tx: TxContext, user: UserDoc, challenge: OtpChallengeDoc, now: Date): void {
  tx.create(C.users, user.id, user);
  tx.create<PhoneIndexDoc>(C.phoneIndex, phoneIndexKey(user.phone), { id: phoneIndexKey(user.phone), userId: user.id, role: user.role, createdAt: now.toISOString() });
  markProofConsumed(tx, challenge, now);
}

async function finish(user: UserDoc, setCookie: string): Promise<AuthResult> {
  return { user: await buildSessionUser(user), setCookie };
}

// ── Signup ────────────────────────────────────────────────────────────────────
export async function signupCustomer(body: CustomerSignup, now: Date, meta: SessionMeta): Promise<AuthResult> {
  const passwordHash = await hashPassword(body.password);
  const userId = newId("usr");
  const { user, setCookie } = await getDocStore().runTransaction(async (tx) => {
    const challenge = await readSignupPreconditions(tx, "customer", body.proofToken, body.password, now);
    const user = newUser(userId, "customer", challenge, passwordHash, body.fullName, now, null);
    const at = now.toISOString();
    writeAccount(tx, user, challenge, now);
    tx.create<CustomerDoc>(C.customers, userId, {
      id: userId,
      createdAt: at,
      updatedAt: at,
      fullName: body.fullName,
      dob: body.dob,
      phone: challenge.phone,
      photo: null,
      stats: { bookings: 0, delivered: 0 },
    });
    const s = await issueSession(user, now, meta, tx);
    return { user, setCookie: s.setCookie };
  });
  return finish(user, setCookie);
}

export async function signupAgency(body: AgencySignup, now: Date, meta: SessionMeta): Promise<AuthResult> {
  const district = getDistrict(body.districtId);
  if (!district) throw new DomainError("invalid_request", "Choose a district from the list", { fields: { districtId: "Choose a district from the list" } });
  const passwordHash = await hashPassword(body.password);
  const userId = newId("usr");
  const agencyId = newId("agc");
  const autoVerify = devAutoVerifyAgencies();
  const { user, setCookie } = await getDocStore().runTransaction(async (tx) => {
    const challenge = await readSignupPreconditions(tx, "agency", body.proofToken, body.password, now);
    const user = newUser(userId, "agency", challenge, passwordHash, body.ownerName, now, agencyId);
    const at = now.toISOString();
    writeAccount(tx, user, challenge, now);
    const statesCovered = [...new Set([district.state, ...body.statesCovered])];
    const verification: VerificationState = autoVerify
      ? { status: "verified", submittedAt: at, reviewedAt: at, reviewedBy: "dev-auto", reason: null }
      : pendingVerification();
    tx.create<AgencyDoc>(C.agencies, agencyId, {
      id: agencyId,
      createdAt: at,
      updatedAt: at,
      ownerUserId: userId,
      ownerName: body.ownerName,
      agencyName: body.agencyName,
      nameLower: body.agencyName.toLowerCase(),
      searchTokens: searchTokensFor(body.agencyName, district.name),
      districtId: district.id,
      state: district.state,
      statesCovered,
      vehicleCountRange: body.vehicleCountRange,
      phone: challenge.phone,
      photo: null,
      identityDocument: null as unknown as AgencyDoc["identityDocument"],
      verification,
      stats: { vehicles: 0, drivers: 0, ratingAvg: 0, ratingCount: 0, delivered: 0 },
    });
    const s = await issueSession(user, now, meta, tx);
    return { user, setCookie: s.setCookie };
  });
  return finish(user, setCookie);
}

export async function signupDriver(body: DriverSignup, now: Date, meta: SessionMeta): Promise<AuthResult> {
  const passwordHash = await hashPassword(body.password);
  const userId = newId("usr");
  const { user, setCookie } = await getDocStore().runTransaction(async (tx) => {
    const challenge = await readSignupPreconditions(tx, "driver", body.proofToken, body.password, now);
    const at = now.toISOString();
    let link: DriverDoc["agencyLink"];
    let invite: DriverInviteDoc | null = null;
    let agency: AgencyDoc | null = null;
    if (body.inviteId) {
      invite = await tx.get<DriverInviteDoc>(C.driverInvites, body.inviteId);
      if (!invite || invite.status !== "pending" || invite.phone !== challenge.phone || Date.parse(invite.expiresAt) <= now.getTime()) {
        throw new DomainError("not_found", "This invite is no longer valid. Choose your agency from the list instead.", {
          fields: { inviteId: "This invite is no longer valid" },
        });
      }
      agency = await tx.get<AgencyDoc>(C.agencies, invite.agencyId);
      if (!agency) throw new DomainError("not_found", "This invite is no longer valid.");
      link = { agencyId: agency.id, agencyName: agency.agencyName, status: "active", via: "invite", requestedAt: at, decidedAt: at };
    } else {
      agency = await tx.get<AgencyDoc>(C.agencies, body.agencyId!);
      if (!agency || agency.verification.status !== "verified") {
        throw new DomainError("not_found", "Choose a verified agency from the list.", { fields: { agencyId: "Choose a verified agency from the list" } });
      }
      link = { agencyId: agency.id, agencyName: agency.agencyName, status: "pending", via: "request", requestedAt: at, decidedAt: null };
    }
    // ── writes ──
    const user = newUser(userId, "driver", challenge, passwordHash, body.fullName, now, null);
    writeAccount(tx, user, challenge, now);
    tx.create<DriverDoc>(C.drivers, userId, {
      id: userId,
      createdAt: at,
      updatedAt: at,
      fullName: body.fullName,
      phone: challenge.phone,
      photo: null as unknown as DriverDoc["photo"],
      license: null as unknown as DriverDoc["license"],
      aadhaar: null as unknown as DriverDoc["aadhaar"],
      agencyLink: link,
      availability: "available",
      verification: pendingVerification(),
      stats: { ratingAvg: 0, ratingCount: 0, delivered: 0 },
    });
    if (invite) {
      tx.update(C.driverInvites, invite.id, { status: "accepted", driverId: userId, updatedAt: at });
      tx.update(C.agencies, agency.id, { "stats.drivers": agency.stats.drivers + 1, updatedAt: at });
    }
    const s = await issueSession(user, now, meta, tx);
    return { user, setCookie: s.setCookie };
  });
  return finish(user, setCookie);
}

// ── Login / logout ───────────────────────────────────────────────────────────
export async function login(body: Login, now: Date, meta: SessionMeta & { ip: string }): Promise<AuthResult> {
  await hitRateLimits([AUTH_LIMITS.loginIp(meta.ip)], now);
  const user = await findUserByPhone(body.phone);
  if (user?.lockedUntil && Date.parse(user.lockedUntil) > now.getTime()) {
    throw new DomainError("account_locked", "Too many failed attempts. Try again in 15 minutes or reset your password.", {
      details: { lockedUntil: user.lockedUntil },
    });
  }
  const { ok, needsRehash } = await verifyPassword(body.password, user?.passwordHash ?? null);
  if (!user || !ok) {
    if (user) await recordFailure(user.id, now);
    throw new DomainError("invalid_credentials");
  }
  if (user.status !== "active") throw new DomainError("account_disabled");
  if (user.role !== body.role) {
    // Only revealed after a correct password, so it doesn't help enumeration.
    // The hidden admin role is never named to a public login form.
    throw new DomainError("forbidden", wrongRoleMessage(user.role), user.role === "admin" ? {} : { details: { reason: "wrong_role", role: user.role } });
  }
  const freshHash = needsRehash ? await hashPassword(body.password) : null;
  const setCookie = await getDocStore().runTransaction(async (tx) => {
    const u = await tx.get<UserDoc>(C.users, user.id);
    if (!u) throw new DomainError("invalid_credentials");
    tx.update(C.users, u.id, {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ...(freshHash ? { passwordHash: freshHash } : {}),
    });
    return (await issueSession(u, now, meta, tx)).setCookie;
  });
  return finish(user, setCookie);
}

const ROLE_NOUN: Record<UserDoc["role"], string> = { customer: "Customer", agency: "Travel agency", driver: "Driver", admin: "Admin" };

export function wrongRoleMessage(role: UserDoc["role"]): string {
  if (role === "admin") return "This number can't sign in here.";
  return `This number is registered as a ${ROLE_NOUN[role]} account. Switch to ${ROLE_NOUN[role]} login.`;
}

async function recordFailure(userId: string, now: Date): Promise<void> {
  await getDocStore().runTransaction(async (tx) => {
    const u = await tx.get<UserDoc>(C.users, userId);
    if (!u) return;
    const failures = u.failedLoginCount + 1;
    const lock = failures >= LOGIN_LOCK.maxFailures;
    tx.update(C.users, userId, {
      failedLoginCount: lock ? 0 : failures,
      lockedUntil: lock ? new Date(now.getTime() + LOGIN_LOCK.lockMinutes * 60_000).toISOString() : u.lockedUntil,
      updatedAt: now.toISOString(),
    });
  });
}

export async function logout(ctx: SessionContext, now: Date): Promise<void> {
  await revokeSession(ctx.sessionId, now);
}

// ── Password recovery ────────────────────────────────────────────────────────
/** Sets a new password from a reset proof and revokes every session of the account. */
export async function resetPassword(body: ResetPassword, now: Date): Promise<{ role: UserDoc["role"] }> {
  const passwordHash = await hashPassword(body.password);
  return getDocStore().runTransaction(async (tx) => {
    const challenge = await readProof(tx, body.proofToken, "reset_password", now);
    if (!challenge.userId) throw new DomainError("proof_expired");
    const user = await tx.get<UserDoc>(C.users, challenge.userId);
    if (!user || user.phone !== challenge.phone || user.status !== "active") throw new DomainError("proof_expired");
    const problem = passwordProblem(body.password, user.phone);
    if (problem) throw policyError(problem);
    await revokeUserSessions(user.id, now, { tx });
    tx.update(C.users, user.id, {
      passwordHash,
      passwordChangedAt: now.toISOString(),
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: now.toISOString(),
    });
    markProofConsumed(tx, challenge, now);
    return { role: user.role };
  });
}
