import "server-only";
/**
 * Driver profile (P2 §8.6): D1's shared account profile (details, photo, documents, agency
 * link) plus the driver's reviews; and the driver's request to join an agency.
 */
import type { DriverProfileDTO } from "@/lib/api/contracts/auth";
import type { DriverAppProfileDTO } from "@/lib/api/contracts/driver";
import { DomainError } from "@/lib/api/contracts/errors";
import type { SessionContext } from "@/server/auth/guards";
import { listReviews, notify } from "@/server/core";
import { C, getDocStore } from "@/server/db";
import type { AgencyDoc, DriverAgencyLink, DriverDoc } from "@/server/db/schema";
import { getProfile, patchProfile } from "@/server/modules/profile/service";
import { toReviewDTO } from "@/server/views/common";
import { loadDriver } from "./access";

const REVIEWS_SHOWN = 20;

async function accountOf(session: SessionContext): Promise<DriverProfileDTO> {
  const p = await getProfile(session);
  if (p.role !== "driver") throw new DomainError("forbidden");
  return p;
}

export async function getDriverProfile(session: SessionContext): Promise<DriverAppProfileDTO> {
  await loadDriver(session);
  const [account, reviews] = await Promise.all([
    accountOf(session),
    listReviews(getDocStore(), { driverId: session.userId }, { limit: REVIEWS_SHOWN }),
  ]);
  return { account, reviews: reviews.map(toReviewDTO) };
}

export async function updateDriverProfile(session: SessionContext, body: { fullName: string }, now: Date): Promise<DriverAppProfileDTO> {
  await loadDriver(session);
  await patchProfile(session, body, now);
  return getDriverProfile(session);
}

/**
 * The driver asks to join (another) agency. Allowed when there is no link, or the previous one
 * was rejected/removed, or a pending request should move to a different agency. The agency
 * approves in its Drivers screen (D2); until then the driver app shows the pending state.
 */
export async function requestAgencyLink(session: SessionContext, agencyId: string, now: Date): Promise<DriverAppProfileDTO> {
  await loadDriver(session);
  const at = now.toISOString();
  await getDocStore().runTransaction(async (tx) => {
    const [driver, agency] = await Promise.all([tx.get<DriverDoc>(C.drivers, session.userId), tx.get<AgencyDoc>(C.agencies, agencyId)]);
    if (!driver) throw new DomainError("not_found");
    if (!agency || agency.verification.status !== "verified") throw new DomainError("not_found", "Choose a verified agency from the list.");
    const cur = driver.agencyLink;
    if (cur?.status === "active") {
      throw new DomainError("conflict", `You're already linked to ${cur.agencyName}. Ask them to remove you before joining another agency.`);
    }
    if (cur?.status === "pending" && cur.agencyId === agencyId) return; // idempotent
    const link: DriverAgencyLink = { agencyId, agencyName: agency.agencyName, status: "pending", via: "request", requestedAt: at, decidedAt: null };
    tx.update(C.drivers, driver.id, { agencyLink: link, updatedAt: at });
    notify(
      tx,
      {
        userId: agency.ownerUserId,
        role: "agency",
        kind: "driver_link_requested",
        title: "New driver request",
        body: `${driver.fullName} asked to join ${agency.agencyName} as a driver.`,
        link: { type: "driver", id: driver.id },
      },
      now,
    );
  });
  return getDriverProfile(session);
}
