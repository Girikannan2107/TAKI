"use client";

import { ArrowRight, CircleCheckBig, MapPinned, PackageCheck, Route, Truck } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Badge, ButtonLink, CapacityBar, Card, EmptyState, Skeleton, StatCard } from "@/components/ui";
import type { DriverDashboardDTO, DriverTripListItem } from "@/lib/api/contracts/driver";
import { driverApi } from "@/lib/api/client/driver";
import { paths } from "@/lib/config/routes";
import { formatDateTime, firstName } from "@/lib/format";
import { AgencyApprovalCard } from "./AgencyApprovalCard";
import { TRIP_STATUS_LABEL } from "./labels";
import { LoadError, ShipmentCard } from "./parts";
import { useResource } from "./useResource";

/** Driver dashboard (P3 §4.5): approval gate, 2×2 stats, current trip, next pickups. */
export function DriverDashboardView() {
  const { state, reload } = useResource((signal) => driverApi.dashboard(signal), "dashboard");

  if (state.status === "loading") return <DashboardLoading />;
  if (state.status === "error") {
    return (
      <>
        <TopBar title="Dashboard" />
        <LoadError message={state.message} onRetry={reload} className="mt-6" />
      </>
    );
  }
  const d = state.data;
  return (
    <>
      <TopBar title={`Hi, ${firstName(d.driver.fullName)}`} emoji="👋" subtitle={d.agency?.status === "active" ? d.agency.agencyName : "Driver app"} />
      <div className="mt-6 flex flex-col gap-6">
        {!d.approved ? <AgencyApprovalCard agency={d.agency} onRequested={reload} /> : <ApprovedDashboard d={d} />}
      </div>
    </>
  );
}

function ApprovedDashboard({ d }: { d: DriverDashboardDTO }) {
  const nothing = d.activeTrips + d.pendingPickups + d.inTransit + d.completedDeliveries === 0 && !d.nextTrip;
  return (
    <>
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Active trips" value={d.activeTrips} icon={<Route />} />
        <StatCard label="Pending pickups" value={d.pendingPickups} icon={<PackageCheck />} href={paths.driver.shipments("pickup")} />
        <StatCard label="In transit" value={d.inTransit} icon={<Truck />} href={paths.driver.shipments("transit")} />
        <StatCard label="Completed deliveries" value={d.completedDeliveries} icon={<CircleCheckBig />} href={paths.driver.history()} />
      </section>

      {nothing ? (
        <EmptyState
          icon={<Truck />}
          title="No trips assigned yet"
          description="Your agency will assign you to trips. They'll appear here with the shipments to pick up."
          action={{ label: "View my profile", href: paths.driver.profile }}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          {d.nextTrip ? <CurrentTripCard trip={d.nextTrip} /> : <NoTripCard />}
          <section aria-labelledby="next-actions" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 id="next-actions" className="type-h3 text-ink">
                Next pickups
              </h2>
              {d.pendingPickups > 0 ? (
                <ButtonLink href={paths.driver.shipments("pickup")} variant="ghost" size="sm" trailingIcon={<ArrowRight className="size-4" aria-hidden="true" />}>
                  See all
                </ButtonLink>
              ) : null}
            </div>
            {d.nextActions.length === 0 ? (
              <Card tone="muted" padding="sm">
                <p className="text-sm text-ink-muted">No pickups waiting. Paid shipments on your trips will appear here.</p>
              </Card>
            ) : (
              <ul className="flex flex-col gap-3">
                {d.nextActions.map((s) => (
                  <li key={s.bookingId}>
                    <ShipmentCard item={s} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function CurrentTripCard({ trip }: { trip: DriverTripListItem }) {
  const running = trip.status === "in_progress";
  return (
    <Card as="section" tone="brand" aria-labelledby="current-trip" className="flex flex-col gap-4" data-surface="dark">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-white/80">{running ? "Current trip" : "Next trip"}</p>
          <h2 id="current-trip" className="type-h3 mt-0.5 text-white">
            {trip.routeLabel}
          </h2>
          <p className="mt-1 text-sm text-white/80">
            {trip.vehicle.registrationNumber} · {trip.vehicle.vehicleClass}
          </p>
        </div>
        <Badge tone={running ? "paid" : "neutral"}>{TRIP_STATUS_LABEL[trip.status]}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-white/75">Departs</dt>
          <dd className="font-semibold tabular-nums text-white">{formatDateTime(trip.departureAt)}</dd>
        </div>
        <div>
          <dt className="text-white/75">Shipments</dt>
          <dd className="font-semibold tabular-nums text-white">{trip.shipmentCount}</dd>
        </div>
        {trip.nextStep ? (
          <div className="col-span-2">
            <dt className="text-white/75">Next stop</dt>
            <dd className="flex items-center gap-1.5 font-semibold text-white">
              <MapPinned aria-hidden="true" className="size-4" />
              {trip.nextStep.kind === "arrive" ? "Arrive at" : "Depart"} {trip.nextStep.placeName}
              {trip.nextStep.expectedAt ? <span className="font-normal text-white/80"> · {formatDateTime(trip.nextStep.expectedAt)}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
      <CapacityBar surface="dark" totalKg={trip.capacity.offeredKg} bookedKg={trip.capacity.bookedKg} reservedKg={trip.capacity.reservedKg} />
      <ButtonLink href={paths.driver.trip(trip.id)} variant="lime" fullWidth trailingIcon={<ArrowRight className="size-4" aria-hidden="true" />}>
        Open trip
      </ButtonLink>
    </Card>
  );
}

function NoTripCard() {
  return (
    <Card tone="muted" className="flex flex-col gap-1">
      <h2 className="type-h3 text-ink">No upcoming trip</h2>
      <p className="text-sm text-ink-muted">Your agency hasn&apos;t scheduled another trip for you yet.</p>
    </Card>
  );
}

function DashboardLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading your dashboard…</span>
      <Skeleton className="h-10 w-48" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32 w-full" rounded="md" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 w-full" rounded="md" />
        <Skeleton className="h-64 w-full" rounded="md" />
      </div>
    </div>
  );
}
