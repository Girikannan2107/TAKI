"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, Skeleton } from "@/components/ui";
import { paths } from "@/lib/config/routes";
import { addDaysIso, todayIst } from "@/lib/domain/dates";
import { useHydrated } from "@/lib/hooks/useHydrated";
import {
  shipmentToFormValues,
  toShipment,
  type ShipmentFormValues,
} from "@/lib/schemas/shipment-search.schema";
import { useTakiStore } from "@/lib/store";
import { useSession } from "@/lib/store/selectors";
import { getNow } from "@/lib/utils/clock";
import { RecentShipments } from "./RecentShipments";
import { ShipmentForm } from "./ShipmentForm";

const DEFAULT_ROUTE = { from: "coimbatore", to: "chennai", weightKg: 500 } as const;

export function DashboardView() {
  const hydrated = useHydrated();
  const { user } = useSession();

  return (
    <>
      <TopBar
        title={user ? `Hi, ${user.firstName}` : hydrated ? "Hi there" : <Skeleton className="h-9 w-48" />}
        emoji={user ? "👋" : undefined}
        subtitle="Where are we shipping today?"
      />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,720px)_minmax(0,1fr)] xl:gap-8">
        <Card as="section" padding="lg" aria-labelledby="new-shipment-heading" className="w-full max-w-[720px]">
          <h2 id="new-shipment-heading" className="type-h3 mb-5 text-ink">
            New Shipment
          </h2>
          {hydrated ? <NewShipmentForm /> : <FormSkeleton />}
        </Card>
        {hydrated ? <RecentShipments className="w-full max-w-[720px] xl:max-w-none" /> : null}
      </div>
    </>
  );
}

function NewShipmentForm() {
  const router = useRouter();
  const search = useTakiStore((s) => s.search);
  const setSearch = useTakiStore((s) => s.setSearch);
  // Computed once on mount (after hydration) so defaults don't shift while typing.
  const [{ today, defaults }] = useState(() => {
    const t = todayIst(getNow());
    const tomorrow = addDaysIso(t, 1);
    const values: ShipmentFormValues = search
      ? { ...shipmentToFormValues(search), date: search.pickupDate >= t ? search.pickupDate : tomorrow }
      : { from: DEFAULT_ROUTE.from, to: DEFAULT_ROUTE.to, weight: String(DEFAULT_ROUTE.weightKg), unit: "kg", date: tomorrow, cargo: "general_goods" };
    return { today: t, defaults: values };
  });

  return (
    <ShipmentForm
      today={today}
      defaultValues={defaults}
      onSubmit={(values) => {
        const shipment = toShipment(values);
        setSearch(shipment);
        router.push(
          paths.customer.vehicles({
            from: shipment.sourceCityId,
            to: shipment.destinationCityId,
            weight: shipment.weightKg,
            date: shipment.pickupDate,
            cargo: shipment.cargoType,
          }),
        );
      }}
    />
  );
}

function FormSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <span className="sr-only">Loading shipment form…</span>
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-12" />
        </div>
      ))}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-12" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-1 h-13" />
    </div>
  );
}
