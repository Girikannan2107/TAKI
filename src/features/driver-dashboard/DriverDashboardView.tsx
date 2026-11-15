"use client";

import Link from "next/link";
import { Bell, CalendarClock, ChevronRight, CircleCheckBig, ClipboardList, IdCard, Plus, Route as RouteIcon, Truck } from "lucide-react";
import { ButtonLink, Card, EmptyState, Skeleton, StatCard } from "@/components/ui";
import { SectionHeader, SectionLink } from "@/components/layout/SectionHeader";
import { TopBar } from "@/components/layout/TopBar";
import { agencyApi } from "@/lib/api/client/agency";
import type { AgencyDashboardDTO } from "@/lib/api/contracts/agency";
import { paths } from "@/lib/config/routes";
import { pad2 } from "@/lib/format";
import { agencyLinkHref, when } from "@/features/agency/format";
import { LoadError, VerificationBanner } from "@/features/agency/states";
import { useApi } from "@/features/agency/useApi";
import { RouteCard } from "@/features/driver-routes/RouteCard";
import { EarningsHeroCard } from "./EarningsHeroCard";

const ICON = { strokeWidth: 1.75 } as const;

/** Agency Dashboard (`/agency/dashboard`, P3 §4.4). Every number is a live count from /api/agency/dashboard. */
export function DriverDashboardView() {
  const { state, reload } = useApi("dashboard", agencyApi.dashboard);

  if (state.status === "loading") {
    return (
      <>
        <TopBar title={<Skeleton className="h-9 w-48" />} subtitle="Your fleet, trips and bookings at a glance." />
        <DashboardSkeleton />
      </>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <TopBar title="Dashboard" />
        <LoadError message={state.message} onRetry={reload} title="We couldn't load your dashboard" />
      </>
    );
  }
  return <Dashboard data={state.data} />;
}

/** Same component under its v2 name. */
export const AgencyDashboardView = DriverDashboardView;

function Dashboard({ data }: { data: AgencyDashboardDTO }) {
  const first = data.agency.ownerName.split(" ")[0] || data.agency.ownerName;
  const stats = [
    { label: "Vehicles", value: data.totals.vehicles, icon: <Truck {...ICON} />, href: paths.agency.vehicles },
    {
      label: data.totals.pendingDrivers ? `Drivers (+${data.totals.pendingDrivers} pending)` : "Drivers",
      value: data.totals.drivers,
      icon: <IdCard {...ICON} />,
      href: paths.agency.drivers(data.totals.pendingDrivers ? "pending" : undefined),
    },
    { label: "Active Trips", value: data.trips.active, icon: <RouteIcon {...ICON} />, href: paths.agency.trips({ tab: "active" }) },
    { label: "Upcoming Trips", value: data.trips.upcoming, icon: <CalendarClock {...ICON} />, href: paths.agency.trips({ tab: "upcoming" }) },
    { label: "Pending Bookings", value: data.pendingBookings, icon: <ClipboardList {...ICON} />, href: paths.agency.bookings("pending") },
    { label: "Completed Shipments", value: data.completedShipments, icon: <CircleCheckBig {...ICON} />, href: paths.agency.history({ type: "bookings" }) },
  ];

  return (
    <>
      <TopBar
        title={`Hi, ${first}`}
        emoji="👋"
        subtitle={data.agency.name}
        actions={
          <ButtonLink href={paths.agency.newTrip()} variant="accent" leadingIcon={<Plus aria-hidden="true" strokeWidth={2.25} />}>
            Add Trip
          </ButtonLink>
        }
      />

      <div className="flex flex-col gap-5 lg:gap-6">
        <VerificationBanner status={data.agency.verification} reason={data.agency.verificationReason} />
        {data.pendingBookings > 0 ? <PendingRequestsAlert count={data.pendingBookings} /> : null}

        <div>
          <EarningsHeroCard
            amount={data.revenue.thisMonth}
            changePct={data.revenue.changePct}
            series={data.revenue.monthlySeries.map((m) => m.amount)}
            href={paths.agency.earnings()}
          />
          {data.revenue.total === 0 ? <p className="mt-2 text-sm text-ink-muted">Revenue appears after your first delivery.</p> : null}
        </div>

        <section aria-labelledby="agency-stats-heading">
          <h2 id="agency-stats-heading" className="sr-only">
            Your activity
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6" data-testid="agency-stats">
            {stats.map((s) => (
              <li key={s.label} className="flex">
                <StatCard
                  className={s.label === "Pending Bookings" && s.value > 0 ? "w-full border-lime-400 ring-2 ring-lime-300" : "w-full"}
                  label={s.label}
                  value={pad2(s.value)}
                  icon={s.icon}
                  href={s.href}
                />
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
          <section aria-labelledby="upcoming-trips-heading">
            <SectionHeader id="upcoming-trips-heading" title="Upcoming trips" action={<SectionLink href={paths.agency.trips({ tab: "upcoming" })} />} />
            {data.upcomingTrips.length === 0 ? (
              <EmptyState
                icon={<RouteIcon strokeWidth={1.75} />}
                title="No upcoming trips"
                description="Publish a trip so customers can book space on it."
                action={{ label: "Add Trip", href: paths.agency.newTrip() }}
                headingLevel={3}
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {data.upcomingTrips.map((t) => (
                  <li key={t.id}>
                    <RouteCard trip={t} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="activity-heading">
            <SectionHeader id="activity-heading" title="Recent activity" />
            {data.recentActivity.length === 0 ? (
              <EmptyState icon={<Bell strokeWidth={1.75} />} title="No activity yet" description="Booking requests, payments and deliveries will show up here." headingLevel={3} />
            ) : (
              <Card padding="none">
                <ul className="divide-y divide-border" data-testid="recent-activity">
                  {data.recentActivity.map((n) => {
                    const href = agencyLinkHref(n.link);
                    const body = (
                      <>
                        <p className="font-semibold text-ink">{n.title}</p>
                        <p className="mt-0.5 text-sm text-ink-muted">{n.body}</p>
                        <p className="mt-1 text-xs text-ink-subtle">{when(n.createdAt)}</p>
                      </>
                    );
                    return (
                      <li key={n.id}>
                        {href ? (
                          <Link href={href} className="block min-h-11 px-4 py-3 hover:bg-surface-muted focus-visible:bg-surface-muted">
                            {body}
                          </Link>
                        ) : (
                          <div className="px-4 py-3">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5 lg:gap-6">
      <span className="sr-only">Loading your dashboard…</span>
      <Skeleton className="h-44 rounded-lg sm:h-40" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-[72px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-13 rounded-md" />
    </div>
  );
}

/** Lime call to action when customers are waiting for an answer (requests expire before pickup). */
function PendingRequestsAlert({ count }: { count: number }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border border-lime-400 bg-lime-100 px-4 py-3 text-green-950 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex items-start gap-2.5 text-sm font-medium">
        <ClipboardList aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-5 shrink-0" />
        <span>
          {count === 1 ? "1 booking request is" : `${count} booking requests are`} waiting for your answer. Requests expire if you don&apos;t respond
          before pickup.
        </span>
      </p>
      <ButtonLink href={paths.agency.bookings("pending")} size="sm" trailingIcon={<ChevronRight aria-hidden="true" strokeWidth={2} />} className="shrink-0 self-start sm:self-auto">
        Review requests
      </ButtonLink>
    </div>
  );
}
