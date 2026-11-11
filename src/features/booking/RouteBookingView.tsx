"use client";

import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarDays,
  Clock,
  MapPin,
  PackageSearch,
  Route as RouteIcon,
  TriangleAlert,
  Truck,
} from "lucide-react";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Rating,
  Skeleton,
  useToast,
} from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { paths } from "@/lib/config/routes";
import { cityName } from "@/lib/domain/cities";
import { routeCityIds } from "@/lib/domain/search";
import type { CityId, Shipment, VehicleImageKey } from "@/lib/domain/types";
import { getVehicleModel, vehicleImageSrc } from "@/lib/domain/vehicles";
import {
  formatDate,
  formatDuration,
  formatKg,
  formatKm,
  formatTime,
} from "@/lib/format";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { errorMessage, marketplace } from "@/lib/services/marketplace";
import { useTakiStore } from "@/lib/store";
import { useOffer } from "@/lib/store/selectors";
import { BookingSummary } from "./BookingSummary";
import { RouteMap } from "./RouteMap";

const TITLE = "Route & Booking Details";

/** Screen 08 — Route & Booking Details (`/customer/booking/[vehicleId]`, segment = route id). */
export function RouteBookingView() {
  const params = useParams<{ vehicleId: string }>();
  const routeId = params?.vehicleId
    ? decodeURIComponent(params.vehicleId)
    : undefined;
  const hydrated = useHydrated();
  const search = useTakiStore((s) => s.search);
  const { offer, route, vehicle, driver, problem, problemMessage } = useOffer(
    routeId,
    search,
  );
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const backHref = search ? vehiclesHref(search) : paths.customer.dashboard;
  const header = (
    <PageHeader
      title={TITLE}
      backHref={backHref}
      backLabel={search ? "Back to available vehicles" : "Back to dashboard"}
    />
  );

  if (!hydrated) {
    return (
      <>
        {header}
        <LoadingSkeleton />
      </>
    );
  }

  if (!route || !vehicle || !driver || problem === "not_found") {
    return (
      <>
        {header}
        <EmptyState
          icon={<Truck strokeWidth={1.75} />}
          title="Vehicle no longer available"
          description={
            problemMessage ?? "This vehicle listing no longer exists."
          }
          action={{
            label: "Back to dashboard",
            href: paths.customer.dashboard,
          }}
        />
      </>
    );
  }

  // Display data: from the offer when we have a shipment, otherwise from the route itself (deep link without a search).
  const cityIds: CityId[] = offer?.pathCityIds ?? routeCityIds(route);
  const km = offer?.segmentKm ?? route.distanceKm;
  const mins = offer?.segmentDurationMins ?? route.durationMins;
  const stops = offer?.stopsCount ?? cityIds.length - 1;
  const vehicleLabel =
    offer?.vehicleLabel ??
    getVehicleModel(vehicle.modelId)?.label ??
    vehicle.modelId;
  const canBook = Boolean(offer && search && !problem) && !pending;

  async function book() {
    if (!offer || !search || problem || pending) return;
    setPending(true);
    setError(null);
    try {
      const booking = await marketplace.createBookingForPayment(
        offer.routeId,
        search,
      );
      router.push(paths.customer.payment(booking.id));
    } catch (e) {
      const msg = errorMessage(
        e,
        "We couldn't book this vehicle. Please try again.",
      );
      setError(msg);
      toast({ title: "Booking not started", description: msg, tone: "error" });
      setPending(false);
    }
  }

  return (
    <>
      {header}

      {problem && problemMessage ? (
        <div
          role="alert"
          data-testid="offer-problem"
          className="mb-5 flex flex-col gap-3 rounded-lg border border-warning-700/25 bg-warning-100 p-4 text-warning-700 sm:flex-row sm:items-center sm:justify-between lg:mb-6"
        >
          <div className="flex items-start gap-3">
            <TriangleAlert
              aria-hidden="true"
              strokeWidth={1.75}
              className="mt-0.5 size-5 shrink-0"
            />
            <div>
              <p className="font-semibold">This vehicle can&apos;t be booked</p>
              <p className="mt-0.5 text-sm">{problemMessage}</p>
            </div>
          </div>
          <ButtonLink
            href={backHref}
            variant="outline"
            size="sm"
            className="self-start sm:self-auto"
          >
            Choose another vehicle
          </ButtonLink>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:grid-rows-[auto_1fr] lg:gap-6">
        {/* Provider */}
        <Card
          as="section"
          aria-label="Transport provider"
          padding="sm"
          className="lg:col-start-2 lg:row-start-1"
        >
          <div className="flex items-center gap-4">
            <ProviderPhoto
              imageKey={offer?.imageKey ?? vehicle.imageKey}
              label={vehicleLabel}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="type-h3 truncate text-ink">
                  {offer?.businessName ?? driver.businessName}
                </h2>
                <Rating value={offer?.ratingAvg ?? driver.ratingAvg} />
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                {vehicleLabel}
                <span aria-hidden="true" className="mx-2 text-border-strong">
                  |
                </span>
                <span className="whitespace-nowrap">
                  {offer?.registrationNumber ?? vehicle.registrationNumber}
                </span>
              </p>
            </div>
          </div>
        </Card>

        {/* Map, stats, route */}
        <Card
          as="section"
          aria-labelledby="route-heading"
          padding="sm"
          className="lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:self-start lg:p-5"
        >
          <h2 id="route-heading" className="sr-only">
            Route
          </h2>
          <RouteMap cityIds={cityIds} />
          <dl
            className="mt-4 grid grid-cols-3 divide-x divide-border rounded-md border border-border bg-surface py-3"
            data-testid="route-stats"
          >
            <Stat
              icon={<RouteIcon strokeWidth={1.75} />}
              term="Distance"
              value={formatKm(km)}
            />
            <Stat
              icon={<Clock strokeWidth={1.75} />}
              term="Estimated time"
              value={formatDuration(mins)}
            />
            <Stat
              icon={<MapPin strokeWidth={1.75} />}
              term="Stops"
              value={`${stops} ${stops === 1 ? "Stop" : "Stops"}`}
            />
          </dl>
          <p className="mt-2 text-caption text-ink-subtle">
            Distance and time are estimates (demo data).
          </p>
          <p
            className="mt-4 text-sm text-ink sm:text-base"
            data-testid="route-line"
          >
            <strong className="font-semibold">Route:</strong>{" "}
            <span className="text-ink-muted">
              {cityIds.map(cityName).join(" → ")}
            </span>
          </p>
        </Card>

        {/* Shipment + price + CTA */}
        <div className="lg:col-start-2 lg:row-start-2">
          <Card
            as="section"
            aria-label="Your booking"
            padding="md"
            className="lg:sticky lg:top-8"
          >
            {search ? (
              <>
                <h2 className="type-h3 text-ink">Shipment Details</h2>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <Detail
                    icon={<MapPin strokeWidth={1.75} />}
                    term="Pickup → Drop"
                    value={`${cityName(search.sourceCityId)} → ${cityName(search.destinationCityId)}`}
                    wide
                  />
                  <Detail
                    icon={<CalendarDays strokeWidth={1.75} />}
                    term="Pickup date"
                    value={formatDate(offer?.travelDate ?? search.pickupDate)}
                  />
                  <Detail
                    icon={<Clock strokeWidth={1.75} />}
                    term="Departure time"
                    value={
                      offer
                        ? formatTime(offer.departureTime)
                        : formatTime(route.departureTime)
                    }
                  />
                  <Detail
                    icon={<PackageSearch strokeWidth={1.75} />}
                    term="Cargo weight"
                    value={formatKg(search.weightKg)}
                  />
                  <Detail
                    icon={<Truck strokeWidth={1.75} />}
                    term="Space available"
                    value={formatKg(
                      offer?.availableCapacityKg ?? route.availableCapacityKg,
                    )}
                  />
                </dl>

                {offer ? (
                  <BookingSummary
                    pricing={offer.pricing}
                    className="mt-5 rounded-none border-0 border-t border-border bg-transparent px-0 pb-0 pt-5 shadow-none sm:px-0 sm:pb-0 sm:pt-5"
                    footnote="Includes the TAKI service fee. You'll choose how to pay on the next step."
                  />
                ) : null}

                <div className="mt-5">
                  <Button
                    size="lg"
                    fullWidth
                    loading={pending}
                    disabled={!canBook}
                    onClick={book}
                    trailingIcon={
                      <ArrowRight aria-hidden="true" strokeWidth={2} />
                    }
                    aria-describedby={error ? errorId : undefined}
                    className="h-14 text-lg"
                  >
                    {pending ? "Booking…" : "Book This Vehicle"}
                  </Button>
                  <div role="alert" aria-live="assertive">
                    {error ? (
                      <p
                        id={errorId}
                        className="mt-3 flex items-start gap-1.5 text-sm text-error"
                      >
                        <TriangleAlert
                          aria-hidden="true"
                          strokeWidth={1.75}
                          className="mt-0.5 size-4 shrink-0"
                        />
                        {error}
                      </p>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <div
                data-testid="booking-no-search"
                className="flex flex-col items-start gap-4"
              >
                <span
                  aria-hidden="true"
                  className="flex size-12 items-center justify-center rounded-full bg-mint-100 text-green-700"
                >
                  <PackageSearch strokeWidth={1.75} className="size-6" />
                </span>
                <div>
                  <h2 className="type-h3 text-ink">Price not shown yet</h2>
                  <p className="mt-1 text-sm text-ink-muted sm:text-base">
                    Enter your shipment details to see the price for this
                    vehicle.
                  </p>
                </div>
                <ButtonLink
                  href={paths.customer.dashboard}
                  size="lg"
                  fullWidth
                  trailingIcon={
                    <ArrowRight aria-hidden="true" strokeWidth={2} />
                  }
                >
                  Enter shipment details
                </ButtonLink>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function vehiclesHref(s: Shipment): string {
  return paths.customer.vehicles({
    from: s.sourceCityId,
    to: s.destinationCityId,
    weight: s.weightKg,
    date: s.pickupDate,
  });
}

function ProviderPhoto({
  imageKey,
  label,
}: {
  imageKey: VehicleImageKey;
  label: string;
}) {
  return (
    <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-md bg-surface-muted sm:h-[72px] sm:w-24">
      <Image
        src={vehicleImageSrc(imageKey)}
        alt={`${label} (illustrative photo)`}
        fill
        sizes="96px"
        className="object-cover"
      />
    </div>
  );
}

function Stat({
  icon,
  term,
  value,
}: {
  icon: ReactNode;
  term: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-1 px-2 text-center sm:flex-row sm:gap-2">
      <dt className="text-ink-muted [&_svg]:size-5">
        <span aria-hidden="true">{icon}</span>
        <span className="sr-only">{term}</span>
      </dt>
      <dd className="truncate font-heading text-sm font-semibold tabular-nums text-ink sm:text-base">
        {value}
      </dd>
    </div>
  );
}

function Detail({
  icon,
  term,
  value,
  wide,
}: {
  icon: ReactNode;
  term: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="flex items-center gap-1.5 text-caption text-ink-subtle [&_svg]:size-3.5">
        <span aria-hidden="true" className="flex text-green-700">
          {icon}
        </span>
        {term}
      </dt>
      <dd className="mt-0.5 font-medium text-ink">{value}</dd>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div
      aria-busy="true"
      className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-6"
    >
      <span className="sr-only">Loading route details…</span>
      <div className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-card lg:row-span-2">
        <Skeleton className="aspect-[16/10] h-auto w-full" rounded="md" />
        <Skeleton className="h-12" />
        <Skeleton lines={1} className="w-3/4" />
      </div>
      <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4 shadow-card lg:col-start-2 lg:row-start-1">
        <Skeleton className="h-16 w-20 shrink-0" />
        <Skeleton lines={2} className="flex-1" />
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-card lg:col-start-2">
        <Skeleton lines={4} />
        <Skeleton className="h-14" />
      </div>
    </div>
  );
}
