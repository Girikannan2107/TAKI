import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { C } from "@/server/db";
import type { AgencyDoc, DriverDoc, PhoneIndexDoc, UserDoc } from "@/server/db/schema";
import { sendOtp, verifyOtp } from "@/server/auth/otp";
import { hashPassword } from "@/server/auth/passwords";
import { issueSession, resolveSession } from "@/server/auth/sessions";
import { login } from "@/server/modules/auth/service";
import { changePassword, changePhone, getProfile, patchProfile, setPhoto, uploadDocument } from "@/server/modules/profile/service";
import { decideAgency, decideDriver, getAgency, listAgencies, overview } from "@/server/modules/admin/service";
import type { SessionContext } from "@/server/core/context";
import { AADHAAR, IP, JPEG, NOW, PASSWORD, PDF, at, clearStores, e164, fileOf, freshStores, makeAgency, makeCustomer, makeDriver, sessionFrom } from "./helpers";
import type { MemoryDocStore } from "../../../support/memory-docstore";

let store: MemoryDocStore;
beforeEach(() => {
  store = freshStores().store;
});
afterEach(clearStores);

function photoForm(): FormData {
  const f = new FormData();
  f.set("photo", fileOf(JPEG, "me.jpg", "image/jpeg"));
  return f;
}

function docForm(number: string, bytes = PDF): FormData {
  const f = new FormData();
  f.set("number", number);
  f.set("file", fileOf(bytes, "doc.pdf", "application/pdf"));
  return f;
}

async function makeAdmin(): Promise<SessionContext> {
  const id = "usr_adminaaaaaaaaaaaaaaa";
  const user: UserDoc = {
    id,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    role: "admin",
    phone: e164("9000000001"),
    phoneVerifiedAt: NOW.toISOString(),
    passwordHash: await hashPassword(PASSWORD),
    passwordChangedAt: NOW.toISOString(),
    status: "active",
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    agencyId: null,
    displayName: "Ops Admin",
  };
  store.put(C.users, id, user);
  store.put(C.phoneIndex, user.phone, { id: user.phone, userId: id, role: "admin", createdAt: NOW.toISOString() } satisfies PhoneIndexDoc);
  const s = await issueSession(user, NOW);
  const ctx = await sessionFrom(s.setCookie);
  return ctx!;
}

describe("account: profile, password, phone", () => {
  it("reads and edits the customer profile", async () => {
    const c = await makeCustomer("9876544441");
    expect(await getProfile(c.session)).toMatchObject({ role: "customer", fullName: "Asha Raman", dob: "1990-05-01", phoneMasked: "+91 ••••• •4441" });
    const p = await patchProfile(c.session, { fullName: "  Asha   R  " }, at(1000));
    expect(p).toMatchObject({ fullName: "Asha R" });
    expect((await store.get<UserDoc>(C.users, c.user.id))?.displayName).toBe("Asha R");
  });

  it("change password keeps this session and signs out the others", async () => {
    const c = await makeCustomer("9876544442");
    const other = await login({ role: "customer", phone: e164("9876544442"), password: PASSWORD }, at(1000), { ip: IP });
    await expect(changePassword(c.session, { currentPassword: "Wrong1234", password: "Fresh2027x", confirmPassword: "Fresh2027x" }, at(2000))).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    await changePassword(c.session, { currentPassword: PASSWORD, password: "Fresh2027x", confirmPassword: "Fresh2027x" }, at(3000));
    expect(await sessionFrom(c.setCookie, at(4000))).not.toBeNull();
    expect(await sessionFrom(other.setCookie, at(4000))).toBeNull();
  });

  it("change phone needs an OTP on the new number + password, moves the phone index", async () => {
    const c = await makeCustomer("9876544443");
    await makeCustomer("9876544444");
    await expect(sendOtp({ phone: e164("9876544444"), role: "customer", purpose: "change_phone", userId: c.user.id }, NOW, IP)).rejects.toMatchObject({ code: "phone_taken" });
    const ch = await sendOtp({ phone: e164("9876544445"), role: "customer", purpose: "change_phone", userId: c.user.id }, NOW, IP);
    const proof = await verifyOtp(ch.challengeId, ch.devOtp!.code, NOW, IP);
    await expect(changePhone(c.session, { proofToken: proof.proofToken, currentPassword: "nope12345" }, NOW)).rejects.toMatchObject({ code: "invalid_credentials" });
    const user = await changePhone(c.session, { proofToken: proof.proofToken, currentPassword: PASSWORD }, at(1000));
    expect(user.phoneMasked).toBe("+91 ••••• •4445");
    expect(await store.get(C.phoneIndex, e164("9876544443"))).toBeNull();
    expect(await store.get<PhoneIndexDoc>(C.phoneIndex, e164("9876544445"))).toMatchObject({ userId: c.user.id });
    expect((await login({ role: "customer", phone: e164("9876544445"), password: PASSWORD }, at(2000), { ip: IP })).user.id).toBe(c.user.id);
    // Someone else's change_phone proof is useless to this user.
    const d = await makeCustomer("9876544446");
    const ch2 = await sendOtp({ phone: e164("9876544447"), role: "customer", purpose: "change_phone", userId: d.user.id }, NOW, IP);
    const proof2 = await verifyOtp(ch2.challengeId, ch2.devOtp!.code, NOW, IP);
    await expect(changePhone(c.session, { proofToken: proof2.proofToken, currentPassword: PASSWORD }, NOW)).rejects.toMatchObject({ code: "proof_expired" });
  });
});

describe("documents and verification", () => {
  it("stores only masked numbers and queues the agency for review once document + photo are in", async () => {
    const a = await makeAgency("9876555551");
    await expect(uploadDocument(a.session, "aadhaar", docForm("1234 5678 9012"), NOW)).rejects.toMatchObject({ code: "invalid_document_number" });
    const r = await uploadDocument(a.session, "aadhaar", docForm(AADHAAR), NOW);
    expect(r.document).toMatchObject({ kind: "aadhaar", numberMasked: `XXXX XXXX ${AADHAAR.slice(-4)}` });
    expect(r.document.fileUrl).toMatch(/^\/api\/files\/fil_/);
    const raw = JSON.stringify(await store.get<AgencyDoc>(C.agencies, a.session.agencyId!));
    expect(raw).not.toContain(AADHAAR);
    expect((await store.get<AgencyDoc>(C.agencies, a.session.agencyId!))?.verification.submittedAt).toBeNull();

    await setPhoto(a.session, photoForm(), at(1000));
    const agency = (await store.get<AgencyDoc>(C.agencies, a.session.agencyId!))!;
    expect(agency.verification).toMatchObject({ status: "pending", submittedAt: at(1000).toISOString() });
    // A disguised file (wrong magic bytes) is refused.
    const bad = new FormData();
    bad.set("photo", fileOf(new TextEncoder().encode("<svg/>"), "x.jpg", "image/jpeg"));
    await expect(setPhoto(a.session, bad, NOW)).rejects.toMatchObject({ code: "file_invalid" });
  });

  it("drivers need licence + Aadhaar + photo; PAN is not accepted", async () => {
    const a = await makeAgency("9876555552");
    await store.runTransaction(async (tx) => {
      const doc = (await tx.get<AgencyDoc>(C.agencies, a.session.agencyId!))!;
      tx.update(C.agencies, doc.id, { verification: { ...doc.verification, status: "verified" } });
    });
    const d = await makeDriver(a.session.agencyId!, "9876555553");
    await expect(uploadDocument(d.session, "pan", docForm("ABCDE1234F"), NOW)).rejects.toMatchObject({ code: "invalid_request" });
    await uploadDocument(d.session, "driving_license", docForm("TN0120190001234"), NOW);
    await uploadDocument(d.session, "aadhaar", docForm(AADHAAR), NOW);
    expect((await store.get<DriverDoc>(C.drivers, d.user.id))?.verification.submittedAt).toBeNull();
    await setPhoto(d.session, photoForm(), at(1000));
    const p = await getProfile(d.session);
    expect(p.role === "driver" && p.documents.map((x) => x.status)).toEqual(["pending", "pending"]);
    expect((await store.get<DriverDoc>(C.drivers, d.user.id))?.verification.submittedAt).toBe(at(1000).toISOString());
  });
});

describe("admin console", () => {
  it("lists ready-for-review first, refuses to verify incomplete accounts, verifies and rejects with a reason", async () => {
    const admin = await makeAdmin();
    const incomplete = await makeAgency("9876566661");
    const ready = await makeAgency("9876566662");
    await uploadDocument(ready.session, "pan", docForm("ABCDE1234F"), NOW);
    await setPhoto(ready.session, photoForm(), at(1000));

    const list = await listAgencies(admin, "pending");
    expect(list.items.map((i) => i.id)).toEqual([ready.session.agencyId, incomplete.session.agencyId]);
    expect(list.items[0]).toMatchObject({ documentsComplete: true });
    expect(await overview(admin)).toMatchObject({ agencies: { awaitingReview: 1, awaitingDocuments: 1 } });

    await expect(decideAgency(admin, incomplete.session.agencyId!, { verify: true }, NOW)).rejects.toMatchObject({ code: "invalid_request" });
    const detail = await getAgency(admin, ready.session.agencyId!);
    expect(detail.documents[0]).toMatchObject({ kind: "pan", numberMasked: "XXXXXX234F" });
    expect(detail.phone).toBe("+91 98765 66662");

    const verified = await decideAgency(admin, ready.session.agencyId!, { verify: true }, at(2000));
    expect(verified.verification).toMatchObject({ status: "verified", reviewedBy: admin.userId });
    await expect(decideAgency(admin, incomplete.session.agencyId!, { verify: false, reason: "" }, NOW)).rejects.toMatchObject({ code: "invalid_request" });
    const rejected = await decideAgency(admin, incomplete.session.agencyId!, { verify: false, reason: "No documents uploaded" }, at(3000));
    expect(rejected.verification).toMatchObject({ status: "rejected", reason: "No documents uploaded" });
    expect((await listAgencies(admin, "verified")).items.map((i) => i.id)).toEqual([ready.session.agencyId]);
  });

  it("is admin-only, and the admin can sign in with role admin only", async () => {
    const admin = await makeAdmin();
    const c = await makeCustomer("9876566663");
    await expect(listAgencies(c.session, "pending")).rejects.toMatchObject({ code: "forbidden" });
    await expect(decideDriver(c.session, "usr_xxxxxxxxxxxxxxxxxxxx", { verify: true }, NOW)).rejects.toMatchObject({ code: "forbidden" });
    expect((await login({ role: "admin", phone: e164("9000000001"), password: PASSWORD }, NOW, { ip: IP })).user.role).toBe("admin");
    const wrongTab = await login({ role: "customer", phone: e164("9000000001"), password: PASSWORD }, NOW, { ip: IP }).catch((e: unknown) => e);
    expect(wrongTab).toMatchObject({ code: "forbidden", message: "This number can't sign in here." });
    // The hidden admin role is never named to a public login form.
    expect((wrongTab as { details?: unknown }).details).toBeUndefined();
    expect(await resolveSession(null, NOW)).toBeNull();
    expect(admin.role).toBe("admin");
  });
});
