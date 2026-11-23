"use client";

import { useState } from "react";
import { MessageSquareQuote } from "lucide-react";
import { Button, Card, Rating, Skeleton } from "@/components/ui";
import type { ReviewDTO } from "@/lib/api/contracts/common";
import { agencyApi } from "@/lib/api/client/agency";
import { errorMessage } from "@/lib/api/http";
import { formatInstantDate } from "@/lib/format";
import { useApi } from "./useApi";

export interface AgencyReviewsCardProps {
  agencyId: string;
  ratingAvg: number;
  ratingCount: number;
}

/** M6: what customers said about this agency (E107 GET /reviews?agencyId=), newest first, 10 per page. */
export function AgencyReviewsCard({ agencyId, ratingAvg, ratingCount }: AgencyReviewsCardProps) {
  const { state, reload } = useApi(`agency-reviews:${agencyId}`, () => agencyApi.reviews(agencyId));
  const [more, setMore] = useState<{ items: ReviewDTO[]; cursor: string | null; loading: boolean; error: string | null }>({
    items: [],
    cursor: null,
    loading: false,
    error: null,
  });

  const items = state.status === "ready" ? [...state.data.items, ...more.items] : [];
  const cursor = more.items.length ? more.cursor : state.status === "ready" ? state.data.nextCursor : null;

  async function loadMore() {
    if (!cursor) return;
    setMore((m) => ({ ...m, loading: true, error: null }));
    try {
      const page = await agencyApi.reviews(agencyId, cursor);
      setMore((m) => ({ items: [...m.items, ...page.items], cursor: page.nextCursor, loading: false, error: null }));
    } catch (e) {
      setMore((m) => ({ ...m, loading: false, error: errorMessage(e) }));
    }
  }

  return (
    <Card as="section" aria-labelledby="reviews-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="reviews-title" className="type-h3 flex items-center gap-2 text-ink">
          <MessageSquareQuote aria-hidden="true" strokeWidth={1.75} className="size-5 text-green-600" /> Reviews
        </h2>
        {ratingCount > 0 ? <Rating value={ratingAvg} count={ratingCount} countLabel="reviews" /> : null}
      </div>

      {state.status === "loading" ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Loading reviews…</span>
          <Skeleton className="h-16 w-full" rounded="md" />
          <Skeleton className="h-16 w-full" rounded="md" />
        </div>
      ) : state.status === "error" ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-error">
          <span>We couldn&apos;t load your reviews. {state.message}</span>
          <Button variant="ghost" size="sm" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-muted">No reviews yet. Customers can rate a delivery once it is complete.</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border">
            {items.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-3 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Rating value={r.rating} />
                  <span className="text-xs text-ink-subtle">
                    {r.customerFirstName} · {formatInstantDate(r.createdAt)} · Booking {r.bookingId}
                  </span>
                </div>
                {r.comment ? <p className="text-sm text-ink">{r.comment}</p> : null}
              </li>
            ))}
          </ul>
          {more.error ? <p className="mt-2 text-sm text-error">{more.error}</p> : null}
          {cursor ? (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => void loadMore()} loading={more.loading}>
              Show more reviews
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}
