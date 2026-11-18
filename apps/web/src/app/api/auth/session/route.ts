import type { SessionResponseDTO } from "@/lib/api/contracts/auth";
import { handler } from "@/server/http/handler";
import { sessionUserFor } from "@/server/modules/auth/session-user";

/** GET /api/auth/session — { user: SessionUserDTO | null }. */
export const GET = handler({ auth: "public" }, async ({ session }): Promise<SessionResponseDTO> => ({
  user: session ? await sessionUserFor(session) : null,
}));
