import "server-only";
/** Customer dashboard read model (D3): tab counts, active bookings, unbooked shipments, recent activity. */
import type { CustomerDashboardDTO } from "@/lib/api/contracts/customer";
import { firstName } from "../../views/common";
import type { SessionContext } from "../../auth/guards";
import { listNotifications } from "../../core/notify";
import { C } from "../../db/collections";
import { getDocStore } from "../../db";
import type { CustomerDoc } from "../../db/schema";
import { listBookings, tabCounts } from "./bookings";
import { listShipments } from "./shipments";
import { toCustomerNotification } from "../../views/customer";

const ACTIVE_LIMIT = 5;
const OPEN_LIMIT = 5;
const ACTIVITY_LIMIT = 6;

export async function customerDashboard(session: SessionContext): Promise<CustomerDashboardDTO> {
  const store = getDocStore();
  const [customer, counts, active, open, activity] = await Promise.all([
    store.get<CustomerDoc>(C.customers, session.userId),
    tabCounts(session),
    listBookings(session, { active: true, limit: ACTIVE_LIMIT }),
    listShipments(session, { limit: OPEN_LIMIT }),
    listNotifications(store, session.userId, { limit: ACTIVITY_LIMIT }),
  ]);
  return {
    firstName: customer ? firstName(customer.fullName) : "",
    counts,
    active: active.items,
    openShipments: open.items,
    recentActivity: activity.map(toCustomerNotification),
  };
}
