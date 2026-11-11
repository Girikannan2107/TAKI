"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PackageOpen } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ButtonLink, Card, EmptyState, Skeleton, Tabs } from "@/components/ui";
import { paths } from "@/lib/config/routes";
import { shipmentGroup } from "@/lib/domain/booking-machine";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { useCustomerBookings } from "@/lib/store/selectors";
import { ShipmentListItem } from "./ShipmentListItem";

type Tab = "active" | "completed" | "cancelled";

const TABS: Array<{ value: Tab; label: string; empty: string }> = [
  { value: "active", label: "Active", empty: "No active shipments" },
  { value: "completed", label: "Completed", empty: "No completed shipments yet" },
  { value: "cancelled", label: "Cancelled", empty: "No cancelled shipments" },
];

function toTab(v: string | null): Tab {
  return TABS.some((t) => t.value === v) ? (v as Tab) : "active";
}

const PANEL_ID = "shipments-panel";
const PAGE = "mx-auto w-full max-w-[960px] lg:mx-0";

export function ShipmentsView() {
  const hydrated = useHydrated();
  return hydrated ? <ShipmentsList /> : <ShipmentsSkeleton />;
}

function Header() {
  return (
    <PageHeader
      title="My Shipments"
      subtitle="Track deliveries and finish any pending payments."
      actions={
        <ButtonLink href={paths.customer.dashboard} size="md">
          Ship goods
        </ButtonLink>
      }
    />
  );
}

function ShipmentsList() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const tab = toTab(params.get("tab"));
  const bookings = useCustomerBookings();

  const groups = useMemo(() => {
    const g: Record<Tab, typeof bookings> = { active: [], completed: [], cancelled: [] };
    for (const d of bookings) g[shipmentGroup(d.booking.status)].push(d);
    return g;
  }, [bookings]);

  function onTabChange(value: string) {
    const q = new URLSearchParams(params.toString());
    if (value === "active") q.delete("tab");
    else q.set("tab", value);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  if (bookings.length === 0) {
    return (
      <div className={PAGE}>
        <PageHeader title="My Shipments" />
        <EmptyState
          icon={<PackageOpen strokeWidth={1.75} />}
          title="No shipments yet"
          description="Find a vehicle already travelling your way and book space for your goods."
          action={{ label: "Ship goods", href: paths.customer.dashboard }}
        />
      </div>
    );
  }

  const items = groups[tab];
  const current = TABS.find((t) => t.value === tab)!;

  return (
    <div className={PAGE}>
      <Header />
      <Tabs
        items={TABS.map((t) => ({ value: t.value, label: t.label, count: groups[t.value].length }))}
        value={tab}
        onChange={onTabChange}
        ariaLabel="Filter shipments"
        panelId={PANEL_ID}
        className="mb-5"
      />
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={`${PANEL_ID}-tab-${tab}`} tabIndex={0} className="rounded-lg">
        {items.length === 0 ? (
          <EmptyState
            icon={<PackageOpen strokeWidth={1.75} />}
            title={current.empty}
            description={tab === "active" ? "Book a vehicle to start a new shipment." : undefined}
            action={tab === "active" ? { label: "Ship goods", href: paths.customer.dashboard } : undefined}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((d) => (
              <ShipmentListItem key={d.booking.id} details={d} headingLevel={2} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ShipmentsSkeleton() {
  return (
    <div className={PAGE} aria-busy="true">
      <span className="sr-only">Loading shipments…</span>
      <Skeleton className="mb-8 h-8 w-48" />
      <Skeleton rounded="full" className="mb-5 h-11 w-80 max-w-full" />
      <ul className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Card as="li" key={i} padding="sm" className="flex flex-col gap-2.5">
            <Skeleton className="h-5 w-56 max-w-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </Card>
        ))}
      </ul>
    </div>
  );
}
