"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpDown, SearchX, Truck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonClasses, Card, EmptyState, Select, Skeleton } from "@/components/ui";
import { paths } from "@/lib/config/routes";
import { addDaysIso, todayIst } from "@/lib/domain/dates";
import type { SortKey } from "@/lib/domain/search";
import type { Shipment } from "@/lib/domain/types";
import { formatDate, formatKg } from "@/lib/format";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { isValidShipment, maxPickupDate, parseShipmentQuery, sameShipment } from "@/lib/schemas/shipment-search.schema";
import { useTakiStore } from "@/lib/store";
import { useOffers } from "@/lib/store/selectors";
import { getNow } from "@/lib/utils/clock";
import { cityName } from "@/lib/domain/cities";
import { SearchSummaryBar } from "./SearchSummaryBar";
import { VehicleCard } from "./VehicleCard";

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "best", label: "Best match" },
  { value: "price", label: "Lowest price" },
  { value: "rating", label: "Top rated" },
  { value: "capacity", label: "Most capacity" },
];

function toSortKey(v: string | null): SortKey {
  return SORT_OPTIONS.some((o) => o.value === v) ? (v as SortKey) : "best";
}

function vehiclesHref(s: Shipment, sort?: SortKey) {
  return paths.customer.vehicles({
    from: s.sourceCityId,
    to: s.destinationCityId,
    weight: s.weightKg,
    date: s.pickupDate,
    cargo: s.cargoType,
    sort: sort && sort !== "best" ? sort : undefined,
  });
}

const PAGE = "mx-auto w-full max-w-[880px] lg:mx-0";

export function VehiclesView() {
  const hydrated = useHydrated();
  return hydrated ? <VehiclesResults /> : <VehiclesSkeleton />;
}

function VehiclesResults() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const storeSearch = useTakiStore((s) => s.search);
  const setSearch = useTakiStore((s) => s.setSearch);

  const today = todayIst(getNow());
  const paramsKey = params.toString();
  const queryShipment = useMemo(() => parseShipmentQuery(new URLSearchParams(paramsKey), today), [paramsKey, today]);
  const fallback = !queryShipment && isValidShipment(storeSearch, today) ? storeSearch : null;
  const shipment = queryShipment ?? fallback;
  const sort = toSortKey(params.get("sort"));
  const { offers, excludedForCapacity } = useOffers(shipment, sort);

  // URL is the source of truth: mirror a valid query into the store (only when it differs).
  useEffect(() => {
    if (queryShipment && !sameShipment(queryShipment, useTakiStore.getState().search)) setSearch(queryShipment);
  }, [queryShipment, setSearch]);

  // Falling back to the saved search: make the URL reflect what is shown.
  useEffect(() => {
    if (!queryShipment && fallback) router.replace(vehiclesHref(fallback, sort), { scroll: false });
  }, [queryShipment, fallback, sort, router]);

  function onSortChange(next: SortKey) {
    const q = new URLSearchParams(paramsKey);
    if (next === "best") q.delete("sort");
    else q.set("sort", next);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const header = (count?: number) => (
    <PageHeader title="Available Vehicles" count={count} backHref={paths.customer.dashboard} backLabel="Back to dashboard" />
  );

  if (!shipment) {
    return (
      <div className={PAGE}>
        {header()}
        <EmptyState
          icon={<SearchX strokeWidth={1.75} />}
          title="Your search is incomplete"
          description="Start by entering your shipment details — source, destination, cargo weight and pickup date."
          action={{ label: "Edit search", href: paths.customer.dashboard }}
        />
      </div>
    );
  }

  const sortLabel = SORT_OPTIONS.find((o) => o.value === sort)?.label ?? "Best match";

  return (
    <div className={PAGE}>
      {header(offers.length)}
      <SearchSummaryBar shipment={shipment} editHref={paths.customer.dashboard} />

      {offers.length === 0 ? (
        <NoResults shipment={shipment} excludedForCapacity={excludedForCapacity} today={today} />
      ) : (
        <>
          <div className="mb-4 mt-6 flex flex-wrap items-center justify-between gap-3">
            <p aria-live="polite" className="text-sm text-ink-muted">
              <span className="font-semibold text-ink">
                {offers.length} {offers.length === 1 ? "vehicle" : "vehicles"}
              </span>{" "}
              travelling your way<span className="sr-only">, sorted by {sortLabel}</span>
            </p>
            <div className="flex items-center gap-2">
              <label htmlFor="vehicle-sort" className="text-sm font-medium text-ink-muted">
                Sort by
              </label>
              <Select
                id="vehicle-sort"
                value={sort}
                onChange={(e) => onSortChange(toSortKey(e.target.value))}
                options={SORT_OPTIONS}
                leadingIcon={<ArrowUpDown strokeWidth={1.75} />}
                wrapperClassName="h-11 w-[200px]"
                className="text-sm font-medium"
              />
            </div>
          </div>
          <ul className="flex flex-col gap-4" aria-label="Available vehicles">
            {offers.map((offer, i) => (
              <li key={offer.routeId}>
                <VehicleCard offer={offer} href={paths.customer.booking(offer.routeId)} eager={i === 0} />
              </li>
            ))}
          </ul>
          <p className="mt-5 text-caption text-ink-subtle">
            Prices include the TAKI service fee. Vehicle photos are illustrative examples, not the operator&apos;s actual truck.
          </p>
        </>
      )}
    </div>
  );
}

function NoResults({ shipment, excludedForCapacity, today }: { shipment: Shipment; excludedForCapacity: number; today: string }) {
  const route = `${cityName(shipment.sourceCityId)} → ${cityName(shipment.destinationCityId)}`;
  const n = excludedForCapacity;
  const capacityNote =
    n > 0
      ? ` ${n} ${n === 1 ? "vehicle" : "vehicles"} on this route ${n === 1 ? "doesn't" : "don't"} have space for ${formatKg(shipment.weightKg)} — try a lower weight.`
      : "";
  const prev = addDaysIso(shipment.pickupDate, -1);
  const next = addDaysIso(shipment.pickupDate, 1);
  const canPrev = prev >= today;
  const canNext = next <= maxPickupDate(today);

  return (
    <div className="mt-6">
      <EmptyState
        icon={<Truck strokeWidth={1.75} />}
        title="No vehicles on this route yet"
        description={`No vehicles found for ${route} on ${formatDate(shipment.pickupDate)}.${capacityNote}`}
        action={{ label: "Change search", href: paths.customer.dashboard }}
      />
      {canPrev || canNext ? (
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          {canPrev ? (
            <Link href={vehiclesHref({ ...shipment, pickupDate: prev })} className={buttonClasses({ variant: "outline", size: "md" })}>
              <ArrowLeft aria-hidden="true" strokeWidth={2} className="size-4" />
              Try previous day
            </Link>
          ) : null}
          {canNext ? (
            <Link href={vehiclesHref({ ...shipment, pickupDate: next })} className={buttonClasses({ variant: "outline", size: "md" })}>
              Try next day
              <ArrowRight aria-hidden="true" strokeWidth={2} className="size-4" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function VehiclesSkeleton() {
  return (
    <div className={PAGE} aria-busy="true">
      <span className="sr-only">Loading available vehicles…</span>
      <div className="mb-6 flex items-center gap-3 lg:mb-8">
        <Skeleton rounded="full" className="size-9" />
        <Skeleton className="h-7 w-64" />
      </div>
      <Skeleton className="h-14 rounded-lg" />
      <ul className="mt-[76px] flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <Card as="li" key={i} padding="none" className="p-4 sm:p-5">
            <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-5">
              <Skeleton className="h-[72px] sm:h-[120px]" />
              <div className="flex flex-col gap-2.5">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="mt-auto hidden h-8 w-24 sm:block" />
              </div>
            </div>
          </Card>
        ))}
      </ul>
    </div>
  );
}
