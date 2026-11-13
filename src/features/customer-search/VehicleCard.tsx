import Image from "next/image";
import { ArrowRight, BadgeCheck, CalendarClock, Star } from "lucide-react";
import { Badge, ButtonLink, Card, Rating } from "@/components/ui";
import type { TripOfferDTO } from "@/lib/api/contracts/customer";
import { vehicleImageSrc } from "@/lib/domain/vehicles";
import { formatDateTime, formatINR, formatKg } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { BADGE_LABEL, BADGE_TONE, BODY_TYPE_LABEL } from "@/features/customer-shipment/labels";

export interface VehicleCardProps {
  offer: TripOfferDTO;
  /** "View details" link → vehicle details for this trip. */
  href: string;
  headingLevel?: 2 | 3;
  /** Load the photo eagerly (first card, above the fold). */
  eager?: boolean;
  className?: string;
}

/**
 * Find Vehicles result card: photo, agency (verified), driver rating, vehicle, route with
 * checkpoints (pickup/drop bold), departure → arrival, capacity left, price, badge, CTA.
 */
export function VehicleCard({ offer, href, headingLevel = 2, eager, className }: VehicleCardProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const vehicleLabel = `${offer.vehicle.vehicleClass} · ${offer.vehicle.makeModel}`;
  return (
    <Card as="article" padding="none" data-testid="vehicle-card" className={cn("p-4 transition-shadow duration-200 hover:shadow-raised sm:p-5", className)}>
      <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-x-5">
        <div className="relative h-[72px] w-[88px] overflow-hidden rounded-md bg-surface-muted sm:row-span-2 sm:h-[120px] sm:w-[160px]">
          {offer.vehicle.photoUrl ? (
            // Agency-uploaded photo served by /api/files (never through the next/image optimiser).
            // eslint-disable-next-line @next/next/no-img-element
            <img src={offer.vehicle.photoUrl} alt={`${vehicleLabel} photo`} loading={eager ? "eager" : "lazy"} className="size-full object-cover" />
          ) : (
            <Image
              src={vehicleImageSrc(offer.vehicle.imageKey)}
              alt={`Example ${offer.vehicle.vehicleClass} photo (illustrative)`}
              fill
              sizes="(min-width: 640px) 160px, 88px"
              loading={eager ? "eager" : "lazy"}
              className="object-cover"
            />
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
            <Heading className="flex min-w-0 items-center gap-1.5 font-heading text-base font-semibold leading-6 text-ink sm:text-lg">
              <span className="truncate">{offer.agency.name}</span>
              {offer.agency.verified ? (
                <>
                  <BadgeCheck aria-hidden="true" strokeWidth={2} className="size-5 shrink-0 fill-green-600 text-surface" />
                  <span className="sr-only">Verified agency</span>
                </>
              ) : null}
            </Heading>
            {offer.badge ? (
              <Badge tone={BADGE_TONE[offer.badge]} size="md" className="sm:-mt-0.5">
                {BADGE_LABEL[offer.badge]}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
            {offer.agency.ratingCount > 0 ? <Rating value={offer.agency.ratingAvg} count={offer.agency.ratingCount} countLabel="reviews" /> : <span>New agency</span>}
            <span className="inline-flex items-center gap-1">
              <Star aria-hidden="true" strokeWidth={1.75} className="size-3.5 text-ink-subtle" />
              Driver {offer.driver.ratingCount > 0 ? `${offer.driver.ratingAvg.toFixed(1)} (${offer.driver.ratingCount})` : "new"}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-ink-muted">
            {vehicleLabel}
            <span aria-hidden="true" className="mx-2 text-border-strong">
              |
            </span>
            <span className="sr-only">, </span>
            {BODY_TYPE_LABEL[offer.vehicle.bodyType]}
            <span aria-hidden="true" className="mx-2 text-border-strong">
              |
            </span>
            <span className="sr-only">, </span>
            <span className="tabular-nums">{formatKg(offer.availableCapacityKg)} available</span>
          </p>
          <RouteLine offer={offer} />
          <p className="mt-1 inline-flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
            <CalendarClock aria-hidden="true" strokeWidth={1.75} className="size-4 text-green-600" />
            <span>
              Departs <span className="font-medium tabular-nums text-ink">{formatDateTime(offer.pickup.expectedDepartureAt)}</span>
            </span>
            <span aria-hidden="true">→</span>
            <span>
              arrives <span className="font-medium tabular-nums text-ink">{formatDateTime(offer.drop.expectedArrivalAt)}</span>
            </span>
          </p>
        </div>

        <div className="col-span-2 flex flex-col gap-3 border-t border-border pt-4 sm:col-span-1 sm:col-start-2 sm:flex-row sm:items-end sm:justify-between sm:border-0 sm:pt-0">
          <div>
            <p className="type-amount-md font-bold text-price">{formatINR(offer.pricing.totalPayable)}</p>
            <p className="text-caption text-ink-subtle">
              {offer.segmentKm.toLocaleString("en-IN")} km · incl. TAKI fee
            </p>
          </div>
          <ButtonLink href={href} size="sm" trailingIcon={<ArrowRight strokeWidth={2} />} className="w-full sm:w-auto">
            View details<span className="sr-only"> for {offer.agency.name}</span>
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}

/** "Coimbatore · Tiruppur · Salem · Chennai" with the customer's pickup and drop in bold. */
function RouteLine({ offer }: { offer: TripOfferDTO }) {
  return (
    <p className="mt-1 text-sm leading-6 text-ink-subtle">
      <span className="sr-only">Route: </span>
      {offer.route.map((s, i) => (
        <span key={s.index}>
          {i > 0 ? <span aria-hidden="true"> · </span> : null}
          <span className={cn(s.role ? "font-semibold text-ink" : s.inSegment ? "text-ink-muted" : undefined)}>
            {s.placeName}
            {s.role ? <span className="sr-only"> ({s.role})</span> : null}
          </span>
          {i < offer.route.length - 1 ? <span className="sr-only">,</span> : null}
        </span>
      ))}
    </p>
  );
}
