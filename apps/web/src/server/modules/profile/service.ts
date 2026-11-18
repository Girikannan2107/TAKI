import "server-only";
import { z } from "zod";
import {
  AgencyProfilePatch,
  ChangePasswordBody,
  ChangePhoneBody,
  CustomerProfilePatch,
  DOCUMENT_KINDS_FOR,
  DOCUMENT_LABELS,
  DocumentUploadFields,
  DriverProfilePatch,
  type DocumentDTO,
  type DocumentStatus,
  type DocumentUploadResultDTO,
  type ProfileDTO,
  type SessionUserDTO,
} from "@/lib/api/contracts/auth";
import { fileUrl } from "@/lib/api/contracts/common";
import { DomainError } from "@/lib/api/contracts/errors";
import type { FileRef, IdentityDocumentKind, VerificationStatus } from "@/lib/domain/model";
import { getDistrict } from "@/lib/domain/places/districts";
import { phoneIndexKey } from "@/server/auth/accounts";
import type { SessionContext } from "@/server/auth/guards";
import { maskPhone, markProofConsumed, readProof } from "@/server/auth/otp";
import { hashPassword, passwordProblem, verifyPassword } from "@/server/auth/passwords";
import { AUTH_LIMITS, hitRateLimits } from "@/server/auth/rate-limits";
import { revokeUserSessions } from "@/server/auth/sessions";
import { C, getDocStore } from "@/server/db";
import type { AgencyDoc, CustomerDoc, DriverDoc, IdentityDocument, PhoneIndexDoc, UserDoc, VerificationState } from "@/server/db/schema";
import { formFile, markReplaced, saveUpload } from "@/server/files/uploads";
import { buildSessionUser } from "@/server/modules/auth/session-user";
import { searchTokensFor } from "@/server/modules/auth/service";
import { documentHmac, normalizeDocumentNumber } from "./document-numbers";

/*
 * Account features shared by every role (P3 §4.1 "Account cards"): profile read/edit, photo, password change,
 * phone change via OTP, identity documents (agency verification / driver documents).
 */

const ref = (f: FileRef | null | undefined) => (f ? fileUrl(f.fileId) : null);

async function loadUser(ctx: SessionContext): Promise<UserDoc> {
  const u = await getDocStore().get<UserDoc>(C.users, ctx.userId);
  if (!u) throw new DomainError("unauthenticated");
  return u;
}

function docStatus(present: boolean, v: VerificationState | undefined): DocumentStatus {
  if (!present) return "missing";
  const s = v?.status;
  return s === "verified" || s === "rejected" ? s : "pending";
}

type StoredDoc = { numberMasked: string; file: FileRef; backFile?: FileRef | null; uploadedAt?: string } | null | undefined;

function toDocumentDTO(kind: IdentityDocumentKind, d: StoredDoc, v: VerificationState | undefined): DocumentDTO {
  return {
    kind,
    label: DOCUMENT_LABELS[kind],
    numberMasked: d?.numberMasked ?? null,
    fileUrl: ref(d?.file),
    backFileUrl: ref(d?.backFile ?? null),
    status: docStatus(!!d, v),
    uploadedAt: d?.uploadedAt ?? null,
  };
}

export function agencyDocuments(a: AgencyDoc): DocumentDTO[] {
  const id = (a.identityDocument ?? null) as (IdentityDocument & { backFile?: FileRef | null; uploadedAt?: string }) | null;
  return id ? [toDocumentDTO(id.kind, id, a.verification)] : [];
}

export function driverDocuments(d: DriverDoc): DocumentDTO[] {
  return [toDocumentDTO("driving_license", d.license ?? null, d.verification), toDocumentDTO("aadhaar", d.aadhaar ?? null, d.verification)];
}

function verificationDTO(v: VerificationState) {
  return { status: v.status, submittedAt: v.submittedAt ?? null, reviewedAt: v.reviewedAt, reason: v.reason };
}

// ── Read ─────────────────────────────────────────────────────────────────────
export async function getProfile(ctx: SessionContext): Promise<ProfileDTO> {
  const store = getDocStore();
  const user = await loadUser(ctx);
  const base = { id: user.id, phone: user.phone, phoneMasked: maskPhone(user.phone), createdAt: user.createdAt };
  switch (user.role) {
    case "customer": {
      const c = await store.get<CustomerDoc>(C.customers, user.id);
      if (!c) throw new DomainError("not_found");
      return { ...base, role: "customer", fullName: c.fullName, dob: c.dob, photoUrl: ref(c.photo) };
    }
    case "agency": {
      const a = user.agencyId ? await store.get<AgencyDoc>(C.agencies, user.agencyId) : null;
      if (!a) throw new DomainError("not_found");
      return {
        ...base,
        role: "agency",
        agencyId: a.id,
        ownerName: a.ownerName,
        agencyName: a.agencyName,
        districtId: a.districtId,
        districtName: getDistrict(a.districtId)?.name ?? a.districtId,
        state: a.state,
        statesCovered: a.statesCovered,
        vehicleCountRange: a.vehicleCountRange,
        photoUrl: ref(a.photo),
        verification: verificationDTO(a.verification),
        documents: agencyDocuments(a),
        stats: a.stats,
      };
    }
    case "driver": {
      const d = await store.get<DriverDoc>(C.drivers, user.id);
      if (!d) throw new DomainError("not_found");
      return {
        ...base,
        role: "driver",
        fullName: d.fullName,
        photoUrl: ref(d.photo ?? null),
        agencyLink: d.agencyLink
          ? { agencyId: d.agencyLink.agencyId, agencyName: d.agencyLink.agencyName, status: d.agencyLink.status, via: d.agencyLink.via }
          : null,
        verification: { status: d.verification.status, reviewedAt: d.verification.reviewedAt, reason: d.verification.reason },
        documents: driverDocuments(d),
        stats: d.stats,
      };
    }
    case "admin":
      return { ...base, role: "admin", name: user.displayName, photoUrl: null };
  }
}

// ── Edit details ─────────────────────────────────────────────────────────────
export async function patchProfile(ctx: SessionContext, raw: unknown, now: Date): Promise<ProfileDTO> {
  const at = now.toISOString();
  await getDocStore().runTransaction(async (tx) => {
    const user = await tx.get<UserDoc>(C.users, ctx.userId);
    if (!user) throw new DomainError("unauthenticated");
    switch (user.role) {
      case "customer": {
        const body = CustomerProfilePatch.parse(raw);
        tx.update(C.customers, user.id, { fullName: body.fullName, updatedAt: at });
        tx.update(C.users, user.id, { displayName: body.fullName, updatedAt: at });
        return;
      }
      case "driver": {
        const body = DriverProfilePatch.parse(raw);
        tx.update(C.drivers, user.id, { fullName: body.fullName, updatedAt: at });
        tx.update(C.users, user.id, { displayName: body.fullName, updatedAt: at });
        return;
      }
      case "agency": {
        const body = AgencyProfilePatch.parse(raw);
        if (!user.agencyId) throw new DomainError("not_found");
        const a = await tx.get<AgencyDoc>(C.agencies, user.agencyId);
        if (!a) throw new DomainError("not_found");
        const district = getDistrict(body.districtId)!;
        tx.update(C.agencies, a.id, {
          ownerName: body.ownerName,
          agencyName: body.agencyName,
          nameLower: body.agencyName.toLowerCase(),
          searchTokens: searchTokensFor(body.agencyName, district.name),
          districtId: district.id,
          state: district.state,
          statesCovered: [...new Set([district.state, ...body.statesCovered])],
          vehicleCountRange: body.vehicleCountRange,
          updatedAt: at,
        });
        tx.update(C.users, user.id, { displayName: body.ownerName, updatedAt: at });
        return;
      }
      case "admin":
        throw new DomainError("forbidden");
    }
  });
  return getProfile(ctx);
}

// ── Password / phone ─────────────────────────────────────────────────────────
export async function changePassword(ctx: SessionContext, body: z.output<typeof ChangePasswordBody>, now: Date): Promise<void> {
  const user = await loadUser(ctx);
  const { ok } = await verifyPassword(body.currentPassword, user.passwordHash);
  if (!ok) throw new DomainError("invalid_credentials", "Your current password is incorrect.", { fields: { currentPassword: "Incorrect password" } });
  const problem = passwordProblem(body.password, user.phone);
  if (problem) throw new DomainError("invalid_request", problem, { fields: { password: problem } });
  const passwordHash = await hashPassword(body.password);
  await getDocStore().runTransaction(async (tx) => {
    await revokeUserSessions(user.id, now, { exceptSessionId: ctx.sessionId, tx });
    tx.update(C.users, user.id, { passwordHash, passwordChangedAt: now.toISOString(), updatedAt: now.toISOString() });
  });
}

export async function changePhone(ctx: SessionContext, body: z.output<typeof ChangePhoneBody>, now: Date): Promise<SessionUserDTO> {
  const user = await loadUser(ctx);
  const { ok } = await verifyPassword(body.currentPassword, user.passwordHash);
  if (!ok) throw new DomainError("invalid_credentials", "Your password is incorrect.", { fields: { currentPassword: "Incorrect password" } });
  const at = now.toISOString();
  const updated = await getDocStore().runTransaction(async (tx) => {
    const challenge = await readProof(tx, body.proofToken, "change_phone", now);
    if (challenge.userId !== ctx.userId) throw new DomainError("proof_expired");
    const u = await tx.get<UserDoc>(C.users, ctx.userId);
    if (!u) throw new DomainError("unauthenticated");
    if (challenge.phone === u.phone) throw new DomainError("invalid_request", "That's already your number.");
    const taken = await tx.get<PhoneIndexDoc>(C.phoneIndex, phoneIndexKey(challenge.phone));
    if (taken) throw new DomainError("phone_taken", "This phone number is already registered to another account.");
    await revokeUserSessions(u.id, now, { exceptSessionId: ctx.sessionId, tx });
    // ── writes ──
    tx.delete(C.phoneIndex, phoneIndexKey(u.phone));
    tx.create<PhoneIndexDoc>(C.phoneIndex, phoneIndexKey(challenge.phone), { id: phoneIndexKey(challenge.phone), userId: u.id, role: u.role, createdAt: at });
    tx.update(C.users, u.id, { phone: challenge.phone, phoneVerifiedAt: at, updatedAt: at });
    if (u.role === "customer") tx.update(C.customers, u.id, { phone: challenge.phone, updatedAt: at });
    if (u.role === "driver") tx.update(C.drivers, u.id, { phone: challenge.phone, updatedAt: at });
    if (u.role === "agency" && u.agencyId) tx.update(C.agencies, u.agencyId, { phone: challenge.phone, updatedAt: at });
    markProofConsumed(tx, challenge, now);
    return { ...u, phone: challenge.phone, phoneVerifiedAt: at, updatedAt: at };
  });
  return buildSessionUser(updated);
}

// ── Photo ────────────────────────────────────────────────────────────────────
export async function setPhoto(ctx: SessionContext, form: FormData, now: Date): Promise<{ photoUrl: string }> {
  if (ctx.role === "admin") throw new DomainError("forbidden");
  await hitRateLimits([AUTH_LIMITS.uploadUser(ctx.userId)], now);
  const file = formFile(form, "photo", true);
  const ownerType = ctx.role;
  const ownerId = ctx.role === "agency" ? ctx.agencyId! : ctx.userId;
  const saved = await saveUpload({ file, kind: "profile_photo", ownerType, ownerId, uploadedBy: ctx.userId, now, field: "photo" });
  const col = ctx.role === "customer" ? C.customers : ctx.role === "driver" ? C.drivers : C.agencies;
  const previous = await getDocStore().runTransaction(async (tx) => {
    const doc = await tx.get<{ photo: FileRef | null }>(col, ownerId);
    if (!doc) throw new DomainError("not_found");
    tx.update(col, ownerId, { photo: { fileId: saved.id }, updatedAt: now.toISOString() });
    return doc.photo ?? null;
  });
  if (previous && previous.fileId !== saved.id) await markReplaced(previous.fileId, now).catch(() => undefined);
  if (ctx.role !== "customer") await maybeSubmitForReview(ctx, now);
  return { photoUrl: fileUrl(saved.id) };
}

// ── Identity documents ───────────────────────────────────────────────────────
function nextVerification(v: VerificationState, complete: boolean, now: Date): VerificationState {
  if (v.status === "verified") return v; // already approved: replacement documents don't block the account
  if (!complete) return v; // keep collecting; nothing is queued for review yet
  return { ...v, status: "pending", submittedAt: now.toISOString(), reviewedAt: null, reviewedBy: null, reason: null };
}

function agencyComplete(a: AgencyDoc): boolean {
  return !!a.identityDocument && !!a.photo;
}
function driverComplete(d: DriverDoc): boolean {
  return !!d.license && !!d.aadhaar && !!d.photo;
}

/** Re-evaluates "submitted for review" after a photo upload (documents call this inline). */
async function maybeSubmitForReview(ctx: SessionContext, now: Date): Promise<void> {
  await getDocStore().runTransaction(async (tx) => {
    if (ctx.role === "agency" && ctx.agencyId) {
      const a = await tx.get<AgencyDoc>(C.agencies, ctx.agencyId);
      if (a && a.verification.status !== "verified" && !a.verification.submittedAt && agencyComplete(a)) {
        tx.update(C.agencies, a.id, { verification: nextVerification(a.verification, true, now), updatedAt: now.toISOString() });
      }
    } else if (ctx.role === "driver") {
      const d = await tx.get<DriverDoc>(C.drivers, ctx.userId);
      if (d && d.verification.status !== "verified" && !d.verification.submittedAt && driverComplete(d)) {
        tx.update(C.drivers, d.id, { verification: nextVerification(d.verification, true, now), updatedAt: now.toISOString() });
      }
    }
  });
}

/**
 * PUT /api/me/documents/[kind] (multipart: number, file, backFile?, validUntil?).
 * Agency: one identity document (replaces any previous kind). Driver: driving_license and aadhaar.
 * When the required set (plus photo) is complete the account is queued for admin review.
 */
export async function uploadDocument(ctx: SessionContext, kind: IdentityDocumentKind, form: FormData, now: Date): Promise<DocumentUploadResultDTO> {
  if (ctx.role !== "agency" && ctx.role !== "driver") throw new DomainError("forbidden");
  if (!DOCUMENT_KINDS_FOR[ctx.role].includes(kind)) throw new DomainError("invalid_request", `${DOCUMENT_LABELS[kind]} isn't needed for this account.`);
  const fields = DocumentUploadFields.parse({
    number: form.get("number") ?? "",
    validUntil: (form.get("validUntil") as string | null) || undefined,
  });
  const n = normalizeDocumentNumber(kind, fields.number);
  if ("problem" in n) throw new DomainError("invalid_document_number", n.problem, { fields: { number: n.problem } });
  await hitRateLimits([AUTH_LIMITS.uploadUser(ctx.userId)], now);

  const front = formFile(form, "file", true);
  const back = formFile(form, "backFile");
  const ownerType = ctx.role;
  const ownerId = ctx.role === "agency" ? ctx.agencyId! : ctx.userId;
  const savedFront = await saveUpload({ file: front, kind, ownerType, ownerId, uploadedBy: ctx.userId, now, field: "file" });
  const savedBack = back ? await saveUpload({ file: back, kind, ownerType, ownerId, uploadedBy: ctx.userId, now, field: "backFile" }) : null;
  const at = now.toISOString();
  const stored = {
    numberMasked: n.masked,
    numberHmac: documentHmac(kind, n.normalized),
    file: { fileId: savedFront.id },
    backFile: savedBack ? { fileId: savedBack.id } : null,
    uploadedAt: at,
  };

  const { replaced, result } = await getDocStore().runTransaction(async (tx) => {
    if (ctx.role === "agency") {
      const a = await tx.get<AgencyDoc>(C.agencies, ownerId);
      if (!a) throw new DomainError("not_found");
      const prev = (a.identityDocument ?? null) as (IdentityDocument & { backFile?: FileRef | null }) | null;
      const next: AgencyDoc = { ...a, identityDocument: { kind, ...stored } as IdentityDocument, updatedAt: at };
      next.verification = nextVerification(a.verification, agencyComplete(next), now);
      tx.set(C.agencies, a.id, next);
      return {
        replaced: [prev?.file, prev?.backFile].filter(Boolean) as FileRef[],
        result: { document: agencyDocuments(next)[0]!, verification: next.verification.status as VerificationStatus },
      };
    }
    const d = await tx.get<DriverDoc>(C.drivers, ownerId);
    if (!d) throw new DomainError("not_found");
    const prev = (kind === "driving_license" ? d.license : d.aadhaar) as StoredDoc;
    const next: DriverDoc =
      kind === "driving_license"
        ? ({ ...d, license: { ...stored, validUntil: fields.validUntil ?? null }, updatedAt: at } as DriverDoc)
        : ({ ...d, aadhaar: stored, updatedAt: at } as DriverDoc);
    next.verification = nextVerification(d.verification, driverComplete(next), now);
    tx.set(C.drivers, d.id, next);
    return {
      replaced: [prev?.file, prev?.backFile].filter(Boolean) as FileRef[],
      result: { document: driverDocuments(next).find((x) => x.kind === kind)!, verification: next.verification.status as VerificationStatus },
    };
  });
  for (const f of replaced) await markReplaced(f.fileId, now).catch(() => undefined);
  return result;
}
