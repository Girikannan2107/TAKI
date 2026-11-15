import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, ChevronRight, CreditCard, Package, Star, Truck } from "lucide-react";
import { Badge, ButtonLink, Card, type BadgeTone } from "@/components/ui";
import type { CustomerBookingListItem } from "@/lib/api/contracts/customer";
import { paths } from "@/lib/config/routes";
import type { BookingStatus } from "@/lib/domain/model";
import { formatINR, formatInstantDate, formatKg } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { RouteText } from "@/features/customer-search/RouteText";
import { bookingStatusLabel, bookingStatusTone } from "@/features/customer-shipment/labels";

const NEEDS_PAYMENT: ReadonlyArray<BookingStatus> = ["pending_payment", "payment_failed"];

const STATUS_TEXT: Record<BadgeTone, string> = {
  success: "text-success-700",
  info: "text-info-700",
  warning: "text-warning-700",
  danger: "text-error",
  neutral: "text-ink-muted",
  lavender: "text-violet-700",
  paid: "text-green-800",
  attention: "text-coral-700",
};
const STATUS_DOT: Record<BadgeTone, string> = {
  success: "bg-green-600",
  info: "bg-info-700",
  warning: "bg-warning-700",
  danger: "bg-error",
  neutral: "bg-ink-subtle",
  lavender: "bg-violet-700",
  paid: "bg-green-800",
  attention: "bg-coral-700",
};

export function needsPayment(status: BookingStatus): boolean {
  return NEEDS_PAYMENT.includes(status);
}

export interface ShipmentListItemProps {
  item: CustomerBookingListItem;
  /** Compact row for the dashboard activity list. */
  compact?: boolean;
  headingLevel?: 2 | 3;
  className?: string;
}

/** One booking: route, booking ID, weight, pickup date, agency + vehicle, status, total, next action. Links to details. */
export function ShipmentListItem({ item, compact, headingLevel = 3, className }: ShipmentListItemProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const provider = [item.agencyName, item.vehicleClass].filter(Boolean).join(" · ");
  const pay = needsPayment(item.status);
  const rate = item.status === "delivered" && !item.reviewed;
  const tone = bookingStatusTone(item.status);
  const label = bookingStatusLabel(item.status);
  const pickupDate = formatInstantDate(item.pickup.expectedDepartureAt);

  if (compact) {
    return (
      <li className={cn("group relative flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-surface-muted", className)}>
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mint-100 text-green-700">
          <Package strokeWidth={1.75} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <Heading className="text-sm font-semibold text-ink">
            <Link
              href={paths.customer.tracking(item.id)}
              className="rounded-sm after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-green-700"
            >
              <RouteText from={item.pickup.placeName} to={item.drop.placeName} arrowClassName="size-3.5" />
              <span className="sr-only">, booking {item.id}</span>
            </Link>
          </Heading>
          <p className="mt-0.5 truncate text-caption text-ink-muted">
            <span className="tabular-nums">{item.id}</span> · {pickupDate}
          </p>
          <p className={cn("mt-1 flex items-center gap-1.5 text-caption font-semibold", STATUS_TEXT[tone])}>
            <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[tone])} />
            {label}
          </p>
        </div>
        <ChevronRight aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5" />
      </li>
    );
  }

  return (
    <Card as="li" padding="none" interactive className={cn("group", className)} data-testid="shipment-row">
      <div className="flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-center md:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Heading className="font-heading text-lg font-semibold text-ink">
              <Link
                href={paths.customer.tracking(item.id)}
                className="rounded-sm after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-green-700"
              >
                <RouteText from={item.pickup.placeName} to={item.drop.placeName} />
                <span className="sr-only">, booking {item.id}</span>
              </Link>
            </Heading>
            <Badge tone={tone}>{label}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            Booking ID <span className="font-semibold tabular-nums text-ink">{item.id}</span>
          </p>
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-muted">
            <Meta icon={<Package strokeWidth={1.75} />} label="Weight">
              {formatKg(item.weightKg)}
            </Meta>
            <Meta icon={<CalendarDays strokeWidth={1.75} />} label="Pickup date">
              {pickupDate}
            </Meta>
            {provider ? (
              <Meta icon={<Truck strokeWidth={1.75} />} label="Agency and vehicle">
                {provider}
              </Meta>
            ) : null}
          </dl>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4 md:flex-col md:items-end md:justify-center md:border-0 md:pt-0">
          <div className="md:text-right">
            <p className="text-caption text-ink-subtle">Total</p>
            <p className="type-amount-md text-price">{formatINR(item.totalPayable)}</p>
          </div>
          {pay ? (
            <ButtonLink href={paths.customer.payment(item.id)} size="sm" leadingIcon={<CreditCard strokeWidth={1.75} />} className="relative z-10">
              Pay now<span className="sr-only"> for {item.id}</span>
            </ButtonLink>
          ) : rate ? (
            <ButtonLink href={`${paths.customer.tracking(item.id)}#feedback`} size="sm" variant="outline" leadingIcon={<Star strokeWidth={1.75} />} className="relative z-10">
              Rate delivery<span className="sr-only"> for {item.id}</span>
            </ButtonLink>
          ) : (
            <span aria-hidden="true" className="inline-flex items-center gap-1 text-sm font-semibold text-green-700">
              View
              <ChevronRight strokeWidth={2} className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function Meta({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <dt className="sr-only">{label}</dt>
      <span aria-hidden="true" className="flex text-green-600 [&_svg]:size-4">
        {icon}
      </span>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}
