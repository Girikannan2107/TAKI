import { handler } from "@/server/http/handler";
import { overview } from "@/server/modules/admin/service";

/** GET /api/admin/overview — review queue counts + pending settlements summary. */
export const GET = handler({ auth: "admin" }, ({ session }) => overview(session));
