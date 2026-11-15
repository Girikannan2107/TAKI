import "server-only";
/** Driver dashboard read model (P2 §8.6, P3 §4.5). Only real records; nothing is pre-filled. */
import { fileUrl } from "@/lib/api/contracts/common";
import type { DriverDashboardDTO } from "@/lib/api/contracts/driver";
import type { SessionContext } from "@/server/auth/guards";
import { C, getDocStore } from "@/server/db";
import type { BookingDoc } from "@/server/db/schema";
import { toDriverTripListItem } from "@/server/views/driver";
import { isApproved, loadDriver } from "./access";
import { TAB_STATUSES, toListItems } from "./shipments";
import { queryDriverTrips } from "./trips";

export async function getDashboard(session: SessionContext): Promise<DriverDashboardDTO> {
  const driver = await loadDriver(session);
  const link = driver.agencyLink;
  const base: DriverDashboardDTO = {
    driver: { fullName: driver.fullName, photoUrl: driver.photo ? fileUrl(driver.photo.fileId) : null },
    agency: link ? { agencyId: link.agencyId, agencyName: link.agencyName, status: link.status } : null,
    approved: isApproved(driver),
    activeTrips: 0,
    pendingPickups: 0,
    inTransit: 0,
    completedDeliveries: 0,
    nextTrip: null,
    nextActions: [],
  };
  // Until the agency approves the driver, nothing else is shown (P3 §4.5).
  if (!base.approved) return base;

  const store = getDocStore();
  const me = session.userId;
  const [activeTrips, pendingPickups, inTransit, completedDeliveries, running, upcoming, toPick] = await Promise.all([
    store.count(C.trips, {
      where: [
        ["driverId", "==", me],
        ["status", "in", ["published", "in_progress"]],
      ],
    }),
    store.count(C.bookings, { where: [["driverId", "==", me], ["status", "==", "confirmed"]] }),
    store.count(C.bookings, { where: [["driverId", "==", me], ["status", "in", TAB_STATUSES.in_transit]] }),
    store.count(C.bookings, { where: [["driverId", "==", me], ["status", "==", "delivered"]] }),
    queryDriverTrips(me, "in_progress", "asc", 1),
    queryDriverTrips(me, "published", "asc", 1),
    store.query<BookingDoc>(C.bookings, {
      where: [
        ["driverId", "==", me],
        ["status", "==", "confirmed"],
      ],
      orderBy: [
        ["updatedAt", "desc"],
        ["__name__", "desc"],
      ],
      limit: 30,
    }),
  ]);

  const nextTripDoc = running[0] ?? upcoming[0] ?? null;
  const soonest = [...toPick].sort((a, b) => (a.pickup.expectedDepartureAt < b.pickup.expectedDepartureAt ? -1 : 1)).slice(0, 5);
  return {
    ...base,
    activeTrips,
    pendingPickups,
    inTransit,
    completedDeliveries,
    nextTrip: nextTripDoc ? toDriverTripListItem(nextTripDoc) : null,
    nextActions: await toListItems(soonest),
  };
}
