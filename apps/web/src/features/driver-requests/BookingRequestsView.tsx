"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { Button, EmptyState, Skeleton, Tabs, useToast } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { agencyApi } from "@/lib/api/client/agency";
import { AGENCY_BOOKING_TABS, type AgencyBookingListItem, type AgencyBookingTab, type BookingListResponse } from "@/lib/api/contracts/agency";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { AcceptBookingDialog, RejectBookingModal } from "@/features/agency/BookingDecision";
import { LoadError } from "@/features/agency/states";
import { useApi } from "@/features/agency/useApi";
import { BookingRequestCard } from "./BookingRequestCard";

const TAB_META: Record<AgencyBookingTab, { label: string; empty: string; hint: string }> = {
  pending: { label: "Pending", empty: "No pending requests", hint: "New booking requests on your published trips show up here." },
  accepted: { label: "Awaiting payment", empty: "Nothing awaiting payment", hint: "Requests you accept wait here until the customer pays." },
  confirmed: { label: "Confirmed", empty: "No confirmed bookings", hint: "Paid bookings and their delivery progress show up here." },
  rejected: { label: "Rejected", empty: "No rejected requests", hint: "Requests you reject stay here for your records." },
  cancelled: { label: "Cancelled / Expired", empty: "No cancelled bookings", hint: "Bookings cancelled by customers or expired show up here." },
};
const PANEL_ID = "bookings-panel";

export function parseBookingsTab(v: string | null | undefined): AgencyBookingTab {
  return (AGENCY_BOOKING_TABS as readonly string[]).includes(v ?? "") ? (v as AgencyBookingTab) : "pending";
}

/** Bookings (`/agency/bookings?tab=`, P3 §4.4): accept/reject through core; read-only status after confirmation. */
export function BookingRequestsView({ tab: tabParam }: { tab?: string } = {}) {
  const router = useRouter();
  const { toast } = useToast();
  const tab = parseBookingsTab(tabParam);
  const key = `bookings:${tab}`;
  const { state, reload, setData } = useApi<BookingListResponse>(key, () => agencyApi.bookings({ tab, limit: 20 }));
  const [accepting, setAccepting] = useState<AgencyBookingListItem | null>(null);
  const [rejecting, setRejecting] = useState<AgencyBookingListItem | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const header = <PageHeader title="Bookings" subtitle="Accept requests to reserve space; customers pay after you accept." />;

  if (state.status === "loading") {
    return (
      <>
        {header}
        <div aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">Loading bookings…</span>
          <Skeleton className="h-11 w-full max-w-2xl rounded-full" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-lg" />
          ))}
        </div>
      </>
    );
  }
  if (state.status === "error") {
    return (
      <>
        {header}
        <LoadError message={state.message} onRetry={reload} title="We couldn't load your bookings" />
      </>
    );
  }

  const data = state.data;
  const meta = TAB_META[tab];

  function removeFromList(id: string) {
    setData({ ...data, items: data.items.filter((b) => b.id !== id) });
    reload();
  }

  async function loadMore() {
    if (!data.nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await agencyApi.bookings({ tab, cursor: data.nextCursor, limit: 20 });
      setData({ ...res, items: [...data.items, ...res.items.filter((x) => !data.items.some((y) => y.id === x.id))] });
    } catch (e) {
      toast({ title: "Couldn't load more bookings", description: errorMessage(e), tone: "error" });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      {header}
      <Tabs
        ariaLabel="Filter bookings"
        panelId={PANEL_ID}
        value={tab}
        onChange={(v) => router.replace(paths.agency.bookings(parseBookingsTab(v)), { scroll: false })}
        items={AGENCY_BOOKING_TABS.map((t) => ({ value: t, label: TAB_META[t].label, count: data.counts[t] }))}
        className="mb-5"
      />
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={`${PANEL_ID}-tab-${tab}`}>
        {data.items.length === 0 ? (
          <EmptyState icon={<ClipboardList strokeWidth={1.75} />} title={meta.empty} description={meta.hint} />
        ) : (
          <>
            <ul className="flex flex-col gap-4" data-testid="booking-request-list">
              {data.items.map((b) => (
                <BookingRequestCard
                  key={b.id}
                  booking={b}
                  busy={accepting?.id === b.id ? "accept" : rejecting?.id === b.id ? "reject" : null}
                  onAccept={() => setAccepting(b)}
                  onReject={() => setRejecting(b)}
                />
              ))}
            </ul>
            {data.nextCursor ? (
              <div className="mt-5 flex justify-center">
                <Button variant="outline" loading={loadingMore} onClick={loadMore}>
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
      <AcceptBookingDialog
        booking={accepting}
        onClose={() => setAccepting(null)}
        onStale={reload}
        onDone={(b) => {
          setAccepting(null);
          removeFromList(b.id);
        }}
      />
      <RejectBookingModal
        booking={rejecting}
        onClose={() => setRejecting(null)}
        onDone={(b) => {
          setRejecting(null);
          removeFromList(b.id);
        }}
      />
    </>
  );
}
