"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PackageCheck, Route } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, EmptyState, Tabs, useToast } from "@/components/ui";
import type { DriverShipmentListItem, DriverShipmentTab } from "@/lib/api/contracts/driver";
import { driverApi } from "@/lib/api/client/driver";
import { errorMessage } from "@/lib/api/http";
import { paths, type DriverShipmentsTab } from "@/lib/config/routes";
import { formatDateTime } from "@/lib/format";
import { isUrlTab, URL_TO_API_TAB } from "./labels";
import { ListSkeleton, LoadError, NotLinkedNotice, ShipmentCard } from "./parts";
import { useResource } from "./useResource";

const TABS: Array<{ value: DriverShipmentsTab; label: string }> = [
  { value: "pickup", label: "To pick up" },
  { value: "transit", label: "In transit" },
  { value: "delivered", label: "Delivered" },
];

const EMPTY: Record<DriverShipmentTab, { title: string; description: string }> = {
  pending_pickup: { title: "Nothing to pick up", description: "Paid shipments on your trips appear here until you collect them." },
  in_transit: { title: "Nothing on the road", description: "Shipments you have picked up appear here until they are delivered." },
  delivered: { title: "No deliveries yet", description: "Shipments you deliver appear here and in your history." },
};

interface Group {
  tripId: string;
  routeLabel: string;
  departureAt: string;
  items: DriverShipmentListItem[];
}

function groupByTrip(items: readonly DriverShipmentListItem[]): Group[] {
  const map = new Map<string, Group>();
  for (const it of items) {
    let g = map.get(it.tripId);
    if (!g) {
      g = { tripId: it.tripId, routeLabel: it.trip.routeLabel, departureAt: it.trip.departureAt, items: [] };
      map.set(it.tripId, g);
    }
    g.items.push(it);
  }
  return [...map.values()];
}

/** Assigned Shipments (P3 §4.5): 3 tabs, grouped by trip; tap → action screen. */
export function DriverShipmentsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get("tab");
  const tab: DriverShipmentsTab = isUrlTab(raw) ? raw : "pickup";
  const apiTab = URL_TO_API_TAB[tab];

  const { state, reload } = useResource((signal) => driverApi.shipments(apiTab, null, signal), apiTab);

  return (
    <div className="flex w-full flex-col gap-5">
      <PageHeader title="Assigned shipments" subtitle="Everything assigned to you, grouped by trip." className="mb-0 lg:mb-0" />
      {state.status === "error" && state.code === "driver_not_linked" ? (
        <NotLinkedNotice />
      ) : (
        <>
        <Tabs
          ariaLabel="Shipment status"
          panelId="shipments-panel"
          value={tab}
          items={TABS}
          onChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })}
        />
        <div id="shipments-panel" role="tabpanel" aria-label={TABS.find((t) => t.value === tab)!.label}>
          {state.status === "loading" ? (
            <ListSkeleton label="Loading shipments…" />
          ) : state.status === "error" ? (
            <LoadError message={state.message} onRetry={reload} />
          ) : state.data.items.length === 0 ? (
            <EmptyState icon={<PackageCheck />} title={EMPTY[apiTab].title} description={EMPTY[apiTab].description} />
          ) : (
            <ShipmentGroups key={apiTab} tab={apiTab} first={state.data.items} firstCursor={state.data.nextCursor} />
          )}
        </div>
        </>
      )}
    </div>
  );
}

function ShipmentGroups({ tab, first, firstCursor }: { tab: DriverShipmentTab; first: DriverShipmentListItem[]; firstCursor: string | null }) {
  const { toast } = useToast();
  const [more, setMore] = useState<DriverShipmentListItem[]>([]);
  const [cursor, setCursor] = useState(firstCursor);
  const [loading, setLoading] = useState(false);
  const groups = groupByTrip([...first, ...more]);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await driverApi.shipments(tab, cursor);
      setMore((m) => [...m, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      toast({ title: "Couldn't load more", description: errorMessage(e), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.tripId} aria-labelledby={`trip-${g.tripId}`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id={`trip-${g.tripId}`} className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Route aria-hidden="true" className="size-4 text-green-700" />
              {g.routeLabel}
              <span className="font-normal text-ink-muted">· departs {formatDateTime(g.departureAt)}</span>
            </h2>
            <Link href={paths.driver.trip(g.tripId)} className="inline-flex min-h-11 items-center text-sm font-semibold text-green-700 underline-offset-4 hover:underline">
              Open trip
            </Link>
          </div>
          <ul className="grid gap-3 lg:grid-cols-2">
            {g.items.map((s) => (
              <li key={s.bookingId} className="flex min-w-0 [&>*]:w-full">
                <ShipmentCard item={s} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {cursor ? (
        <Button variant="outline" onClick={() => void loadMore()} loading={loading} className="self-center">
          Load more
        </Button>
      ) : null}
    </div>
  );
}
