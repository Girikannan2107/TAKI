import Link from "next/link";
import { CalendarDays, ChevronRight, IndianRupee, Truck } from "lucide-react";
import { Badge, Card, type BadgeTone } from "@/components/ui";
import { paths } from "@/lib/config/routes";
import { ROUTE_STATUS_LABEL } from "@/lib/domain/labels";
import { getVehicleModel } from "@/lib/domain/vehicles";
import { formatDate, formatDuration, formatKm, formatNumber, formatRate, formatTime } from "@/lib/format";
import type { DriverRouteSummary } from "@/lib/store/selectors";
import { cn } from "@/lib/utils/cn";

function statusBadge(summary: DriverRouteSummary): { label: string; tone: BadgeTone } {
  const { status } = summary.route;
  if (status === "published") return summary.departed ? { label: "Departed", tone: "info" } : { label: ROUTE_STATUS_LABEL.published, tone: "success" };
  if (status === "completed") return { label: ROUTE_STATUS_LABEL.completed, tone: "neutral" };
  if (status === "cancelled") return { label: ROUTE_STATUS_LABEL.cancelled, tone: "danger" };
  return { label: ROUTE_STATUS_LABEL[status], tone: "neutral" };
}

export interface RouteCardProps {
  summary: DriverRouteSummary;
  highlighted?: boolean;
}

/** One route on My Routes: path, schedule, vehicle, capacity bar, rates, status and requests. */
export function RouteCard({ summary, highlighted }: RouteCardProps) {
  const { route, vehicle, pathLabel, pendingRequests, acceptedBookings } = summary;
  const badge = statusBadge(summary);
  const headingId = `route-${route.id}-title`;
  const vehicleName = vehicle ? (getVehicleModel(vehicle.modelId)?.label ?? vehicle.modelId) : "Vehicle";
  const total = route.totalCapacityKg;
  const available = Math.max(0, Math.min(route.availableCapacityKg, total));
  const pct = total > 0 ? Math.round((available / total) * 100) : 0;
  const isActive = route.status === "published";

  return (
    <Card
      as="article"
      aria-labelledby={headingId}
      tone={highlighted ? "selected" : "default"}
      padding="sm"
      data-testid="route-card"
      data-route-id={route.id}
      data-highlighted={highlighted || undefined}
      className={cn("flex flex-col gap-4 sm:p-5", highlighted && "motion-safe:animate-pop-in")}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="font-heading text-[17px] font-semibold leading-snug text-ink sm:text-lg">
            {pathLabel}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {formatKm(route.distanceKm)} · {formatDuration(route.durationMins)}
          </p>
        </div>
        <Badge tone={badge.tone} size="md">
          {badge.label}
        </Badge>
      </div>

      <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
        <div className="flex min-w-0 items-center gap-2">
          <dt className="sr-only">Date and departure</dt>
          <CalendarDays aria-hidden="true" strokeWidth={1.75} className="size-[18px] shrink-0 text-green-500" />
          <dd className="min-w-0 text-ink">
            {formatDate(route.travelDate)} · {formatTime(route.departureTime)}
          </dd>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <dt className="sr-only">Vehicle</dt>
          <Truck aria-hidden="true" strokeWidth={1.75} className="size-[18px] shrink-0 text-green-500" />
          <dd className="min-w-0 truncate text-ink">
            {vehicleName}
            {vehicle ? <span className="text-ink-muted"> · {vehicle.registrationNumber}</span> : null}
          </dd>
        </div>
        <div className="flex min-w-0 items-center gap-2 sm:col-span-2">
          <dt className="sr-only">Rates</dt>
          <IndianRupee aria-hidden="true" strokeWidth={1.75} className="size-[18px] shrink-0 text-green-500" />
          <dd className="text-ink tabular-nums">
            {formatRate(route.ratePerKmPaise)}/km · {formatRate(route.ratePerKgPaise)}/kg
          </dd>
        </div>
      </dl>

      <div>
        <p className="text-sm text-ink-muted" data-testid="route-capacity">
          <span className="font-semibold text-ink tabular-nums">{formatNumber(available)} kg</span> available of{" "}
          <span className="tabular-nums">{formatNumber(total)} kg</span>
        </p>
        <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
        <p className="text-ink-muted">
          {acceptedBookings} accepted {acceptedBookings === 1 ? "booking" : "bookings"}
        </p>
        {isActive && pendingRequests > 0 ? (
          <Link
            href={paths.driver.bookings()}
            className="inline-flex min-h-11 items-center gap-1 rounded-sm font-semibold text-green-700 underline-offset-4 hover:underline"
          >
            {pendingRequests} pending {pendingRequests === 1 ? "request" : "requests"}
            <span className="sr-only"> for {pathLabel}</span>
            <ChevronRight aria-hidden="true" strokeWidth={2} className="size-4" />
          </Link>
        ) : isActive ? (
          <p className="inline-flex min-h-11 items-center text-ink-subtle">No pending requests</p>
        ) : null}
      </div>
    </Card>
  );
}
