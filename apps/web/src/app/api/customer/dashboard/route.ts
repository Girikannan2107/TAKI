import { handler } from "@/server/http/handler";
import { customerDashboard } from "@/server/modules/customer/dashboard";

/** GET /api/customer/dashboard — CustomerDashboardDTO. */
export const GET = handler({ auth: "customer" }, ({ session }) => customerDashboard(session));
