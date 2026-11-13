import "server-only";
/**
 * Agency / driver document verification (owner decision: admin page + ops script).
 * D1's /api/admin handlers and scripts/ops.ts both call these.
 * `reviewerId` = the admin user id, or "ops" for the CLI.
 */
import { DomainError } from "@/lib/api/contracts/errors";
import { C } from "../db/collections";
import { getDocStore } from "../db";
import type { AgencyDoc, DriverDoc, VerificationState } from "../db/schema";
import { notify } from "./notify";

export interface ReviewerCtx {
  now: Date;
  reviewerId: string;
}

function reviewed(prev: VerificationState, status: "verified" | "rejected", r: ReviewerCtx, reason: string | null): VerificationState {
  return { ...prev, status, reviewedAt: r.now.toISOString(), reviewedBy: r.reviewerId, reason };
}

async function decideAgency(r: ReviewerCtx, agencyId: string, status: "verified" | "rejected", reason: string | null): Promise<AgencyDoc> {
  if (status === "rejected" && (!reason || reason.trim().length < 3)) throw new DomainError("invalid_request", "Give a reason (at least 3 characters).", { fields: { reason: "Required" } });
  return getDocStore().runTransaction(async (tx) => {
    const agency = await tx.get<AgencyDoc>(C.agencies, agencyId);
    if (!agency) throw new DomainError("not_found");
    if (agency.verification.status === status && agency.verification.reason === (reason ?? null)) return agency;
    const next: AgencyDoc = { ...agency, verification: reviewed(agency.verification, status, r, reason?.trim() ?? null), updatedAt: r.now.toISOString() };
    tx.set(C.agencies, agencyId, next);
    notify(
      tx,
      status === "verified"
        ? { userId: agency.ownerUserId, role: "agency", kind: "agency_verified", title: "Your agency is verified", body: "You can now publish trips and accept bookings.", link: { type: "profile", id: agencyId } }
        : { userId: agency.ownerUserId, role: "agency", kind: "agency_rejected", title: "Verification needs attention", body: `Reason: ${reason}. Update your documents and resubmit.`, link: { type: "profile", id: agencyId } },
      r.now,
    );
    return next;
  });
}

async function decideDriver(r: ReviewerCtx, driverId: string, status: "verified" | "rejected", reason: string | null): Promise<DriverDoc> {
  if (status === "rejected" && (!reason || reason.trim().length < 3)) throw new DomainError("invalid_request", "Give a reason (at least 3 characters).", { fields: { reason: "Required" } });
  return getDocStore().runTransaction(async (tx) => {
    const driver = await tx.get<DriverDoc>(C.drivers, driverId);
    if (!driver) throw new DomainError("not_found");
    const next: DriverDoc = { ...driver, verification: reviewed(driver.verification, status, r, reason?.trim() ?? null), updatedAt: r.now.toISOString() };
    tx.set(C.drivers, driverId, next);
    notify(
      tx,
      status === "verified"
        ? { userId: driverId, role: "driver", kind: "driver_verified", title: "Your documents are verified", body: "Your licence and Aadhaar were checked by TAKI.", link: { type: "profile", id: driverId } }
        : { userId: driverId, role: "driver", kind: "driver_rejected", title: "Document check failed", body: `Reason: ${reason}. Please re-upload your documents.`, link: { type: "profile", id: driverId } },
      r.now,
    );
    return next;
  });
}

export const verification = {
  verifyAgency: (r: ReviewerCtx, agencyId: string) => decideAgency(r, agencyId, "verified", null),
  rejectAgency: (r: ReviewerCtx, agencyId: string, reason: string) => decideAgency(r, agencyId, "rejected", reason),
  verifyDriver: (r: ReviewerCtx, driverId: string) => decideDriver(r, driverId, "verified", null),
  rejectDriver: (r: ReviewerCtx, driverId: string, reason: string) => decideDriver(r, driverId, "rejected", reason),
  /** Pending queues for the admin page (oldest first). */
  async pendingAgencies(limit = 50): Promise<AgencyDoc[]> {
    return getDocStore().query<AgencyDoc>(C.agencies, { where: [["verification.status", "==", "pending"]], orderBy: [["createdAt", "desc"]], limit });
  },
  async pendingDrivers(limit = 50): Promise<DriverDoc[]> {
    return getDocStore().query<DriverDoc>(C.drivers, { where: [["verification.status", "==", "pending"]], orderBy: [["createdAt", "desc"]], limit });
  },
};
