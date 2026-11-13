import "server-only";
/**
 * Public read/write helpers that need no session: the landing-page contact form
 * (`contactMessages`, plan decision 15) and the verified-agency picker used at driver signup.
 */
import type { PublicAgencyDTO } from "@/lib/api/contracts/auth";
import type { ContactResultDTO } from "@/lib/api/contracts/common";
import { newId } from "@/lib/domain/ids";
import { districtName } from "@/lib/domain/places";
import { getDocStore } from "../db";
import { C } from "../db/collections";
import type { AgencyDoc, ContactMessageDoc } from "../db/schema";
import { piiHashKey } from "../env";
import { hmacHex } from "../http/crypto";

export async function saveContactMessage(i: { name: string; phone?: string; email?: string; role: ContactMessageDoc["role"]; message: string; website?: string }, ip: string, now: Date): Promise<ContactResultDTO> {
  const at = now.toISOString();
  const id = newId("msg");
  // Honeypot filled in: answer like a success, store nothing.
  if (i.website && i.website.trim()) return { id, receivedAt: at };
  const doc: ContactMessageDoc = {
    id,
    name: i.name,
    phone: i.phone ? i.phone : null,
    email: i.email ? i.email.toLowerCase() : null,
    role: i.role,
    message: i.message,
    status: "new",
    ipHash: ip && ip !== "local" ? hmacHex(piiHashKey(), `ip:${ip}`) : null,
    createdAt: at,
    updatedAt: at,
  };
  await getDocStore().batchWrite([{ op: "create", col: C.contactMessages, id, data: doc }]);
  return { id, receivedAt: at };
}

/** Verified agencies by name (driver signup / "request to join" picker). */
export async function listPublicAgencies(q: { q?: string; districtId?: string }, limit = 20): Promise<PublicAgencyDTO[]> {
  const rows = await getDocStore().query<AgencyDoc>(C.agencies, {
    where: [["verification.status", "==", "verified"]],
    orderBy: [["nameLower", "asc"]],
    limit: 500,
  });
  const needle = q.q?.trim().toLowerCase() ?? "";
  return rows
    .filter((a) => (!needle || a.nameLower.includes(needle)) && (!q.districtId || a.districtId === q.districtId))
    .slice(0, limit)
    .map((a) => ({ id: a.id, agencyName: a.agencyName, districtName: districtName(a.districtId), state: a.state }));
}
