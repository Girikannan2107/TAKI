import "server-only";
import type { SessionUserDTO } from "@/lib/api/contracts/auth";
import { fileUrl } from "@/lib/api/contracts/common";
import { C, getDocStore } from "@/server/db";
import type { AgencyDoc, CustomerDoc, DriverDoc, UserDoc } from "@/server/db/schema";
import type { SessionContext } from "@/server/auth/guards";
import { maskPhone } from "@/server/auth/otp";

/** The signed-in user as the browser sees it (GET /api/auth/session, login and signup responses). */
export async function buildSessionUser(user: UserDoc): Promise<SessionUserDTO> {
  const store = getDocStore();
  const base: SessionUserDTO = {
    id: user.id,
    role: user.role,
    name: user.displayName,
    phoneMasked: maskPhone(user.phone),
    photoUrl: null,
  };
  switch (user.role) {
    case "customer": {
      const c = await store.get<CustomerDoc>(C.customers, user.id);
      return { ...base, name: c?.fullName ?? base.name, photoUrl: c?.photo ? fileUrl(c.photo.fileId) : null };
    }
    case "agency": {
      const a = user.agencyId ? await store.get<AgencyDoc>(C.agencies, user.agencyId) : null;
      if (!a) return base;
      return {
        ...base,
        name: a.ownerName,
        photoUrl: a.photo ? fileUrl(a.photo.fileId) : null,
        agency: { id: a.id, name: a.agencyName, verification: a.verification.status, reason: a.verification.reason },
      };
    }
    case "driver": {
      const d = await store.get<DriverDoc>(C.drivers, user.id);
      if (!d) return base;
      return {
        ...base,
        name: d.fullName,
        photoUrl: d.photo ? fileUrl(d.photo.fileId) : null,
        driver: {
          agencyLink: d.agencyLink ? { agencyId: d.agencyLink.agencyId, agencyName: d.agencyLink.agencyName, status: d.agencyLink.status } : null,
          verification: d.verification.status,
        },
      };
    }
    case "admin":
      return base;
  }
}

export async function sessionUserFor(ctx: SessionContext): Promise<SessionUserDTO | null> {
  const user = await getDocStore().get<UserDoc>(C.users, ctx.userId);
  return user ? buildSessionUser(user) : null;
}
