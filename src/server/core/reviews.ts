import "server-only";
/** Review read side (writes happen in bookings.review). */
import { C } from "../db/collections";
import type { DocStore } from "../db/docstore";
import type { ReviewDoc } from "../db/schema";

export async function listReviews(
  store: DocStore,
  by: { driverId: string } | { agencyId: string },
  opts: { limit: number; startAfter?: unknown[] },
): Promise<ReviewDoc[]> {
  const where = "driverId" in by ? ([["driverId", "==", by.driverId]] as const) : ([["agencyId", "==", by.agencyId]] as const);
  return store.query<ReviewDoc>(C.reviews, { where, orderBy: [["createdAt", "desc"], ["__name__", "desc"]], limit: opts.limit, startAfter: opts.startAfter });
}

/** New running average after adding one rating. */
export function addRating(avg: number, count: number, rating: number): { ratingAvg: number; ratingCount: number } {
  const ratingCount = count + 1;
  return { ratingAvg: Math.round(((avg * count + rating) / ratingCount) * 100) / 100, ratingCount };
}
