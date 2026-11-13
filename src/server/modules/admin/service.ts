import "server-only";
import type {
  AdminAgencyDetailDTO,
  AdminAgencyListItemDTO,
  AdminDriverDetailDTO,
  AdminDriverListItemDTO,
  AdminOverviewDTO,
  AdminReviewStatus,
  AdminSettlementResultDTO,
  AdminSettlementRowDTO,
  AdminVerificationDTO,
} from "@/lib/api/contracts/admin";
import { fileUrl } from "@/lib/api/contracts/common";
import { DomainError } from "@/lib/api/contracts/errors";
import type { IsoDate } from "@/lib/domain/model";
import { getDistrict } from "@/lib/domain/places/districts";
import { formatPhoneForAdmin } from "./format";
import { pendingSettlementsByAgency, recordSettlement, verification } from "@/server/core";
import type { SessionContext } from "@/server/core/context";
import { C, getDocStore } from "@/server/db";
import type { AgencyDoc, DriverDoc, VerificationState } from "@/server/db/schema";
import { agencyDocuments, driverDocuments } from "@/server/modules/profile/service";

/*
 * Hidden admin console (plan decision 4): review queues, document view (masked numbers + access-checked files),
 * verify / reject with a reason (D5 core.verification), and settlements (D5 core.earnings).
 * Every function expects an admin SessionContext; the route handlers enforce `auth: "admin"`.
 */

const LIST_LIMIT = 100;

function assertAdmin(ctx: SessionContext): void {
  if (ctx.role !== "admin") throw new DomainError("forbidden");
}

function verificationDTO(v: VerificationState): AdminVerificationDTO {
  return { status: v.status, submittedAt: v.submittedAt ?? null, reviewedAt: v.reviewedAt, reviewedBy: v.reviewedBy, reason: v.reason };
}

export function agencyDocumentsComplete(a: AgencyDoc): boolean {
  return !!a.identityDocument && !!a.photo;
}

export function driverDocumentsComplete(d: DriverDoc): boolean {
  return !!d.license && !!d.aadhaar && !!d.photo;
}

function agencyItem(a: AgencyDoc): AdminAgencyListItemDTO {
  return {
    id: a.id,
    agencyName: a.agencyName,
    ownerName: a.ownerName,
    districtName: getDistrict(a.districtId)?.name ?? a.districtId,
    state: a.state,
    createdAt: a.createdAt,
    verification: verificationDTO(a.verification),
    documentsComplete: agencyDocumentsComplete(a),
  };
}

function driverItem(d: DriverDoc): AdminDriverListItemDTO {
  return {
    id: d.id,
    fullName: d.fullName,
    agencyName: d.agencyLink?.agencyName ?? null,
    linkStatus: d.agencyLink?.status ?? null,
    createdAt: d.createdAt,
    verification: verificationDTO(d.verification),
    documentsComplete: driverDocumentsComplete(d),
  };
}

/** Ready-for-review first (oldest submission first), then incomplete sign-ups (newest first). */
function reviewOrder<T extends { verification: AdminVerificationDTO; createdAt: string }>(items: T[], status: AdminReviewStatus): T[] {
  if (status !== "pending") return items;
  const ready = items.filter((i) => i.verification.submittedAt).sort((a, b) => a.verification.submittedAt!.localeCompare(b.verification.submittedAt!));
  const waiting = items.filter((i) => !i.verification.submittedAt);
  return [...ready, ...waiting];
}

// ── Agencies ─────────────────────────────────────────────────────────────────
export async function listAgencies(ctx: SessionContext, status: AdminReviewStatus): Promise<{ items: AdminAgencyListItemDTO[] }> {
  assertAdmin(ctx);
  const rows = await getDocStore().query<AgencyDoc>(C.agencies, {
    where: [["verification.status", "==", status]],
    orderBy: [["createdAt", "desc"]],
    limit: LIST_LIMIT,
  });
  return { items: reviewOrder(rows.map(agencyItem), status) };
}

export async function getAgency(ctx: SessionContext, agencyId: string): Promise<AdminAgencyDetailDTO> {
  assertAdmin(ctx);
  const a = await getDocStore().get<AgencyDoc>(C.agencies, agencyId);
  if (!a) throw new DomainError("not_found");
  return {
    ...agencyItem(a),
    phone: formatPhoneForAdmin(a.phone),
    statesCovered: a.statesCovered,
    vehicleCountRange: a.vehicleCountRange,
    photoUrl: a.photo ? fileUrl(a.photo.fileId) : null,
    documents: agencyDocuments(a),
    stats: a.stats,
  };
}

export async function decideAgency(ctx: SessionContext, agencyId: string, decision: { verify: true } | { verify: false; reason: string }, now: Date): Promise<AdminAgencyDetailDTO> {
  assertAdmin(ctx);
  const a = await getDocStore().get<AgencyDoc>(C.agencies, agencyId);
  if (!a) throw new DomainError("not_found");
  if (decision.verify && !agencyDocumentsComplete(a)) {
    throw new DomainError("invalid_request", "This agency hasn't uploaded its identity document and photo yet.");
  }
  const reviewer = { now, reviewerId: ctx.userId };
  if (decision.verify) await verification.verifyAgency(reviewer, agencyId);
  else await verification.rejectAgency(reviewer, agencyId, decision.reason);
  return getAgency(ctx, agencyId);
}

// ── Drivers ──────────────────────────────────────────────────────────────────
export async function listDrivers(ctx: SessionContext, status: AdminReviewStatus): Promise<{ items: AdminDriverListItemDTO[] }> {
  assertAdmin(ctx);
  const rows = await getDocStore().query<DriverDoc>(C.drivers, {
    where: [["verification.status", "==", status]],
    orderBy: [["createdAt", "desc"]],
    limit: LIST_LIMIT,
  });
  return { items: reviewOrder(rows.map(driverItem), status) };
}

export async function getDriver(ctx: SessionContext, driverId: string): Promise<AdminDriverDetailDTO> {
  assertAdmin(ctx);
  const d = await getDocStore().get<DriverDoc>(C.drivers, driverId);
  if (!d) throw new DomainError("not_found");
  return {
    ...driverItem(d),
    phone: formatPhoneForAdmin(d.phone),
    photoUrl: d.photo ? fileUrl(d.photo.fileId) : null,
    documents: driverDocuments(d),
    licenseValidUntil: d.license?.validUntil ?? null,
    stats: d.stats,
  };
}

export async function decideDriver(ctx: SessionContext, driverId: string, decision: { verify: true } | { verify: false; reason: string }, now: Date): Promise<AdminDriverDetailDTO> {
  assertAdmin(ctx);
  const d = await getDocStore().get<DriverDoc>(C.drivers, driverId);
  if (!d) throw new DomainError("not_found");
  if (decision.verify && !driverDocumentsComplete(d)) {
    throw new DomainError("invalid_request", "This driver hasn't uploaded their licence, Aadhaar and photo yet.");
  }
  const reviewer = { now, reviewerId: ctx.userId };
  if (decision.verify) await verification.verifyDriver(reviewer, driverId);
  else await verification.rejectDriver(reviewer, driverId, decision.reason);
  return getDriver(ctx, driverId);
}

// ── Overview & settlements ───────────────────────────────────────────────────
async function queueCounts(col: string): Promise<{ awaitingReview: number; awaitingDocuments: number }> {
  const rows = await getDocStore().query<{ verification: VerificationState }>(col, { where: [["verification.status", "==", "pending"]], limit: 500 });
  const awaitingReview = rows.filter((r) => !!r.verification.submittedAt).length;
  return { awaitingReview, awaitingDocuments: rows.length - awaitingReview };
}

/** Settlement rows, or null while D5's earnings read model is not implemented yet. */
async function settlementRows(): Promise<AdminSettlementRowDTO[] | null> {
  try {
    return await pendingSettlementsByAgency();
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_implemented") return null;
    throw e;
  }
}

export async function overview(ctx: SessionContext): Promise<AdminOverviewDTO> {
  assertAdmin(ctx);
  const [agencies, drivers, settlements] = await Promise.all([queueCounts(C.agencies), queueCounts(C.drivers), settlementRows()]);
  return {
    agencies,
    drivers,
    settlements: settlements ? { agencies: settlements.length, pendingAmount: settlements.reduce((s, r) => s + r.pendingAmount, 0) } : null,
  };
}

export async function listSettlements(ctx: SessionContext): Promise<{ items: AdminSettlementRowDTO[]; available: boolean }> {
  assertAdmin(ctx);
  const rows = await settlementRows();
  return { items: rows ?? [], available: rows !== null };
}

export async function settle(ctx: SessionContext, input: { agencyId: string; through: IsoDate; reference: string }, now: Date): Promise<AdminSettlementResultDTO> {
  assertAdmin(ctx);
  const s = await recordSettlement({ agencyId: input.agencyId, through: input.through, reference: input.reference, recordedBy: ctx.userId, now });
  if (!s) throw new DomainError("invalid_request", "Nothing is pending for this agency up to that date.");
  return { settlementId: s.id, agencyId: s.agencyId, amount: s.amount, count: s.earningIds.length, reference: s.reference, settledAt: s.settledAt };
}
