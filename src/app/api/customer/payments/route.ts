import { CursorQuery } from "@/lib/api/contracts/common";
import { handler } from "@/server/http/handler";
import { listPayments } from "@/server/modules/customer/payments";

/** GET /api/customer/payments — the customer's payment history (read-only). */
export const GET = handler({ auth: "customer", query: CursorQuery }, ({ session, query }) => listPayments(session, query));
