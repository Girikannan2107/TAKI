import { SettleBody } from "@/lib/api/contracts/admin";
import { created, handler } from "@/server/http/handler";
import { listSettlements, settle } from "@/server/modules/admin/service";

/** GET /api/admin/settlements — { items: AdminSettlementRowDTO[], available }. */
export const GET = handler({ auth: "admin" }, ({ session }) => listSettlements(session));

/** POST /api/admin/settlements { agencyId, through, reference } — 201 AdminSettlementResultDTO (marks pending earnings settled). */
export const POST = handler({ auth: "admin", body: SettleBody }, async ({ session, body, now }) => created(await settle(session, body, now)));
