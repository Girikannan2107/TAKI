"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui";
import { paths } from "@/lib/config/routes";
import { useCustomerBookings } from "@/lib/store/selectors";
import { cn } from "@/lib/utils/cn";
import { ShipmentListItem } from "@/features/shipments/ShipmentListItem";

/** Up to 3 most recent shipments (secondary to the form). Renders nothing when there are none. */
export function RecentShipments({ className }: { className?: string }) {
  const bookings = useCustomerBookings();
  const recent = bookings.slice(0, 3);
  if (recent.length === 0) return null;

  return (
    <Card as="section" padding="md" aria-labelledby="recent-shipments-heading" className={cn("xl:sticky xl:top-6", className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="recent-shipments-heading" className="type-h3 text-ink">
          Recent shipments
        </h2>
        <Link
          href={paths.customer.shipments}
          className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-semibold text-green-700 hover:text-green-800 hover:underline"
        >
          View all
          <ArrowRight aria-hidden="true" strokeWidth={2} className="size-4" />
        </Link>
      </div>
      <ul className="-mx-2 flex flex-col divide-y divide-border">
        {recent.map((d) => (
          <ShipmentListItem key={d.booking.id} details={d} compact />
        ))}
      </ul>
    </Card>
  );
}
