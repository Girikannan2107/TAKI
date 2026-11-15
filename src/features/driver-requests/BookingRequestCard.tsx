import Link from "next/link";
import { CalendarClock, ChevronRight, CircleAlert, Container, Package, Share2, Truck } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import type { AgencyBookingListItem } from "@/lib/api/contracts/agency";
import { paths } from "@/lib/config/routes";
import { formatINR, formatKg, formatNumber, shortName } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { when } from "@/features/agency/format";
import { BOOKING_STATUS, GOODS_LABEL, HANDLING_LABEL } from "@/features/agency/labels";

export type CardBusy = "accept" | "reject" | null;

export interface BookingRequestCardProps {
  booking: AgencyBookingListItem;
  busy: CardBusy;
  onAccept?(): void;
  onReject?(): void;
}

const SHARED = new Set(["confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"]);

/** Bookings board card (P3 §4.4): customer, pickup → drop, package, trip, earnings; Accept/Reject for pending requests. */
export function BookingRequestCard({ booking: b, busy, onAccept, onReject }: BookingRequestCardProps) {
  const routeText = `${b.pickup.placeName} → ${b.drop.placeName}`;
  const reasonId = `${b.id}-capacity-reason`;
  const titleId = `${b.id}-title`;
  const pending = b.status === "awaiting_agency";
  const muted = b.status === "rejected" || b.status === "cancelled";
  const overCapacity = pending && b.capacity !== null && b.capacity.afterAcceptKg < 0;
  const anyBusy = busy !== null;
  const status = BOOKING_STATUS[b.status];

  return (
    <Card
      as="li"
      padding="none"
      aria-labelledby={titleId}
      data-testid="booking-request-card"
      data-booking-id={b.id}
      className={cn("p-4 sm:p-5", muted && "bg-surface-muted shadow-none")}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5">
        <span
          aria-hidden="true"
          className={cn("flex size-12 items-center justify-center rounded-md [&_svg]:size-6", muted ? "bg-border text-ink-muted" : "bg-mint-100 text-green-700")}
        >
          <Package strokeWidth={1.75} />
        </span>

        <div className="min-w-0">
          <h3 id={titleId} className="font-heading text-base font-bold text-ink sm:text-lg">
            <Link href={paths.agency.booking(b.id)} className="rounded-sm underline-offset-4 hover:underline">
              {routeText}
            </Link>
          </h3>
          <p className="mt-1 text-sm text-ink-muted" data-testid="request-meta">
            {formatKg(b.weightKg)} · {GOODS_LABEL[b.goodsCategory]}
            <span aria-hidden="true" className="mx-2 text-border-strong">
              |
            </span>
            <span className="sr-only">, pickup </span>
            {when(b.pickup.expectedDepartureAt)}
          </p>
          {b.specialHandling.length ? (
            <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Special handling">
              {b.specialHandling.map((h) => (
                <li key={h}>
                  <Badge tone="neutral">{HANDLING_LABEL[h]}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1.5 text-sm text-ink">Customer: {shortName(b.customerName)}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">
            <Truck aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-green-500" />
            <span className="min-w-0 truncate">
              {b.vehicleReg} · departs {when(b.tripDepartureAt)}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span className="text-caption text-ink-subtle">{b.id}</span>
          </div>
        </div>

        <div
          className={cn(
            "col-span-2 flex items-center justify-between gap-3 rounded-md px-3.5 py-2.5 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:flex-col sm:items-center sm:justify-center sm:px-5 sm:py-3",
            muted ? "bg-border/60" : "bg-mint-100",
          )}
        >
          <span className="text-[13px] font-medium text-ink-muted">{muted ? "Earnings" : "Your Earnings"}</span>
          <span className={cn("type-amount-lg", muted ? "text-ink-muted line-through decoration-1" : "text-price")} data-testid="request-earnings">
            {formatINR(b.earnings)}
          </span>
        </div>

        <div className="col-span-2 flex min-w-0 flex-col gap-2.5 sm:col-span-2 sm:col-start-2">
          {pending ? (
            <>
              {b.capacity ? (
                <p className="flex items-center gap-1.5 text-sm text-ink-muted">
                  <Container aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-green-500" />
                  {formatKg(b.capacity.availableKg)} left · capacity after accepting: {formatKg(Math.max(0, b.capacity.afterAcceptKg))}
                </p>
              ) : null}
              <p className="flex items-center gap-1.5 text-sm text-ink-muted">
                <CalendarClock aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
                Respond by {when(b.respondBy)}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                <Button
                  fullWidth
                  onClick={onAccept}
                  loading={busy === "accept"}
                  disabled={overCapacity || anyBusy}
                  aria-label={`Accept ${routeText} request ${b.id}`}
                  aria-describedby={overCapacity ? reasonId : undefined}
                >
                  Accept
                </Button>
                <Button variant="outline" fullWidth onClick={onReject} loading={busy === "reject"} disabled={anyBusy} aria-label={`Reject ${routeText} request ${b.id}`}>
                  Reject
                </Button>
              </div>
              {overCapacity && b.capacity ? (
                <p id={reasonId} className="flex items-start gap-1.5 text-sm font-medium text-warning-700" data-testid="capacity-reason">
                  <CircleAlert aria-hidden="true" strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Not enough capacity — {formatNumber(b.capacity.availableKg)} kg left, needs {formatNumber(b.weightKg)} kg
                  </span>
                </p>
              ) : null}
            </>
          ) : b.status === "pending_payment" || b.status === "payment_failed" ? (
            <p className="text-sm text-ink-muted">
              {formatKg(b.weightKg)} reserved. {b.paymentDueAt ? `The customer has until ${when(b.paymentDueAt)} to pay.` : "Waiting for the customer to pay."}
            </p>
          ) : SHARED.has(b.status) ? (
            <p className="flex items-center gap-1.5 text-sm text-ink-muted">
              <Share2 aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-green-500" />
              Customer & receiver details shared with {b.driverName}
            </p>
          ) : null}
          <Link
            href={paths.agency.booking(b.id)}
            className="inline-flex min-h-11 w-fit items-center gap-1 rounded-sm text-sm font-semibold text-green-700 underline-offset-4 hover:underline"
          >
            View details<span className="sr-only"> for {b.id}</span>
            <ChevronRight aria-hidden="true" strokeWidth={2} className="size-4" />
          </Link>
        </div>
      </div>
    </Card>
  );
}
