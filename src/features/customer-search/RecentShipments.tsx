import Link from "next/link";
import { ArrowRight, Bell } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import type { NotificationDTO } from "@/lib/api/contracts/common";
import type { CustomerBookingListItem } from "@/lib/api/contracts/customer";
import { paths } from "@/lib/config/routes";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { ShipmentListItem } from "@/features/shipments/ShipmentListItem";

/** Dashboard "Recent activity": active bookings plus the latest notifications, each linking to the details page. */
export function RecentShipments({
  active,
  activity,
  className,
}: {
  active: readonly CustomerBookingListItem[];
  activity: readonly NotificationDTO[];
  className?: string;
}) {
  const recent = active.slice(0, 3);
  const events = activity.slice(0, 5);
  return (
    <Card as="section" padding="md" aria-labelledby="recent-activity-heading" className={cn("xl:sticky xl:top-6", className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="recent-activity-heading" className="type-h3 text-ink">
          Recent activity
        </h2>
        <Link
          href={paths.customer.shipments}
          className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-semibold text-green-700 hover:text-green-800 hover:underline"
        >
          View all
          <ArrowRight aria-hidden="true" strokeWidth={2} className="size-4" />
        </Link>
      </div>
      {recent.length === 0 && events.length === 0 ? (
        <EmptyState title="No activity yet" description="Your shipments and their updates will appear here." headingLevel={3} className="py-6" />
      ) : null}
      {recent.length ? (
        <ul aria-label="Active shipments" className="-mx-2 flex flex-col divide-y divide-border">
          {recent.map((b) => (
            <ShipmentListItem key={b.id} item={b} compact />
          ))}
        </ul>
      ) : null}
      {events.length ? (
        <>
          <h3 className="mt-4 text-sm font-semibold text-ink-muted">Latest updates</h3>
          <ul className="-mx-2 mt-1 flex flex-col divide-y divide-border">
            {events.map((n) => (
              <ActivityRow key={n.id} n={n} />
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

function ActivityRow({ n }: { n: NotificationDTO }) {
  const href = n.link?.type === "booking" ? paths.customer.tracking(n.link.id) : null;
  const body = (
    <>
      <span aria-hidden="true" className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-green-700">
        <Bell strokeWidth={1.75} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{n.title}</span>
        <span className="mt-0.5 block text-caption text-ink-muted">{n.body}</span>
        <span className="mt-0.5 block text-caption text-ink-subtle tabular-nums">{formatDateTime(n.createdAt)}</span>
      </span>
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="flex gap-3 rounded-md px-2 py-3 hover:bg-surface-muted">
          {body}
        </Link>
      ) : (
        <div className="flex gap-3 px-2 py-3">{body}</div>
      )}
    </li>
  );
}
