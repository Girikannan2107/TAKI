import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CustomerSignupBody, isAdult, maxDobFor } from "@/lib/api/contracts/auth";
import { C } from "@/server/db";
import type { AgencyDoc, CustomerDoc, DriverDoc, DriverInviteDoc, PhoneIndexDoc, UserDoc } from "@/server/db/schema";
import { sendOtp, verifyOtp } from "@/server/auth/otp";
import { resolveSession } from "@/server/auth/sessions";
import { login, logout, resetPassword, signupCustomer, signupDriver } from "@/server/modules/auth/service";
import { IP, NOW, PASSWORD, at, clearStores, e164, freshStores, makeAgency, makeCustomer, makeDriver, sessionFrom, signupProof } from "./helpers";
import type { MemoryDocStore } from "../../../support/memory-docstore";

let store: MemoryDocStore;
beforeEach(() => {
  store = freshStores().store;
});
afterEach(clearStores);

describe("signup", () => {
  it("customer: creates user, profile, phone index and a live session; the proof is single-use", async () => {
    const proof = await signupProof("9876522221", "customer");
    const body = { proofToken: proof.proofToken, fullName: "Asha Raman", dob: "1990-05-01", acceptTerms: true as const, password: PASSWORD, confirmPassword: PASSWORD };
    const r = await signupCustomer(body, NOW, { ip: IP });
    expect(r.user).toMatchObject({ role: "customer", name: "Asha Raman", phoneMasked: "+91 ••••• •2221" });
    expect(r.setCookie).toMatch(/HttpOnly/);
    const user = (await store.get<UserDoc>(C.users, r.user.id))!;
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(user)).not.toContain(PASSWORD);
    expect(await store.get<CustomerDoc>(C.customers, r.user.id)).toMatchObject({ dob: "1990-05-01" });
    expect(await store.get<PhoneIndexDoc>(C.phoneIndex, e164("9876522221"))).toMatchObject({ userId: r.user.id, role: "customer" });
    const ctx = await sessionFrom(r.setCookie);
    expect(ctx).toMatchObject({ userId: r.user.id, role: "customer", profileId: r.user.id, agencyId: null, name: "Asha Raman" });

    await expect(signupCustomer(body, NOW, { ip: IP })).rejects.toMatchObject({ code: "proof_expired" });
  });

  it("customer: DOB must be 18+ (IST)", () => {
    const today = new Date("2026-11-20T00:00:00Z");
    expect(maxDobFor(today)).toBe("2008-11-20");
    expect(isAdult("2008-11-20", today)).toBe(true);
    expect(isAdult("2008-11-21", today)).toBe(false);
    const res = CustomerSignupBody.safeParse({
      proofToken: "a".repeat(43),
      fullName: "Young Person",
      dob: "2015-01-01",
      acceptTerms: true,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain("18 or older");
  });

  it("rejects a proof issued for another role", async () => {
    const proof = await signupProof("9876522222", "agency");
    await expect(
      signupCustomer({ proofToken: proof.proofToken, fullName: "Asha", dob: "1990-01-01", acceptTerms: true, password: PASSWORD, confirmPassword: PASSWORD }, NOW, { ip: IP }),
    ).rejects.toMatchObject({ code: "proof_expired" });
  });

  it("agency: pending verification, owner session carries agencyId, home district state is covered", async () => {
    const r = await makeAgency("9876522224");
    expect(r.user.agency).toMatchObject({ name: "Selvam Travels", verification: "pending" });
    const agency = (await store.get<AgencyDoc>(C.agencies, r.user.agency!.id))!;
    expect(agency.statesCovered).toEqual(expect.arrayContaining(["TN", "KL"]));
    expect(agency.identityDocument).toBeNull();
    expect(agency.verification.submittedAt).toBeNull();
    expect(r.session).toMatchObject({ role: "agency", agencyId: agency.id, profileId: agency.id });
  });

  it("driver: picking an agency requires a verified agency and creates a pending link", async () => {
    const a = await makeAgency("9876522225");
    await expect(makeDriver(a.user.agency!.id, "9876522226")).rejects.toMatchObject({ code: "not_found" });
    await store.runTransaction(async (tx) => {
      const doc = (await tx.get<AgencyDoc>(C.agencies, a.user.agency!.id))!;
      tx.update(C.agencies, doc.id, { verification: { ...doc.verification, status: "verified" } });
    });
    const d = await makeDriver(a.user.agency!.id, "9876522227");
    expect(d.user.driver?.agencyLink).toMatchObject({ agencyId: a.user.agency!.id, status: "pending" });
    const doc = (await store.get<DriverDoc>(C.drivers, d.user.id))!;
    expect(doc.license).toBeNull();
    expect(doc.photo).toBeNull();
  });

  it("driver: an agency invite is offered at OTP verify and accepted at signup (active link)", async () => {
    const a = await makeAgency("9876522228");
    const agencyId = a.user.agency!.id;
    store.put(C.driverInvites, "inv_aaaaaaaaaaaaaaaaaaaa", {
      id: "inv_aaaaaaaaaaaaaaaaaaaa",
      agencyId,
      agencyName: "Selvam Travels",
      phone: e164("9876522229"),
      fullName: "Mani",
      status: "pending",
      expiresAt: at(86_400_000).toISOString(),
      driverId: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    } satisfies DriverInviteDoc);
    const ch = await sendOtp({ phone: e164("9876522229"), role: "driver", purpose: "signup" }, NOW, IP);
    const proof = await verifyOtp(ch.challengeId, ch.devOtp!.code, NOW, IP);
    expect(proof.invite).toMatchObject({ inviteId: "inv_aaaaaaaaaaaaaaaaaaaa", agencyName: "Selvam Travels" });
    const r = await signupDriver(
      { proofToken: proof.proofToken, fullName: "Mani Kandan", inviteId: proof.invite!.inviteId, acceptTerms: true, password: PASSWORD, confirmPassword: PASSWORD },
      NOW,
      { ip: IP },
    );
    expect(r.user.driver?.agencyLink?.status).toBe("active");
    expect((await store.get<DriverInviteDoc>(C.driverInvites, "inv_aaaaaaaaaaaaaaaaaaaa"))?.status).toBe("accepted");
    expect((await store.get<AgencyDoc>(C.agencies, agencyId))?.stats.drivers).toBe(1);
  });
});

describe("login / logout / recovery", () => {
  it("logs in with the right role, rejects wrong passwords and reveals the role only after a correct password", async () => {
    await makeCustomer("9876533331");
    const ok = await login({ role: "customer", phone: e164("9876533331"), password: PASSWORD }, NOW, { ip: IP });
    expect(ok.user.role).toBe("customer");
    expect(await sessionFrom(ok.setCookie)).not.toBeNull();

    await expect(login({ role: "customer", phone: e164("9876533331"), password: "Wrong12345" }, NOW, { ip: IP })).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(login({ role: "customer", phone: e164("9876533339"), password: PASSWORD }, NOW, { ip: IP })).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(login({ role: "agency", phone: e164("9876533331"), password: PASSWORD }, NOW, { ip: IP })).rejects.toMatchObject({
      code: "forbidden",
      details: { reason: "wrong_role", role: "customer" },
    });
  });

  it("locks the account for 15 minutes after 5 failures", async () => {
    await makeCustomer("9876533332");
    for (let i = 0; i < 5; i++) {
      await expect(login({ role: "customer", phone: e164("9876533332"), password: `Wrong${i}abcd` }, NOW, { ip: IP })).rejects.toMatchObject({ code: "invalid_credentials" });
    }
    await expect(login({ role: "customer", phone: e164("9876533332"), password: PASSWORD }, at(60_000), { ip: IP })).rejects.toMatchObject({ code: "account_locked" });
    const after = await login({ role: "customer", phone: e164("9876533332"), password: PASSWORD }, at(16 * 60_000), { ip: IP });
    expect(after.user.role).toBe("customer");
  });

  it("logout revokes the session; disabled users lose their sessions immediately", async () => {
    const c = await makeCustomer("9876533333");
    await logout(c.session, at(1000));
    expect(await sessionFrom(c.setCookie, at(2000))).toBeNull();

    const again = await login({ role: "customer", phone: e164("9876533333"), password: PASSWORD }, at(3000), { ip: IP });
    expect(await sessionFrom(again.setCookie, at(4000))).not.toBeNull();
    await store.runTransaction(async (tx) => {
      await tx.get(C.users, c.user.id);
      tx.update(C.users, c.user.id, { status: "disabled" });
    });
    expect(await sessionFrom(again.setCookie, at(5000))).toBeNull();
    expect(await resolveSession(null, NOW)).toBeNull();
  });

  it("password reset via OTP sets the new password and signs out every session", async () => {
    const c = await makeCustomer("9876533334");
    const ch = await sendOtp({ phone: e164("9876533334"), role: "customer", purpose: "reset_password" }, at(1000), IP);
    const proof = await verifyOtp(ch.challengeId, ch.devOtp!.code, at(2000), IP);
    const res = await resetPassword({ proofToken: proof.proofToken, password: "NewPass2027", confirmPassword: "NewPass2027" }, at(3000));
    expect(res.role).toBe("customer");
    expect(await sessionFrom(c.setCookie, at(4000))).toBeNull();
    await expect(login({ role: "customer", phone: e164("9876533334"), password: PASSWORD }, at(5000), { ip: IP })).rejects.toMatchObject({ code: "invalid_credentials" });
    expect((await login({ role: "customer", phone: e164("9876533334"), password: "NewPass2027" }, at(6000), { ip: IP })).user.id).toBe(c.user.id);
    // A signup proof can't reset a password.
    const signup = await signupProof("9876533335", "customer");
    await expect(resetPassword({ proofToken: signup.proofToken, password: "NewPass2027", confirmPassword: "NewPass2027" }, at(7000))).rejects.toMatchObject({
      code: "proof_expired",
    });
  });
});
