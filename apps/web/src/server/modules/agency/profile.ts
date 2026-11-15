import "server-only";
/**
 * Agency profile & verification (P2 §3.8, §8.5). The account data itself is D1's
 * (modules/profile/service: profile read/edit, photo, identity documents); this module adds the
 * agency-only guard rails and live fleet counts. Uploads go through D5's files helpers inside
 * D1's service (magic-byte check, private storage path, access-checked URLs).
 */
import type { AgencyProfileDTO } from "@/lib/api/contracts/auth";
import { VerificationFields, type AgencyProfileSummaryDTO } from "@/lib/api/contracts/agency";
import { DomainError } from "@/lib/api/contracts/errors";
import type { SessionContext } from "@/server/auth/guards";
import { C, getDocStore } from "@/server/db";
import { formFile } from "@/server/files/uploads";
import { getProfile, patchProfile, setPhoto, uploadDocument } from "@/server/modules/profile/service";
import { agencyIdOf, loadAgency } from "./shared";

export type AgencyProfileResponse = AgencyProfileDTO & AgencyProfileSummaryDTO;

async function counts(agencyId: string): Promise<AgencyProfileSummaryDTO["counts"]> {
  const store = getDocStore();
  const [vehicles, drivers, pendingDrivers] = await Promise.all([
    store.count(C.vehicles, { where: [["agencyId", "==", agencyId], ["status", "in", ["active", "inactive"]]] }),
    store.count(C.drivers, { where: [["agencyLink.agencyId", "==", agencyId], ["agencyLink.status", "==", "active"]] }),
    store.count(C.drivers, { where: [["agencyLink.agencyId", "==", agencyId], ["agencyLink.status", "==", "pending"]] }),
  ]);
  return { vehicles, drivers, pendingDrivers };
}

export async function getAgencyProfile(session: SessionContext): Promise<AgencyProfileResponse> {
  const agencyId = agencyIdOf(session);
  const [profile, c] = await Promise.all([getProfile(session), counts(agencyId)]);
  if (profile.role !== "agency") throw new DomainError("forbidden");
  return { ...profile, counts: c };
}

export async function updateAgencyProfile(session: SessionContext, body: unknown, now: Date): Promise<AgencyProfileResponse> {
  agencyIdOf(session);
  await patchProfile(session, body, now);
  return getAgencyProfile(session);
}

/**
 * POST /api/agency/verification (multipart): `kind` + `number` + `file` (+ `backFile`) for the identity
 * document and/or `photo`. A rejected agency goes back to `pending` once the set is complete.
 */
export async function submitVerification(session: SessionContext, form: FormData, now: Date): Promise<AgencyProfileResponse> {
  const agencyId = agencyIdOf(session);
  const agency = await loadAgency(agencyId);
  if (agency.verification.status === "verified") throw new DomainError("conflict", "Your agency is already verified.");
  const hasDoc = !!formFile(form, "file");
  const hasPhoto = !!formFile(form, "photo");
  if (!hasDoc && !hasPhoto) throw new DomainError("invalid_request", "Add your identity document or photo.", { fields: { file: "Required" } });
  if (hasDoc) {
    const fields = VerificationFields.parse({ kind: form.get("kind") ?? "", number: form.get("number") ?? "" });
    await uploadDocument(session, fields.kind, form, now);
  }
  if (hasPhoto) await setPhoto(session, form, now);
  return getAgencyProfile(session);
}
