"use client";

import Link from "next/link";
import { CalendarDays, ChevronRight, CircleCheckBig, ClipboardList, PackageOpen, Plus, Waypoints } from "lucide-react";
import { ButtonLink, Card, Skeleton, StatCard } from "@/components/ui";
import { TopBar } from "@/components/layout/TopBar";
import { paths } from "@/lib/config/routes";
import { formatDate, formatKg, formatNumber, formatTime, pad2 } from "@/lib/format";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { useDriverRoutes, useDriverStats, useEarnings, useSession, type DriverRouteSummary } from "@/lib/store/selectors";
import { EarningsHeroCard } from "./EarningsHeroCard";

const ICON = { strokeWidth: 1.75 } as const;

/** Screen 11 — Driver Dashboard (`/driver/dashboard`). Every number comes from the store. */
export function DriverDashboardView() {
  const hydrated = useHydrated();
  const { user } = useSession();
  const stats = useDriverStats();
  const earnings = useEarnings();
  const routes = useDriverRoutes();

  const title = user ? `Hi, ${user.firstName}` : hydrated ? "Hi there" : <Skeleton className="h-9 w-48" />;
  const header = <TopBar title={title} emoji={user ? "👋" : undefined} subtitle="Your journey, your earnings." />;

  if (!hydrated || !stats || !earnings) {
    return (
      <>
        {header}
        <DashboardSkeleton />
      </>
    );
  }

  const upcoming = routes.filter((r) => r.route.status === "published" && !r.departed).slice(0, 2);
  const capacity = stats.nextRouteAvailableCapacityKg;

  return (
    <>
      {header}

      <div className="flex flex-col gap-5 lg:gap-6">
        <EarningsHeroCard
          amount={stats.earningsThisMonth}
          changePct={stats.changePctVsLastMonth}
          series={earnings.summary.monthlySeries.map((m) => m.amount)}
          href={paths.driver.earnings}
        />

        <section aria-labelledby="driver-stats-heading">
          <h2 id="driver-stats-heading" className="sr-only">
            Your activity
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4" data-testid="driver-stats">
            <li className="flex">
              <StatCard
                className="w-full"
                label="Active Routes"
                value={pad2(stats.activeRoutes)}
                icon={<Waypoints {...ICON} />}
                href={paths.driver.routes()}
              />
            </li>
            <li className="flex">
              <StatCard
                className="w-full"
                label="Booking Requests"
                value={pad2(stats.pendingRequests)}
                icon={<ClipboardList {...ICON} />}
                href={paths.driver.bookings()}
              />
            </li>
            <li className="flex">
              <StatCard
                className="w-full"
                label="Completed Trips"
                value={pad2(stats.completedTrips)}
                icon={<CircleCheckBig {...ICON} />}
                href={paths.driver.routes({ status: "completed" })}
              />
            </li>
            <li className="flex">
              <StatCard
                className="w-full"
                label="Available Capacity"
                value={capacity === null ? "—" : formatNumber(capacity)}
                unit={capacity === null ? undefined : "kg"}
                icon={<PackageOpen {...ICON} />}
                href={paths.driver.routes()}
              />
            </li>
          </ul>
        </section>

        <ButtonLink href={paths.driver.newRoute} size="lg" fullWidth leadingIcon={<Plus aria-hidden="true" strokeWidth={2.25} />}>
          Post a New Route
        </ButtonLink>

        {upcoming.length > 0 ? <UpcomingRoutes items={upcoming} /> : null}
      </div>
    </>
  );
}

function UpcomingRoutes({ items }: { items: DriverRouteSummary[] }) {
  return (
    <section aria-labelledby="upcoming-routes-heading" className="mt-2">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="upcoming-routes-heading" className="type-h3 text-ink">
          Upcoming routes
        </h2>
        <Link
          href={paths.driver.routes()}
          className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-semibold text-green-700 underline-offset-4 hover:underline"
        >
          View all
          <ChevronRight aria-hidden="true" strokeWidth={2} className="size-4" />
        </Link>
      </div>
      <ul className="grid gap-3 md:grid-cols-2 md:gap-4">
        {items.map(({ route, pathLabel, pendingRequests }) => (
          <li key={route.id} className="flex">
            <Card padding="sm" interactive className="flex w-full flex-col gap-2">
              <Link
                href={paths.driver.routes()}
                className="font-heading text-base font-semibold text-ink after:absolute after:inset-0 after:rounded-lg after:content-['']"
              >
                {pathLabel}
              </Link>
              <p className="flex items-center gap-1.5 text-sm text-ink-muted">
                <CalendarDays aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-green-500" />
                {formatDate(route.travelDate)} · {formatTime(route.departureTime)}
              </p>
              <p className="text-sm text-ink-muted">
                <span className="font-semibold text-ink">{formatKg(route.availableCapacityKg)}</span> available
                {pendingRequests > 0 ? (
                  <>
                    <span aria-hidden="true" className="mx-1.5 text-border-strong">
                      ·
                    </span>
                    {pendingRequests} pending {pendingRequests === 1 ? "request" : "requests"}
                  </>
                ) : null}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5 lg:gap-6">
      <span className="sr-only">Loading your dashboard…</span>
      <Skeleton className="h-44 rounded-lg sm:h-40" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-36 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-13 rounded-md" />
    </div>
  );
}
