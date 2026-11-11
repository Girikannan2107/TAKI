"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { CircleAlert, MapPin, PackageSearch, Truck, Wand2 } from "lucide-react";
import { Badge, Button, ButtonLink, Card, EmptyState, Modal, Skeleton, useToast } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { RouteMap } from "@/features/booking/RouteMap";
import { paths } from "@/lib/config/routes";
import { isDemo } from "@/lib/config/env";
import { cityName } from "@/lib/domain/cities";
import { customerStatusLabel, statusTone } from "@/lib/domain/labels";
import { getVehicleModel, vehicleImageSrc } from "@/lib/domain/vehicles";
import { formatDate, formatKg, formatTime, routeLabel } from "@/lib/format";
import { errorMessage, marketplace } from "@/lib/services/marketplace";
import { BookingIdCopy } from "./BookingIdCopy";
import { CancelPaidBooking } from "./CancelPaidBooking";
import { PAYABLE_STATUSES, TERMINAL_STATUSES, shipmentPath, useOwnedBooking } from "./booking-access";
import { StatusTimeline } from "./StatusTimeline";

const MAP_CAPTION = "Illustrative route — not live location";

/** Screen 10 — `/customer/tracking/[bookingId]`. */
export function TrackingView() {
  const params = useParams<{ bookingId: string }>();
  const bookingId = params?.bookingId ? decodeURIComponent(params.bookingId) : null;
  const { ready, details } = useOwnedBooking(bookingId);
  const { toast } = useToast();
  const [mapOpen, setMapOpen] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const helperId = useId();

  const header = <PageHeader title="Track Shipment" backHref={paths.customer.shipments} backLabel="Back to my shipments" />;

  if (!ready) {
    return (
      <>
        {header}
        <TrackingSkeleton />
      </>
    );
  }

  if (!details) {
    return (
      <>
        {header}
        <EmptyState
          icon={<PackageSearch strokeWidth={1.75} />}
          title="Shipment not found"
          description="We couldn't find this shipment on your account. Check the booking ID and try again."
          action={{ label: "View my shipments", href: paths.customer.shipments }}
        />
      </>
    );
  }

  const { booking, route, vehicle, driver, payments } = details;
  const provider = driver?.businessName ?? "The transport provider";
  const pathIds = shipmentPath(booking, route);
  const model = vehicle ? getVehicleModel(vehicle.modelId) : undefined;
  const unpaid = PAYABLE_STATUSES.includes(booking.status) || booking.status === "draft";
  const stopped = booking.status === "declined" || booking.status === "cancelled";
  const refunded = payments.some((p) => p.status === "refunded");
  const canSimulate = isDemo && !unpaid && !TERMINAL_STATUSES.includes(booking.status);

  async function simulate() {
    if (simulating) return;
    setSimulating(true);
    setSimError(null);
    try {
      const next = await marketplace.simulateNextUpdate(booking.id);
      toast({ title: `Status updated: ${customerStatusLabel(next.status)}`, description: "Demo simulation — not real tracking.", tone: "success" });
    } catch (e) {
      const msg = errorMessage(e);
      setSimError(msg);
      toast({ title: "Couldn't update the demo shipment", description: msg, tone: "error" });
    } finally {
      setSimulating(false);
    }
  }

  let progress: ReactNode;
  if (unpaid) {
    progress = (
      <Notice tone="warning" title={customerStatusLabel(booking.status)}>
        <p>This booking hasn&apos;t been paid yet, so there is nothing to track.</p>
        <ButtonLink href={paths.customer.payment(booking.id)} size="sm" className="mt-3">
          Complete payment
        </ButtonLink>
      </Notice>
    );
  } else if (stopped) {
    progress = (
      <Notice tone="danger" title={booking.status === "declined" ? "Declined by driver — refund issued (demo)" : "Booking cancelled"}>
        <p>
          {booking.status === "declined" ? `${provider} couldn't take this shipment. ` : "This booking was cancelled. "}
          {refunded ? "Your demo payment has been refunded — no money moved." : "No money was taken."}
        </p>
        <ButtonLink href={paths.customer.dashboard} size="sm" className="mt-3">
          Find another vehicle
        </ButtonLink>
      </Notice>
    );
  } else {
    progress = <StatusTimeline booking={booking} providerName={provider} />;
  }

  return (
    <>
      {header}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:grid-rows-[auto_1fr] lg:gap-6">
        <Card as="section" aria-labelledby="progress-heading" padding="md" className="lg:row-span-2 lg:self-start">
          <div className="flex items-start justify-between gap-3 sm:gap-4">
            <div className="min-w-0">
              <BookingIdCopy bookingId={booking.id} />
              <div className="mt-2" data-testid="tracking-status">
                <Badge tone={statusTone(booking.status)} size="md">
                  {customerStatusLabel(booking.status)}
                </Badge>
              </div>
            </div>
            {/* Decorative; smaller below sm and dropped under 380px so "Booking ID: TAKI…" stays on one line. */}
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-mint-100 text-green-600 max-[379px]:hidden sm:size-24"
            >
              <Truck strokeWidth={1.75} className="size-6 sm:size-12" fill="currentColor" fillOpacity={0.9} />
            </span>
          </div>

          <h2 id="progress-heading" className="sr-only">
            Shipment progress
          </h2>
          <p role="status" aria-live="polite" className="sr-only">
            Current status: {customerStatusLabel(booking.status)}
          </p>
          <div className="mt-6">{progress}</div>

          <Button
            size="lg"
            fullWidth
            className="mt-8"
            onClick={() => setMapOpen(true)}
            leadingIcon={<MapPin aria-hidden="true" strokeWidth={1.75} />}
          >
            View Route
          </Button>

          {canSimulate ? (
            <div className="mt-5 rounded-md border border-dashed border-border-strong bg-surface-muted p-4">
              <Button
                variant="secondary"
                fullWidth
                onClick={simulate}
                loading={simulating}
                aria-describedby={helperId}
                leadingIcon={simulating ? undefined : <Wand2 aria-hidden="true" strokeWidth={1.75} />}
              >
                {simulating ? "Updating…" : "Demo: simulate next update"}
              </Button>
              <p id={helperId} className="mt-2 text-center text-caption text-ink-muted">
                Moves this demo shipment to its next status. Not real tracking.
              </p>
              <div role="alert" aria-live="assertive" className="empty:hidden">
                {simError ? (
                  <p className="mt-2 flex items-start justify-center gap-1.5 text-sm text-error">
                    <CircleAlert aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
                    {simError}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <CancelPaidBooking booking={booking} route={route} className="mt-5" />
        </Card>

        <Card as="section" aria-labelledby="shipment-info-heading" padding="md" className="lg:self-start">
          <h2 id="shipment-info-heading" className="type-h3 text-ink">
            Shipment info
          </h2>
          <dl className="mt-4 space-y-3 text-sm sm:text-base">
            <Info term="Route" value={routeLabel(pathIds)} testId="tracking-route" />
            <Info term="Weight" value={formatKg(booking.shipment.weightKg)} />
            <Info term="Pickup date" value={formatDate(booking.shipment.pickupDate)} />
            {route ? <Info term="Departure" value={formatTime(route.departureTime)} /> : null}
          </dl>
        </Card>

        <Card as="section" aria-labelledby="vehicle-heading" padding="md" className="lg:self-start">
          <h2 id="vehicle-heading" className="type-h3 text-ink">
            Vehicle details
          </h2>
          <div className="mt-4 flex items-start gap-4">
            {vehicle ? (
              <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-md bg-surface-muted sm:h-[72px] sm:w-24">
                <Image
                  src={vehicleImageSrc(vehicle.imageKey)}
                  alt={`${model?.label ?? "Vehicle"} (illustrative photo)`}
                  fill
                  sizes="96px"
                  className="object-cover"
                />
              </div>
            ) : null}
            <dl className="min-w-0 flex-1 space-y-2 text-sm">
              <Info term="Provider" value={provider} />
              {model ? <Info term="Model" value={model.label} /> : null}
              {vehicle ? <Info term="Registration" value={vehicle.registrationNumber} /> : null}
            </dl>
          </div>
        </Card>
      </div>

      <Modal open={mapOpen} onClose={() => setMapOpen(false)} title="Route" description={`${cityName(pathIds[0])} to ${cityName(pathIds[pathIds.length - 1])}`} size="lg">
        <RouteMap cityIds={pathIds} variant="modal" caption={MAP_CAPTION} />
        <p className="mt-3 text-caption text-ink-muted">{MAP_CAPTION}. The map shows the planned stops, not the vehicle&apos;s position.</p>
      </Modal>
    </>
  );
}

function Info({ term, value, testId }: { term: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-ink-muted">{term}</dt>
      <dd className="min-w-0 font-medium text-ink sm:text-right" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function Notice({ tone, title, children }: { tone: "warning" | "danger"; title: string; children: ReactNode }) {
  return (
    <div
      data-testid="tracking-notice"
      className={
        tone === "danger"
          ? "rounded-md border border-error/25 bg-danger-100 p-4 text-sm text-ink"
          : "rounded-md border border-warning-700/20 bg-warning-100 p-4 text-sm text-ink"
      }
    >
      <p className={tone === "danger" ? "flex items-start gap-2 font-semibold text-error" : "flex items-start gap-2 font-semibold text-warning-700"}>
        <CircleAlert aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
        {title}
      </p>
      <div className="mt-1.5 pl-6">{children}</div>
    </div>
  );
}

export function TrackingSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-6">
      <span className="sr-only">Loading shipment…</span>
      <div className="space-y-5 rounded-lg border border-border bg-surface p-5 shadow-card lg:row-span-2">
        <div className="flex justify-between gap-4">
          <Skeleton lines={2} className="w-1/2" />
          <Skeleton className="size-16 sm:size-24" rounded="full" />
        </div>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="size-8 shrink-0" rounded="full" />
            <Skeleton lines={2} className="flex-1" />
          </div>
        ))}
        <Skeleton className="h-13" />
      </div>
      <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
        <Skeleton lines={4} />
      </div>
      <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
        <Skeleton lines={3} />
      </div>
    </div>
  );
}
