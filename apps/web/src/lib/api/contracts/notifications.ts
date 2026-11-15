/** Notifications + reviews API contract (P2 §8.8). Isomorphic. */
import { z } from "zod";
import { CursorQuery, IdSchema, QueryBool } from "./common";

export type { NotificationDTO, ReviewDTO, Page } from "./common";

export const NotificationsQuery = CursorQuery.extend({ unreadOnly: QueryBool });
export const MarkReadBody = z.union([
  z.object({ ids: z.array(IdSchema("ntf")).min(1).max(50) }),
  z.object({ all: z.literal(true) }),
]);
export interface UnreadCountResponse {
  count: number;
}

export const ReviewsQuery = CursorQuery.extend({
  driverId: IdSchema("usr").optional(),
  agencyId: IdSchema("agc").optional(),
}).refine((q) => Boolean(q.driverId) !== Boolean(q.agencyId), { message: "Pass exactly one of driverId or agencyId", path: ["driverId"] });
