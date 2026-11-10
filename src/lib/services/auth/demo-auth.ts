"use client";
/**
 * DEMO authentication adapter. No SMS is ever sent: a fresh random 6-digit code
 * is generated per request with crypto.getRandomValues and shown on screen in a
 * labelled demo banner. There is no fixed, master or bypass code.
 * Passwords are stored as salted SHA-256 in localStorage — demo only, never for production.
 */
import { LOGIN_LOCK, OTP, SESSION_TTL_DAYS } from "@/lib/domain/constants";
import { DomainError } from "@/lib/domain/db";
import { genId } from "@/lib/domain/ids";
import { toE164 } from "@/lib/domain/phone";
import type { OtpChallenge, Session, UserAccount } from "@/lib/domain/types";
import { useTakiStore } from "@/lib/store";
import { getNow } from "@/lib/utils/clock";
import type { AuthAdapter, CreateAccountInput, SendOtpInput, SendOtpResult, VerifyOtpResult } from "./types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function randomDigits(n: number): string {
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (x) => String(x % 10)).join("");
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(salt: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function findAccount(mobile: string): UserAccount | undefined {
  return Object.values(useTakiStore.getState().db.accounts).find((a) => a.mobile === mobile);
}

function newSession(account: UserAccount): Session {
  const now = getNow();
  return {
    accountId: account.id,
    role: account.role,
    profileId: account.profileId,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString(),
  };
}

function issueChallenge(base: { mobile: string; role: OtpChallenge["role"]; purpose: OtpChallenge["purpose"] }, resendCount: number): OtpChallenge {
  const now = getNow();
  return {
    id: genId("otp", Math.random),
    mobile: base.mobile,
    role: base.role,
    purpose: base.purpose,
    code: randomDigits(OTP.length),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OTP.expirySeconds * 1000).toISOString(),
    resendAvailableAt: new Date(now.getTime() + OTP.resendCooldownSeconds * 1000).toISOString(),
    attempts: 0,
    resendCount,
  };
}

function toResult(c: OtpChallenge): SendOtpResult {
  return { challengeId: c.id, expiresAt: c.expiresAt, resendAvailableAt: c.resendAvailableAt, demoCode: c.code };
}

export const demoAuthAdapter: AuthAdapter = {
  mode: "demo",

  async sendOtp({ mobile, flow, role, next }: SendOtpInput) {
    await delay(500);
    const e164 = toE164(mobile);
    if (!e164) throw new DomainError("invalid_mobile", "Enter a valid 10-digit Indian mobile number.");
    const account = findAccount(e164);
    if (flow === "signup") {
      if (!role) throw new DomainError("role_required", "Choose whether you're a customer or a driver first.");
      if (account) throw new DomainError("account_exists", "An account already exists for this number. Log in instead.");
    } else if (!account) {
      throw new DomainError("no_account", "No account found for this number. Create one instead.");
    }
    const challengeRole = flow === "signup" ? role! : account!.role;
    const challenge = issueChallenge({ mobile: e164, role: challengeRole, purpose: flow === "reset" ? "reset_password" : "register" }, 0);
    const store = useTakiStore.getState();
    store.setOtp(challenge);
    store.setPendingAuth({ flow, role: challengeRole, mobile: e164, challengeId: challenge.id, verified: false, next });
    return toResult(challenge);
  },

  async resendOtp() {
    const { otp, pendingAuth } = useTakiStore.getState();
    if (!otp || !pendingAuth) throw new DomainError("no_challenge", "Start again by entering your mobile number.");
    if (Date.parse(otp.resendAvailableAt) > getNow().getTime()) throw new DomainError("resend_cooldown", "Please wait before requesting a new code.");
    if (otp.resendCount >= OTP.maxResends) throw new DomainError("too_many_resends", "Too many codes requested. Start again in a few minutes.");
    await delay(400);
    const challenge = issueChallenge({ mobile: otp.mobile, role: otp.role, purpose: otp.purpose }, otp.resendCount + 1);
    const store = useTakiStore.getState();
    store.setOtp(challenge);
    store.setPendingAuth({ ...pendingAuth, challengeId: challenge.id, verified: false });
    return toResult(challenge);
  },

  async verifyOtp(code: string): Promise<VerifyOtpResult> {
    await delay(500);
    const store = useTakiStore.getState();
    const { otp, pendingAuth } = store;
    if (!otp || !pendingAuth || pendingAuth.challengeId !== otp.id) return { ok: false, reason: "no_challenge" };
    if (otp.attempts >= OTP.maxAttempts) return { ok: false, reason: "too_many_attempts", attemptsLeft: 0 };
    if (Date.parse(otp.expiresAt) <= getNow().getTime()) return { ok: false, reason: "expired" };
    if (!/^\d{6}$/.test(code) || code !== otp.code) {
      const attempts = otp.attempts + 1;
      store.setOtp({ ...otp, attempts });
      const attemptsLeft = OTP.maxAttempts - attempts;
      return attemptsLeft <= 0 ? { ok: false, reason: "too_many_attempts", attemptsLeft: 0 } : { ok: false, reason: "invalid", attemptsLeft };
    }
    store.setOtp({ ...otp, verifiedAt: getNow().toISOString() });
    if (pendingAuth.flow === "login") {
      const account = findAccount(otp.mobile);
      if (!account) return { ok: false, reason: "no_challenge" };
      const session = newSession(account);
      store.setSession(session);
      store.setPendingAuth(null);
      store.setOtp(null);
      return { ok: true, flow: "login", session };
    }
    store.setPendingAuth({ ...pendingAuth, verified: true });
    return { ok: true, flow: pendingAuth.flow };
  },

  async createAccount({ fullName, password, businessName }: CreateAccountInput) {
    const { pendingAuth } = useTakiStore.getState();
    if (!pendingAuth?.verified || pendingAuth.flow !== "signup" || !pendingAuth.role)
      throw new DomainError("not_verified", "Verify your mobile number first.");
    if (findAccount(pendingAuth.mobile)) throw new DomainError("account_exists", "An account already exists for this number. Log in instead.");
    const salt = randomHex(16);
    const passwordHash = await hashPassword(salt, password);
    const role = pendingAuth.role;
    const name = fullName.trim().replace(/\s+/g, " ");
    const at = getNow().toISOString();
    const account = useTakiStore.getState().mutate((db, ctx) => {
      const profileId = genId(role === "customer" ? "cus" : "drv", ctx.rand);
      if (role === "customer") {
        db.customers[profileId] = { id: profileId, fullName: name, mobile: pendingAuth.mobile, createdAt: at };
      } else {
        db.drivers[profileId] = {
          id: profileId,
          fullName: name,
          businessName: businessName?.trim() || `${name.split(" ")[0]} Transport`,
          mobile: pendingAuth.mobile,
          isVerified: false,
          ratingAvg: 0,
          ratingCount: 0,
          defaultRatePerKmPaise: 1200,
          defaultRatePerKgPaise: 50,
          createdAt: at,
        };
      }
      const acc: UserAccount = { id: genId("usr", ctx.rand), role, mobile: pendingAuth.mobile, profileId, passwordHash, passwordSalt: salt, failedLoginCount: 0, createdAt: at };
      db.accounts[acc.id] = acc;
      return acc;
    });
    const session = newSession(account);
    const store = useTakiStore.getState();
    store.setSession(session);
    store.setPendingAuth(null);
    store.setOtp(null);
    return session;
  },

  async resetPassword(password: string) {
    const { pendingAuth } = useTakiStore.getState();
    if (!pendingAuth?.verified || pendingAuth.flow !== "reset") throw new DomainError("not_verified", "Verify your mobile number first.");
    const account = findAccount(pendingAuth.mobile);
    if (!account) throw new DomainError("no_account", "No account found for this number.");
    const salt = randomHex(16);
    const passwordHash = await hashPassword(salt, password);
    useTakiStore.getState().mutate((db) => {
      db.accounts[account.id] = { ...db.accounts[account.id]!, passwordHash, passwordSalt: salt, failedLoginCount: 0, lockedUntil: undefined };
    });
    const store = useTakiStore.getState();
    store.setPendingAuth(null);
    store.setOtp(null);
  },

  async login({ mobile, password }) {
    await delay(500);
    const e164 = toE164(mobile);
    const invalid = new DomainError("invalid_credentials", "Mobile number or password is incorrect.");
    if (!e164) throw invalid;
    const account = findAccount(e164);
    if (!account) throw invalid;
    const now = getNow();
    if (account.lockedUntil && Date.parse(account.lockedUntil) > now.getTime())
      throw new DomainError("locked", "Too many attempts. Try again in a few minutes or log in with OTP.");
    const hash = await hashPassword(account.passwordSalt, password);
    if (hash !== account.passwordHash) {
      useTakiStore.getState().mutate((db) => {
        const a = db.accounts[account.id]!;
        const failed = a.failedLoginCount + 1;
        db.accounts[account.id] = {
          ...a,
          failedLoginCount: failed >= LOGIN_LOCK.maxFailures ? 0 : failed,
          ...(failed >= LOGIN_LOCK.maxFailures ? { lockedUntil: new Date(now.getTime() + LOGIN_LOCK.lockMinutes * 60_000).toISOString() } : {}),
        };
      });
      throw invalid;
    }
    useTakiStore.getState().mutate((db) => {
      db.accounts[account.id] = { ...db.accounts[account.id]!, failedLoginCount: 0, lockedUntil: undefined };
    });
    const session = newSession(account);
    useTakiStore.getState().setSession(session);
    return session;
  },

  async logout() {
    useTakiStore.getState().logout();
  },
};
