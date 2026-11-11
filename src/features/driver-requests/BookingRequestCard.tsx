import { CalendarClock, CircleAlert, CircleCheck, Container, Package } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { cityName } from "@/lib/domain/cities";
import { canMarkPickedUp } from "@/lib/domain/commands";
import { driverStatusLabel, statusTone } from "@/lib/domain/labels";
import type { BookingStatus } from "@/lib/domain/types";
import { formatDate, formatINR, formatKg, formatNumber, shortName } from "@/lib/format";
import type { DriverRequest } from "@/lib/store/selectors";
import { getNow } from "@/lib/utils/clock";
import { cn } from "@/lib/utils/cn";

/** Next driver action for an accepted shipment (one transition each). */
export const NEXT_ACTION: Partial<Record<BookingStatus, string>> = {
  confirmed: "Mark picked up",
  picked_up: "Start transit",
  in_transit: "Mark out for delivery",
  out_for_delivery: "Mark delivered",
};

export type CardBusy = "accept" | "decline" | "advance" | null;

export interface BookingRequestCardProps {
  request: DriverRequest;
  busy: CardBusy;
  onAccept?(): void;
  onDecline?(): void;
  onAdvance?(): void;
}

/** Board card for one booking request (pending, accepted, declined or withdrawn). */
export function BookingRequestCard({ request, busy, onAccept, onDecline, onAdvance }: BookingRequestCardProps) {
  const { booking, status, customerName, earnings, routeAvailableKg, overCapacity } = request;
  const { shipment } = booking;
  const routeText = `${cityName(shipment.sourceCityId)} → ${cityName(shipment.destinationCityId)}`;
  const reasonId = `${booking.id}-capacity-reason`;
  const titleId = `${booking.id}-title`;
  const muted = status === "declined" || status === "withdrawn";
  const nextAction = status === "accepted" ? NEXT_ACTION[booking.status] : undefined;
  const anyBusy = busy !== null;
  /** Only the pickup step is date-gated (domain rule): not before the shipment's pickup date. */
  const pickupLocked = booking.status === "confirmed" && !canMarkPickedUp(booking, getNow());
  const pickupHintId = `${booking.id}-pickup-hint`;

  return (
    <Card
      as="li"
      padding="none"
      aria-labelledby={titleId}
      data-testid="booking-request-card"
      data-booking-id={booking.id}
      className={cn("p-4 sm:p-5", muted && "bg-surface-muted shadow-none")}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-12 items-center justify-center rounded-md [&_svg]:size-6",
            muted ? "bg-border text-ink-muted" : "bg-mint-100 text-green-700",
          )}
        >
          <Package strokeWidth={1.75} />
        </span>

        <div className="min-w-0">
          <h3 id={titleId} className="font-heading text-base font-bold text-ink sm:text-lg">
            {routeText}
          </h3>
          <p className="mt-1 text-sm text-ink-muted" data-testid="request-meta">
            {formatKg(shipment.weightKg)}
            <span aria-hidden="true" className="mx-2 text-border-strong">
              |
            </span>
            <span className="sr-only">, pickup </span>
            {formatDate(shipment.pickupDate)}
          </p>
          <p className="mt-1.5 text-sm text-ink">Customer: {shortName(customerName)}</p>
          {status !== "pending" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(booking.status)}>{driverStatusLabel(booking.status)}</Badge>
              <span className="text-caption text-ink-subtle">{booking.id}</span>
            </div>
          ) : null}
        </div>

        <div
          className={cn(
            "col-span-2 flex items-center justify-between gap-3 rounded-md px-3.5 py-2.5 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:flex-col sm:items-center sm:justify-center sm:px-5 sm:py-3",
            muted ? "bg-border/60" : "bg-mint-100",
          )}
        >
          <span className="text-[13px] font-medium text-ink-muted">{muted ? "Earnings" : "Your Earnings"}</span>
          <span
            className={cn("type-amount-lg", muted ? "text-ink-muted line-through decoration-1" : "text-price")}
            data-testid="request-earnings"
          >
            {formatINR(earnings)}
          </span>
        </div>

        {status === "pending" || nextAction || booking.status === "delivered" ? (
          <div className="col-span-2 flex min-w-0 flex-col gap-2.5 sm:col-span-2 sm:col-start-2">
            {status === "pending" ? (
              <>
                <p className="flex items-center gap-1.5 text-sm text-ink-muted">
                  <Container aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-green-500" />
                  {formatKg(routeAvailableKg)} left on this route
                </p>
                <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                  <Button
                    fullWidth
                    onClick={onAccept}
                    loading={busy === "accept"}
                    disabled={overCapacity || anyBusy}
                    aria-label={`Accept ${routeText} request`}
                    aria-describedby={overCapacity ? reasonId : undefined}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="outline"
                    fullWidth
                    onClick={onDecline}
                    loading={busy === "decline"}
                    disabled={anyBusy}
                    aria-label={`Decline ${routeText} request`}
                  >
                    Decline
                  </Button>
                </div>
                {overCapacity ? (
                  <p id={reasonId} className="flex items-start gap-1.5 text-sm font-medium text-warning-700" data-testid="capacity-reason">
                    <CircleAlert aria-hidden="true" strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
                    <span>
                      Not enough capacity — {formatNumber(routeAvailableKg)} kg left, needs {formatNumber(shipment.weightKg)} kg
                    </span>
                  </p>
                ) : null}
              </>
            ) : nextAction ? (
              <>
                <Button
                  className="w-full sm:w-auto sm:self-start"
                  onClick={onAdvance}
                  loading={busy === "advance"}
                  disabled={anyBusy || pickupLocked}
                  aria-label={`${nextAction}: ${routeText}, ${booking.id}`}
                  aria-describedby={pickupLocked ? pickupHintId : undefined}
                >
                  {nextAction}
                </Button>
                {pickupLocked ? (
                  <p id={pickupHintId} className="flex items-center gap-1.5 text-sm text-ink-muted" data-testid="pickup-hint">
                    <CalendarClock aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
                    Available on {formatDate(shipment.pickupDate)}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="flex items-center gap-1.5 text-sm font-semibold text-success-700">
                <CircleCheck aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />
                Earnings credited
              </p>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
