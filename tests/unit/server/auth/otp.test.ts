import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DomainError } from "@/lib/api/contracts/errors";
import { C } from "@/server/db";
import { resetEnvCache } from "@/server/env";
import type { OtpChallengeDoc } from "@/server/db/schema";
import { readProof, resendOtp, sendOtp, verifyOtp } from "@/server/auth/otp";
import { IP, NOW, at, clearStores, e164, freshStores, makeCustomer } from "./helpers";
import type { MemoryDocStore } from "../../../support/memory-docstore";

let store: MemoryDocStore;
beforeEach(() => {
  store = freshStores().store;
});
afterEach(clearStores);

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return "ok";
}

describe("OTP", () => {
  it("stores only a hash, shows a Dev OTP, and issues a one-time proof", async () => {
    const ch = await sendOtp({ phone: e164("9876511111"), role: "customer", purpose: "signup" }, NOW, IP);
    expect(ch.devOtp?.label).toBe("Dev OTP");
    expect(ch.devOtp?.code).toMatch(/^\d{6}$/);
    expect(ch.phoneMasked).toBe("+91 ••••• •1111");
    const doc = (await store.get<OtpChallengeDoc>(C.otpChallenges, ch.challengeId))!;
    expect(JSON.stringify(doc)).not.toContain(`"${ch.devOtp!.code}"`);
    expect(doc.expiresAt).toBe(at(5 * 60_000).toISOString());

    const proof = await verifyOtp(ch.challengeId, ch.devOtp!.code, at(1000), IP);
    expect(proof.proofToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The same code cannot be verified twice.
    expect(await code(verifyOtp(ch.challengeId, ch.devOtp!.code, at(2000), IP))).toBe("otp_expired");
    // The proof is bound to its purpose.
    await expect(store.runTransaction((tx) => readProof(tx, proof.proofToken, "reset_password", at(3000)))).rejects.toMatchObject({ code: "proof_expired" });
    const ok = await store.runTransaction((tx) => readProof(tx, proof.proofToken, "signup", at(3000)));
    expect(ok.id).toBe(ch.challengeId);
  });

  it("counts wrong codes and locks the challenge after 5 attempts", async () => {
    const ch = await sendOtp({ phone: e164("9876511112"), role: "customer", purpose: "signup" }, NOW, IP);
    const wrong = ch.devOtp!.code === "000000" ? "111111" : "000000";
    for (let i = 4; i >= 1; i--) {
      await expect(verifyOtp(ch.challengeId, wrong, NOW, IP)).rejects.toMatchObject({ code: "otp_invalid", details: { attemptsLeft: i } });
    }
    expect(await code(verifyOtp(ch.challengeId, wrong, NOW, IP))).toBe("too_many_attempts");
    // Even the right code no longer works.
    expect(await code(verifyOtp(ch.challengeId, ch.devOtp!.code, NOW, IP))).toBe("too_many_attempts");
  });

  it("expires codes after 5 minutes", async () => {
    const ch = await sendOtp({ phone: e164("9876511113"), role: "agency", purpose: "signup" }, NOW, IP);
    expect(await code(verifyOtp(ch.challengeId, ch.devOtp!.code, at(5 * 60_000 + 1), IP))).toBe("otp_expired");
  });

  it("enforces the resend cooldown and the resend cap; a resend replaces the code", async () => {
    const ch = await sendOtp({ phone: e164("9876511114"), role: "driver", purpose: "signup" }, NOW, IP);
    await expect(resendOtp(ch.challengeId, at(10_000), IP)).rejects.toMatchObject({ code: "resend_cooldown" });
    let current = ch;
    for (let i = 1; i <= 3; i++) {
      current = await resendOtp(ch.challengeId, at(i * 31_000), IP);
      expect(current.resendsLeft).toBe(3 - i);
    }
    expect(await code(resendOtp(ch.challengeId, at(200_000), IP))).toBe("too_many_resends");
    if (ch.devOtp!.code !== current.devOtp!.code) {
      expect(await code(verifyOtp(ch.challengeId, ch.devOtp!.code, at(200_000), IP))).toBe("otp_invalid");
    }
    expect((await verifyOtp(ch.challengeId, current.devOtp!.code, at(200_000), IP)).proofToken).toBeTruthy();
  });

  it("rate-limits sends per phone", async () => {
    const phone = e164("9876511115");
    for (let i = 0; i < 5; i++) await sendOtp({ phone, role: "customer", purpose: "signup" }, at(i), IP);
    expect(await code(sendOtp({ phone, role: "customer", purpose: "signup" }, at(10), IP))).toBe("rate_limited");
  });

  it("rate-limits sends per IP, except in the Playwright build (TAKI_E2E) where only per-phone limits apply", async () => {
    const send = (n: number, t: number) => sendOtp({ phone: e164(`98765${String(20000 + n)}`), role: "customer", purpose: "signup" }, at(t), IP);
    for (let i = 0; i < 20; i++) await send(i, i);
    expect(await code(send(20, 30))).toBe("rate_limited");

    process.env.TAKI_E2E = "1";
    resetEnvCache();
    try {
      expect(await code(send(21, 40))).toBe("ok");
      const phone = e164("9876511116");
      for (let i = 0; i < 5; i++) await sendOtp({ phone, role: "customer", purpose: "signup" }, at(50 + i), IP);
      expect(await code(sendOtp({ phone, role: "customer", purpose: "signup" }, at(60), IP))).toBe("rate_limited");
    } finally {
      delete process.env.TAKI_E2E;
      resetEnvCache();
    }
  });

  it("refuses signup for a registered phone, and sends a silent decoy for recovery of an unknown phone", async () => {
    await makeCustomer("9876511116");
    await expect(sendOtp({ phone: e164("9876511116"), role: "agency", purpose: "signup" }, NOW, IP)).rejects.toMatchObject({
      code: "phone_taken",
      details: { role: "customer" },
    });
    const decoy = await sendOtp({ phone: e164("9876511117"), role: "customer", purpose: "reset_password" }, NOW, IP);
    expect(decoy.devOtp).toBeUndefined();
    expect(decoy.challengeId).toMatch(/^otp_/);
    const real = await sendOtp({ phone: e164("9876511116"), role: "customer", purpose: "reset_password" }, NOW, IP);
    expect(real.devOtp?.code).toMatch(/^\d{6}$/);
  });
});
