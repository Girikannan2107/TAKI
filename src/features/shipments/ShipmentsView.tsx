"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PackageOpen, PackagePlus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, ButtonLink, Card, EmptyState, Skeleton, Tabs } from "@/components/ui";
import { customerApi } from "@/lib/api/client/customer";
import type { CustomerBookingListItem } from "@/lib/api/contracts/customer";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import type { CustomerTab } from "@/lib/domain/model";
import { CUSTOMER_TAB_ITEMS, isCustomerTab } from "@/features/customer-shipment/labels";
import { LoadError } from "@/features/customer-shipment/LoadError";
import { useApi } from "@/features/customer-shipment/use-api";
import { ShipmentListItem } from "./ShipmentListItem";

const PANEL_ID = "shipments-panel";
const PAGE = "w-full";
const PAGE_SIZE = 20;

/** First non-empty of Pending, Confirmed, In Transit; otherwise Pending (P3 §4.3). */
function defaultTab(counts: Record<CustomerTab, number> | undefined): CustomerTab {
  if (!counts) return "pending";
  return (["pending", "confirmed", "in_transit"] as const).find((t) => counts[t] > 0) ?? "pending";
}

export function ShipmentsView() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const requested = params.get("tab");
  const counts = useApi("customer:booking-counts", (signal) => customerApi.bookingCounts(signal));

  const explicit = isCustomerTab(requested) ? requested : null;
  // Without ?tab we wait for the counts so the default tab doesn't jump.
  const tab: CustomerTab | null = explicit ?? (counts.loading ? null : defaultTab(counts.data));

  function onTabChange(value: string) {
    const q = new URLSearchParams(params.toString());
    q.set("tab", value);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  return (
    <div className={PAGE}>
      <PageHeader
        title="My Shipments"
        subtitle="Track deliveries, pay for accepted bookings and rate completed ones."
        actions={
          <ButtonLink href={paths.customer.newShipment()} size="md" leadingIcon={<PackagePlus strokeWidth={1.75} />}>
            New Shipment
          </ButtonLink>
        }
      />
      {tab === null ? (
        <TabsSkeleton />
      ) : (
        <>
          <Tabs
            items={CUSTOMER_TAB_ITEMS.map((t) => ({ value: t.value, label: t.label, count: counts.data?.[t.value] }))}
            value={tab}
            onChange={onTabChange}
            ariaLabel="Filter shipments by status"
            panelId={PANEL_ID}
            className="mb-5"
          />
          <div role="tabpanel" id={PANEL_ID} aria-labelledby={`${PANEL_ID}-tab-${tab}`} tabIndex={0} className="rounded-lg">
            <TabList key={tab} tab={tab} onChanged={() => void counts.reload()} />
          </div>
        </>
      )}
    </div>
  );
}

function TabList({ tab, onChanged }: { tab: CustomerTab; onChanged: () => void }) {
  const first = useApi(`customer:bookings:${tab}`, (signal) => customerApi.bookings({ tab, limit: PAGE_SIZE }, signal));
  const [more, setMore] = useState<{ items: CustomerBookingListItem[]; cursor: string | null }>({ items: [], cursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const meta = CUSTOMER_TAB_ITEMS.find((t) => t.value === tab)!;

  if (first.loading) return <ListSkeleton />;
  if (first.error || !first.data)
    return (
      <LoadError
        error={first.error}
        title="We couldn't load your shipments"
        onRetry={() => {
          onChanged();
          void first.reload();
        }}
      />
    );

  const items = [...first.data.items, ...more.items];
  const cursor = more.items.length ? more.cursor : first.data.nextCursor;

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await customerApi.bookings({ tab, cursor, limit: PAGE_SIZE });
      setMore((m) => ({ items: [...m.items, ...page.items], cursor: page.nextCursor }));
    } catch (e) {
      setMoreError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  if (items.length === 0) {
    const start = tab === "pending";
    return (
      <EmptyState
        icon={<PackageOpen strokeWidth={1.75} />}
        title={meta.empty}
        description={meta.hint}
        action={start ? { label: "New Shipment", href: paths.customer.newShipment() } : undefined}
      />
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {items.map((b) => (
          <ShipmentListItem key={b.id} item={b} headingLevel={2} />
        ))}
      </ul>
      {cursor ? (
        <div className="mt-5 flex flex-col items-center gap-2">
          <Button variant="outline" onClick={() => void loadMore()} loading={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
          {moreError ? (
            <p role="alert" className="text-sm text-error">
              {moreError}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function TabsSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading shipments…</span>
      <Skeleton rounded="full" className="mb-5 h-11 w-[36rem] max-w-full" />
      <ListSkeleton />
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="flex flex-col gap-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <Card as="li" key={i} padding="sm" className="flex flex-col gap-2.5">
          <Skeleton className="h-5 w-56 max-w-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </Card>
      ))}
    </ul>
  );
}
