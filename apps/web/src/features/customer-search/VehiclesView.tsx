"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpDown, Map as MapIcon, SearchX, SlidersHorizontal, Truck, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, buttonClasses, Card, ChoiceChips, Drawer, EmptyState, FormField, IconButton, Input, Modal, Select, Skeleton } from "@/components/ui";
import { customerApi, type OfferFilterParams } from "@/lib/api/client/customer";
import type { OffersResponse, ShipmentWithBookingsDTO, TripOfferDTO } from "@/lib/api/contracts/customer";
import { paths } from "@/lib/config/routes";
import { addDaysIso, isIsoDate, todayIst } from "@/lib/domain/dates";
import type { OfferSort } from "@/lib/domain/matching";
import type { GoodsCategory, IsoDate, VehicleClass } from "@/lib/domain/model";
import { districtName, getDistrict } from "@/lib/domain/places/districts";
import { formatDate, formatKg } from "@/lib/format";
import { maxPickupDate, parseSearchQuery, type SearchCriteria } from "@/lib/schemas/shipment-search.schema";
import { GOODS_LABEL, SORT_OPTIONS, VEHICLE_CLASS_OPTIONS } from "@/features/customer-shipment/labels";
import { RouteMap } from "@/features/booking/RouteMap";
import { LoadError } from "@/features/customer-shipment/LoadError";
import { isNotFound, useApi } from "@/features/customer-shipment/use-api";
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  filterParams,
  newShipmentHref,
  parseFilters,
  vehicleDetailsHref,
  vehiclesHref,
  withParams,
  type OfferFilterState,
  type SearchSource,
} from "@/features/customer-shipment/urls";
import { SearchSummaryBar } from "./SearchSummaryBar";
import { VehicleCard } from "./VehicleCard";

const PAGE = "w-full";

/** Summary of what is being searched (for the bar and the empty state). */
interface SearchSubject {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  weightKg: number;
  date: IsoDate;
  goods?: GoodsCategory;
}

/**
 * Find Vehicles (P3 §4.3). Source: `?shipment=<id>` (saved shipment) or a district-level
 * guest search (`from, to, weight, date, cargo, handling`). Filters and sort live in the URL.
 */
export function VehiclesView() {
  const params = useSearchParams();
  const [today] = useState(() => todayIst(new Date()));
  const shipmentId = params.get("shipment");
  const criteria = shipmentId ? null : parseSearchQuery(params, today);

  if (shipmentId) return <ShipmentResults shipmentId={shipmentId} today={today} />;
  if (criteria) return <Results src={{ criteria }} subject={subjectOf(criteria)} editHref={newShipmentHref(criteria)} today={today} />;
  return (
    <div className={PAGE}>
      <Header />
      <EmptyState
        icon={<SearchX strokeWidth={1.75} />}
        title="Your search is incomplete"
        description="Start with your shipment details: pickup and drop districts, weight and shipping date."
        action={{ label: "New Shipment", href: paths.customer.newShipment() }}
      />
    </div>
  );
}

function subjectOf(c: SearchCriteria): SearchSubject {
  return { fromId: c.from, toId: c.to, fromName: districtName(c.from), toName: districtName(c.to), weightKg: c.weightKg, date: c.date, goods: c.goods };
}

function Header({ count }: { count?: number }) {
  return <PageHeader title="Available Vehicles" count={count} backHref={paths.customer.dashboard} backLabel="Back to dashboard" />;
}

function ShipmentResults({ shipmentId, today }: { shipmentId: string; today: IsoDate }) {
  const shipment = useApi(`customer:shipment:${shipmentId}`, (signal) => customerApi.shipment(shipmentId, signal));
  if (shipment.loading) return <VehiclesSkeleton />;
  if (shipment.error || !shipment.data) {
    return (
      <div className={PAGE}>
        <Header />
        {isNotFound(shipment.error) ? (
          <EmptyState
            icon={<SearchX strokeWidth={1.75} />}
            title="Shipment not found"
            description="It may have been withdrawn. Start a new shipment to search again."
            action={{ label: "New Shipment", href: paths.customer.newShipment() }}
          />
        ) : (
          <LoadError error={shipment.error} title="We couldn't load your shipment" onRetry={() => void shipment.reload()} />
        )}
      </div>
    );
  }
  const s: ShipmentWithBookingsDTO = shipment.data;
  return (
    <Results
      src={{ shipmentId }}
      subject={{
        fromId: s.source.districtId,
        toId: s.destination.districtId,
        fromName: s.source.districtName,
        toName: s.destination.districtName,
        weightKg: s.package.weightKg,
        date: s.shippingDate,
        goods: s.package.goodsCategory,
      }}
      editHref={s.editable ? withParams(paths.customer.newShipment(), { edit: s.id }) : s.currentBookingId ? paths.customer.tracking(s.currentBookingId) : paths.customer.newShipment()}
      editLabel={s.editable ? "Modify search" : s.currentBookingId ? "View booking" : "New shipment"}
      existingBookingId={s.currentBookingId}
      today={today}
    />
  );
}

function Results({
  src,
  subject,
  editHref,
  editLabel,
  existingBookingId,
  today,
}: {
  src: SearchSource;
  subject: SearchSubject;
  editHref: string;
  editLabel?: string;
  existingBookingId?: string | null;
  today: IsoDate;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const filters = parseFilters(params);
  const dateParam = params.get("date");
  // For a saved shipment `date` overrides the shipping date ("try another day").
  const date = "shipmentId" in src && dateParam && isIsoDate(dateParam) ? dateParam : subject.date;

  const apiFilters: OfferFilterParams = {
    sort: filters.sort,
    vehicleClass: filters.types.length ? filters.types : undefined,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    minCapacityKg: filters.minKg,
    date,
  };
  const key = `offers:${"shipmentId" in src ? src.shipmentId : JSON.stringify(src.criteria)}:${JSON.stringify(apiFilters)}`;
  const offers = useApi<OffersResponse>(key, (signal) =>
    "shipmentId" in src ? customerApi.offers(src.shipmentId, apiFilters, signal) : customerApi.guestSearch({ ...apiFilters, from: src.criteria.from, to: src.criteria.to, weightKg: src.criteria.weightKg, goods: src.criteria.goods, handling: src.criteria.handling }, signal),
  );

  function replaceQuery(patch: Record<string, string | undefined>) {
    router.replace(withParams(`${pathname}?${params.toString()}`, patch), { scroll: false });
  }
  function applyFilters(next: OfferFilterState) {
    setFiltersOpen(false);
    replaceQuery(filterParams(next));
  }
  function dayHref(d: IsoDate) {
    return "shipmentId" in src ? vehiclesHref(src, { filters, date: d }) : vehiclesHref({ criteria: { ...src.criteria, date: d } }, { filters });
  }

  const n = activeFilterCount(filters);
  const shown = offers.data?.items ?? [];
  const sortLabel = SORT_OPTIONS.find((o) => o.value === filters.sort)?.label ?? "";
  const shownSubject = { ...subject, date: offers.data?.date ?? date };

  const mapStops = mapStopsFor(subject, shown[0]);

  return (
    <div className={PAGE}>
      <SearchSummaryBar
        from={shownSubject.fromName}
        to={shownSubject.toName}
        weightKg={subject.weightKg}
        date={shownSubject.date}
        goodsLabel={subject.goods ? GOODS_LABEL[subject.goods] : undefined}
        editHref={editHref}
        editLabel={editLabel}
      />
      {existingBookingId ? (
        <Card tone="muted" padding="sm" className="mt-4 text-sm text-ink">
          This shipment already has a booking.{" "}
          <Link href={paths.customer.tracking(existingBookingId)} className="font-semibold text-green-700 underline">
            View booking {existingBookingId}
          </Link>
        </Card>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside aria-label="Map, sort and filters" className="hidden lg:block">
          <div className="flex flex-col gap-4">
            {mapStops ? (
              <Card padding="none" className="relative overflow-hidden">
                <RouteMap stops={mapStops} caption="Illustrative route" />
                <div className="absolute inset-x-0 bottom-10 flex justify-center">
                  <Button size="sm" leadingIcon={<MapIcon strokeWidth={1.75} />} onClick={() => setMapOpen(true)}>
                    View on Map
                  </Button>
                </div>
              </Card>
            ) : null}
            <Card padding="md">
              <SortRadios value={filters.sort} onChange={(v) => replaceQuery({ sort: v === "price_asc" ? undefined : v })} />
            </Card>
            <Card padding="md">
              <h2 className="type-h3 mb-4 text-ink">Filters</h2>
              <FilterForm key={params.toString()} initial={filters} minKg={subject.weightKg} onApply={applyFilters} />
            </Card>
          </div>
        </aside>
        <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} label="Filters" side="right" className="w-[min(22rem,92vw)]">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="type-h3 text-ink">Filters</h2>
            <IconButton label="Close filters" icon={<X strokeWidth={1.75} />} variant="ghost" onClick={() => setFiltersOpen(false)} />
          </div>
          <div className="p-4">
            <FilterForm key={params.toString()} initial={filters} minKg={subject.weightKg} onApply={applyFilters} />
          </div>
        </Drawer>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="type-h2 text-heading">
                Transport Options <span className="text-ink-subtle">·</span> {shownSubject.fromName} <span aria-hidden="true">→</span>
                <span className="sr-only"> to </span> {shownSubject.toName}
              </h1>
              <p aria-live="polite" className="mt-1 text-sm text-ink-muted">
                {offers.data ? (
                  <>
                    <span className="font-semibold text-ink">
                      {shown.length} transport {shown.length === 1 ? "option" : "options"}
                    </span>{" "}
                    found for {formatDate(shownSubject.date)}
                    <span className="sr-only">, sorted by {sortLabel}</span>
                  </>
                ) : offers.loading ? (
                  "Searching…"
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-2 lg:hidden">
              <Button variant="outline" size="sm" leadingIcon={<SlidersHorizontal strokeWidth={1.75} />} onClick={() => setFiltersOpen(true)}>
                Filters{n ? ` (${n})` : ""}
              </Button>
              <Select
                id="vehicle-sort-mobile"
                aria-label="Sort results"
                value={filters.sort}
                onChange={(e) => replaceQuery({ sort: e.target.value === "price_asc" ? undefined : (e.target.value as OfferSort) })}
                options={[...SORT_OPTIONS]}
                leadingIcon={<ArrowUpDown strokeWidth={1.75} />}
                wrapperClassName="h-11 w-[200px]"
                className="text-sm font-medium"
              />
            </div>
          </div>

          {offers.loading ? (
            <CardsSkeleton />
          ) : offers.error || !offers.data ? (
            <LoadError error={offers.error} title="We couldn't search vehicles" onRetry={() => void offers.reload()} />
          ) : shown.length === 0 ? (
            <NoResults
              data={offers.data}
              subject={shownSubject}
              filtered={n > 0}
              onClear={() => applyFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}
              prevHref={addDaysIso(shownSubject.date, -1) >= today ? dayHref(addDaysIso(shownSubject.date, -1)) : null}
              nextHref={addDaysIso(shownSubject.date, 1) <= maxPickupDate(today) ? dayHref(addDaysIso(shownSubject.date, 1)) : null}
              editHref={editHref}
            />
          ) : (
            <>
              <ul className="flex flex-col gap-4" aria-label="Available vehicles">
                {shown.map((offer, i) => (
                  <li key={offer.tripId}>
                    <VehicleCard offer={offer} href={vehicleDetailsHref(offer.tripId, src)} eager={i === 0} />
                  </li>
                ))}
              </ul>
              <ExcludedNote data={offers.data} weightKg={subject.weightKg} className="mt-4" />
              <p className="mt-5 text-caption text-ink-subtle">
                Prices include the TAKI service fee. You pay only after the agency accepts your request. Example photos are illustrative.
              </p>
            </>
          )}
        </div>
      </div>

      {mapStops ? (
        <Modal open={mapOpen} onClose={() => setMapOpen(false)} title="Route" description={`${shownSubject.fromName} to ${shownSubject.toName}`} size="lg">
          <RouteMap stops={mapStops} variant="modal" />
          <p className="mt-3 text-caption text-ink-muted">Illustrative route, not a live location.</p>
        </Modal>
      ) : null}
    </div>
  );
}

/** Pickup → drop stops (with coordinates) of the first offer, or just the two districts. */
function mapStopsFor(subject: SearchSubject, first: TripOfferDTO | undefined): { name: string; lat: number; lng: number }[] | null {
  const fromOffer = first?.route
    .filter((s) => s.inSegment && s.lat !== null && s.lng !== null)
    .map((s) => ({ name: s.placeName, lat: s.lat!, lng: s.lng! }));
  if (fromOffer && fromOffer.length >= 2) return fromOffer;
  const a = getDistrict(subject.fromId);
  const b = getDistrict(subject.toId);
  if (!a || !b) return null;
  return [
    { name: a.name, lat: a.hq.lat, lng: a.hq.lng },
    { name: b.name, lat: b.hq.lat, lng: b.hq.lng },
  ];
}

/** Sort as a radio list (left column on desktop; mobile uses the "Sort results" select). */
function SortRadios({ value, onChange }: { value: OfferSort; onChange(v: OfferSort): void }) {
  return (
    <fieldset>
      <legend className="type-h3 mb-3 text-ink">Sort by</legend>
      <div className="flex flex-col gap-1">
        {SORT_OPTIONS.map((o) => (
          <label key={o.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 text-[15px] text-ink hover:bg-surface-muted">
            <input type="radio" name="vehicle-sort" value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="size-5 accent-green-700" />
            <span className={value === o.value ? "font-semibold" : undefined}>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function FilterForm({ initial, minKg, onApply }: { initial: OfferFilterState; minKg: number; onApply(f: OfferFilterState): void }) {
  const [types, setTypes] = useState<VehicleClass[]>(initial.types);
  const [minPrice, setMinPrice] = useState(initial.minPrice ? String(initial.minPrice) : "");
  const [maxPrice, setMaxPrice] = useState(initial.maxPrice ? String(initial.maxPrice) : "");
  const [capacity, setCapacity] = useState(initial.minKg ? String(initial.minKg) : "");
  const [error, setError] = useState<{ price?: string; capacity?: string }>({});

  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

  function submit(e: FormEvent) {
    e.preventDefault();
    const lo = num(minPrice);
    const hi = num(maxPrice);
    const kg = num(capacity);
    const next: typeof error = {};
    if ((lo !== undefined && (!Number.isInteger(lo) || lo < 0)) || (hi !== undefined && (!Number.isInteger(hi) || hi <= 0))) next.price = "Enter whole rupees";
    else if (lo !== undefined && hi !== undefined && lo > hi) next.price = "Minimum can't be more than maximum";
    if (kg !== undefined && (!Number.isInteger(kg) || kg <= 0)) next.capacity = "Enter whole kg";
    else if (kg !== undefined && kg < minKg) next.capacity = `At least your shipment weight (${formatKg(minKg)})`;
    setError(next);
    if (next.price || next.capacity) return;
    onApply({ sort: initial.sort, types, minPrice: lo || undefined, maxPrice: hi || undefined, minKg: kg || undefined });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-label="Filter vehicles">
      <ChoiceChips multiple legend="Vehicle type" options={VEHICLE_CLASS_OPTIONS} value={types} onChange={(v) => setTypes(v as VehicleClass[])} />
      <fieldset aria-describedby={error.price ? "filter-price-error" : undefined}>
        <legend className="mb-1.5 text-sm font-medium text-ink">Price (₹)</legend>
        <div className="grid grid-cols-2 gap-2">
          <Input aria-label="Minimum price in rupees" inputMode="numeric" placeholder="Min" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} invalid={!!error.price} />
          <Input aria-label="Maximum price in rupees" inputMode="numeric" placeholder="Max" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} invalid={!!error.price} />
        </div>
        {error.price ? (
          <p id="filter-price-error" className="mt-1.5 text-sm text-error">
            {error.price}
          </p>
        ) : null}
      </fieldset>
      <FormField label="Min. available capacity (kg)" htmlFor="filter-capacity" error={error.capacity}>
        <Input inputMode="numeric" placeholder={String(minKg)} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
      </FormField>
      <div className="grid grid-cols-2 gap-2">
        <Button type="submit" fullWidth>
          Apply
        </Button>
        <Button
          type="button"
          variant="outline"
          fullWidth
          onClick={() => {
            setTypes([]);
            setMinPrice("");
            setMaxPrice("");
            setCapacity("");
            setError({});
            onApply({ ...DEFAULT_FILTERS, sort: initial.sort });
          }}
        >
          Clear all
        </Button>
      </div>
    </form>
  );
}

function ExcludedNote({ data, weightKg, className }: { data: OffersResponse; weightKg: number; className?: string }) {
  const parts: string[] = [];
  const c = data.excludedForCapacity;
  const r = data.excludedForRestrictions;
  if (c > 0) parts.push(`${c} ${c === 1 ? "vehicle" : "vehicles"} hidden: not enough space for ${formatKg(weightKg)}`);
  if (r > 0) parts.push(`${r} ${r === 1 ? "vehicle" : "vehicles"} hidden: restricted goods or handling`);
  if (!parts.length) return null;
  return <p className={`text-sm text-ink-muted ${className ?? ""}`}>{parts.join(". ")}.</p>;
}

function NoResults({
  data,
  subject,
  filtered,
  onClear,
  prevHref,
  nextHref,
  editHref,
}: {
  data: OffersResponse;
  subject: SearchSubject;
  filtered: boolean;
  onClear(): void;
  prevHref: string | null;
  nextHref: string | null;
  editHref: string;
}) {
  if (filtered) {
    return (
      <EmptyState
        icon={<SearchX strokeWidth={1.75} />}
        title="No vehicles match these filters"
        description="Clear the filters to see every vehicle on your route."
        action={{ label: "Clear filters", onClick: onClear }}
      />
    );
  }
  return (
    <div>
      <EmptyState
        icon={<Truck strokeWidth={1.75} />}
        title="No vehicles on this route yet"
        description={`No vehicles found for ${subject.fromName} → ${subject.toName} on ${formatDate(subject.date)}.`}
        action={{ label: "Change shipment", href: editHref }}
      />
      <ExcludedNote data={data} weightKg={subject.weightKg} className="mt-4 text-center" />
      {prevHref || nextHref ? (
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          {prevHref ? (
            <Link href={prevHref} className={buttonClasses({ variant: "outline", size: "md" })}>
              <ArrowLeft aria-hidden="true" strokeWidth={2} className="size-4" />
              Try previous day
            </Link>
          ) : null}
          {nextHref ? (
            <Link href={nextHref} className={buttonClasses({ variant: "outline", size: "md" })}>
              Try next day
              <ArrowRight aria-hidden="true" strokeWidth={2} className="size-4" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading available vehicles…</span>
      <ul className="flex flex-col gap-4">
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

export function VehiclesSkeleton() {
  return (
    <div className={PAGE} aria-busy="true">
      <div className="mb-6 flex items-center gap-3 lg:mb-8">
        <Skeleton rounded="full" className="size-9" />
        <Skeleton className="h-7 w-64" />
      </div>
      <Skeleton className="h-14 rounded-lg" />
      <div className="mt-6">
        <CardsSkeleton />
      </div>
    </div>
  );
}
