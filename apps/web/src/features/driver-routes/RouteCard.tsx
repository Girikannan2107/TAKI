import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, ChevronRight, IndianRupee, Truck, UserRound } from "lucide-react";
import { Badge, CapacityBar, Card, type BadgeTone } from "@/components/ui";
import type { AgencyTripListItem } from "@/lib/api/contracts/agency";
import { paths } from "@/lib/config/routes";
import { formatDuration, formatKm, formatRate } from "@/lib/format";
import { estimateDurationMins } from "@/lib/domain/pricing";
import { cn } from "@/lib/utils/cn";
import { TRIP_STATUS, plural } from "@/features/agency/labels";
import { when } from "@/features/agency/format";

function statusBadge(trip: AgencyTripListItem): { label: string; tone: BadgeTone } {
  if (trip.status === "published" && trip.departed) return { label: "Departed", tone: "info" };
  return TRIP_STATUS[trip.status];
}

export interface RouteCardProps {
  trip: AgencyTripListItem;
  highlighted?: boolean;
  /** Extra actions in the footer (e.g. draft "Continue editing" / "Delete"). */
  actions?: ReactNode;
}

/** One trip on Trips (`/agency/trips`): route + stops, schedule, vehicle, driver, capacity, rates, requests. */
export function RouteCard({ trip, highlighted, actions }: RouteCardProps) {
  const badge = statusBadge(trip);
  const headingId = `trip-${trip.id}-title`;
  const live = trip.status === "published" || trip.status === "in_progress";
  const via = trip.stops.slice(1, -1);
  const href = trip.status === "draft" ? paths.agency.newTrip(trip.id) : paths.agency.trip(trip.id);

  return (
    <Card
      as="article"
      aria-labelledby={headingId}
      tone={highlighted ? "selected" : "default"}
      padding="sm"
      data-testid="route-card"
      data-route-id={trip.id}
      data-highlighted={highlighted || undefined}
      className={cn("flex flex-col gap-4 sm:p-5", highlighted && "motion-safe:animate-pop-in")}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="font-heading text-[17px] font-semibold leading-snug text-ink sm:text-lg">
            <Link href={href} className="rounded-sm underline-offset-4 hover:underline">
              {trip.routeLabel}
            </Link>
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {formatKm(trip.distanceKm)} · {formatDuration(estimateDurationMins(trip.distanceKm))}
            {via.length ? <> · via {via.join(", ")}</> : null}
          </p>
        </div>
        <Badge tone={badge.tone} size="md">
          {badge.label}
        </Badge>
      </div>

      <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
        <div className="flex min-w-0 items-center gap-2 sm:col-span-2">
          <dt className="sr-only">Departure and arrival</dt>
          <CalendarDays aria-hidden="true" strokeWidth={1.75} className="size-[18px] shrink-0 text-green-500" />
          <dd className="min-w-0 text-ink">
            {when(trip.departureAt)} → {when(trip.arrivalAt)}
          </dd>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <dt className="sr-only">Vehicle</dt>
          <Truck aria-hidden="true" strokeWidth={1.75} className="size-[18px] shrink-0 text-green-500" />
          <dd className="min-w-0 truncate text-ink">
            {trip.vehicle.makeModel}
            <span className="text-ink-muted"> · {trip.vehicle.registrationNumber}</span>
          </dd>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <dt className="sr-only">Driver</dt>
          <UserRound aria-hidden="true" strokeWidth={1.75} className="size-[18px] shrink-0 text-green-500" />
          <dd className="min-w-0 truncate text-ink">{trip.driver.fullName}</dd>
        </div>
        <div className="flex min-w-0 items-center gap-2 sm:col-span-2">
          <dt className="sr-only">Rates</dt>
          <IndianRupee aria-hidden="true" strokeWidth={1.75} className="size-[18px] shrink-0 text-green-500" />
          <dd className="text-ink tabular-nums">
            {formatRate(trip.rates.perKmPaise)}/km · {formatRate(trip.rates.perKgPaise)}/kg
          </dd>
        </div>
      </dl>

      <div data-testid="route-capacity">
        <CapacityBar totalKg={trip.capacity.offeredKg} bookedKg={trip.capacity.bookedKg} reservedKg={trip.capacity.reservedKg} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
        {actions ?? (
          <>
            <p className="text-ink-muted">
              {plural(trip.counts.held, "booking")}
              {trip.counts.delivered ? ` · ${trip.counts.delivered} delivered` : ""}
            </p>
            {live && trip.counts.awaiting > 0 ? (
              <Link
                href={paths.agency.bookings("pending")}
                className="inline-flex min-h-11 items-center gap-1 rounded-sm font-semibold text-green-700 underline-offset-4 hover:underline"
              >
                <Badge tone="attention">{plural(trip.counts.awaiting, "pending request")}</Badge>
                <span className="sr-only"> for {trip.routeLabel}</span>
                <ChevronRight aria-hidden="true" strokeWidth={2} className="size-4" />
              </Link>
            ) : live ? (
              <p className="inline-flex min-h-11 items-center text-ink-subtle">No pending requests</p>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
