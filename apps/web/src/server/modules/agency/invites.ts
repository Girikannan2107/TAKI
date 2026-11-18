import "server-only";
/**
 * Driver invites (P2 §3.8 invite path). The agency invites a phone number; when a driver signs up
 * with that number (D1 signup reads the invite) the link is active immediately. Invites last 14 days.
 * An SMS is queued through the outbox (sent only when an SMS provider is configured).
 */
import { DriverInviteBody, type DriverInviteInput, type InviteDTO } from "@/lib/api/contracts/agency";
import { DomainError } from "@/lib/api/contracts/errors";
import { newId } from "@/lib/domain/ids";
import { enqueueJob } from "@/server/core";
import type { SessionContext } from "@/server/auth/guards";
import { phoneIndexKey } from "@/server/auth/accounts";
import { C, getDocStore } from "@/server/db";
import type { AgencyDoc, DriverDoc, DriverInviteDoc, PhoneIndexDoc } from "@/server/db/schema";
import { toInviteDTO } from "@/server/views/agency";
import { agencyIdOf, fieldError } from "./shared";

export const INVITE_TTL_DAYS = 14;

export async function listInvites(session: SessionContext, now: Date): Promise<{ items: InviteDTO[] }> {
  const agencyId = agencyIdOf(session);
  const rows = await getDocStore().query<DriverInviteDoc>(C.driverInvites, {
    where: [["agencyId", "==", agencyId], ["status", "==", "pending"]],
    orderBy: [["createdAt", "desc"], ["__name__", "desc"]],
    limit: 100,
  });
  return { items: rows.map((r) => toInviteDTO(r, now)) };
}

export async function createInvite(session: SessionContext, raw: DriverInviteInput, now: Date): Promise<InviteDTO> {
  const agencyId = agencyIdOf(session);
  const body = DriverInviteBody.parse(raw);
  const at = now.toISOString();
  const invite = await getDocStore().runTransaction(async (tx) => {
    const [agency, phoneIdx, existing] = await Promise.all([
      tx.get<AgencyDoc>(C.agencies, agencyId),
      tx.get<PhoneIndexDoc>(C.phoneIndex, phoneIndexKey(body.phone)),
      tx.query<DriverInviteDoc>(C.driverInvites, { where: [["phone", "==", body.phone], ["status", "==", "pending"]], limit: 20 }),
    ]);
    if (!agency) throw new DomainError("not_found");
    // One phone number = one account (any role).
    if (phoneIdx && phoneIdx.role !== "driver")
      throw fieldError("phone_taken", "phone", "This number is already registered to a TAKI account that isn't a driver. Use another number.");
    if (phoneIdx) {
      const driver = await tx.get<DriverDoc>(C.drivers, phoneIdx.userId);
      const mine = driver?.agencyLink?.agencyId === agencyId && driver.agencyLink.status !== "removed" && driver.agencyLink.status !== "rejected";
      throw fieldError(
        "phone_taken",
        "phone",
        mine ? "This driver is already linked to your agency." : "This number already has a TAKI driver account. Ask the driver to request your agency from their profile.",
      );
    }
    const live = existing.filter((i) => Date.parse(i.expiresAt) > now.getTime());
    if (live.some((i) => i.agencyId === agencyId)) throw fieldError("already_exists", "phone", "You've already invited this number.");
    if (live.length > 0) throw fieldError("already_exists", "phone", "This number has a pending invite from another agency.");
    const doc: DriverInviteDoc = {
      id: newId("inv"),
      agencyId,
      agencyName: agency.agencyName,
      phone: body.phone,
      fullName: body.fullName,
      status: "pending",
      expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
      driverId: null,
      createdAt: at,
      updatedAt: at,
    };
    tx.create(C.driverInvites, doc.id, doc);
    enqueueJob(tx, "sms", { to: body.phone, templateId: "driver_invite", vars: { agencyName: agency.agencyName, name: body.fullName } }, now);
    return doc;
  });
  return toInviteDTO(invite, now);
}

export async function revokeInvite(session: SessionContext, inviteId: string, now: Date): Promise<void> {
  const agencyId = agencyIdOf(session);
  await getDocStore().runTransaction(async (tx) => {
    const inv = await tx.get<DriverInviteDoc>(C.driverInvites, inviteId);
    if (!inv || inv.agencyId !== agencyId) throw new DomainError("not_found");
    if (inv.status !== "pending") return;
    tx.update(C.driverInvites, inviteId, { status: "revoked", updatedAt: now.toISOString() });
  });
}
