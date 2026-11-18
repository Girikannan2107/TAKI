import type { SessionUserDTO } from "@/lib/api/contracts/auth";
import { DomainError } from "@/lib/api/contracts/errors";
import { handler } from "@/server/http/handler";
import { sessionUserFor } from "@/server/modules/auth/session-user";

/** GET /api/me — the signed-in user (SessionUserDTO); 401 when signed out. `GET /api/auth/session` is the never-401 variant. */
export const GET = handler({ auth: "any" }, async ({ session }): Promise<SessionUserDTO> => {
  const user = await sessionUserFor(session);
  if (!user) throw new DomainError("unauthenticated");
  return user;
});
