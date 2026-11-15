import type { Page, ReviewDTO } from "@/lib/api/contracts/common";
import { ReviewsQuery } from "@/lib/api/contracts/notifications";
import { listReviews } from "@/server/core/reviews";
import { getDocStore } from "@/server/db";
import { decodeCursor, pageOf } from "@/server/http/cursor";
import { handler } from "@/server/http/handler";
import { toReviewDTO } from "@/server/views/common";

/** GET /api/reviews?driverId= | ?agencyId= (+ cursor, limit) — customers shown by first name only. */
export const GET = handler({ auth: "any", query: ReviewsQuery }, async ({ query }): Promise<Page<ReviewDTO>> => {
  const by = query.driverId ? { driverId: query.driverId } : { agencyId: query.agencyId! };
  const rows = await listReviews(getDocStore(), by, { limit: query.limit + 1, startAfter: decodeCursor(query.cursor) });
  const page = pageOf(rows, query.limit, (r) => [r.createdAt, r.id]);
  return { items: page.items.map(toReviewDTO), nextCursor: page.nextCursor };
});
