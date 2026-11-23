import Image from "next/image";
import { ArrowRight, BadgeCheck, Layers, Truck, Users } from "lucide-react";
import { Avatar, Badge, ButtonLink, Card, Rating } from "@/components/ui";
import type { TripOfferDTO } from "@/lib/api/contracts/customer";
import { vehicleImageSrc } from "@/lib/domain/vehicles";
import { formatHoursMinutes, formatINR, formatInstantTime, formatKg } from "@/lib/format";
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
 * Find Vehicles result card (UI reference): photo · departure → arrival time line with duration and the
 * customer's pickup/drop · agency (verified, rating) · vehicle, capacity and space left · price + CTA.
 */
export function VehicleCard({ offer, href, headingLevel = 2, eager, className }: VehicleCardProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const vehicleLabel = `${offer.vehicle.vehicleClass} · ${offer.vehicle.makeModel}`;
  const mins = (Date.parse(offer.drop.expectedArrivalAt) - Date.parse(offer.pickup.expectedDepartureAt)) / 60_000;
  const via = offer.route.filter((s) => s.inSegment && !s.role).map((s) => s.placeName);

  return (
    <Card as="article" padding="none" data-testid="vehicle-card" className={cn("p-3 transition-shadow duration-200 hover:shadow-raised sm:p-4", className)}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[176px_minmax(0,1fr)] xl:grid-cols-[150px_minmax(0,1fr)_13rem_10.5rem]">
        {/* Photo */}
        <div className="relative h-36 overflow-hidden rounded-md bg-surface-muted md:h-[118px] md:w-[176px] xl:w-[150px]">
          {offer.vehicle.photoUrl ? (
            // Agency-uploaded photo served by /api/files (never through the next/image optimiser).
            // eslint-disable-next-line @next/next/no-img-element
            <img src={offer.vehicle.photoUrl} alt={`${vehicleLabel} photo`} loading={eager ? "eager" : "lazy"} className="size-full object-cover" />
          ) : (
            <Image
              src={vehicleImageSrc(offer.vehicle.imageKey)}
              alt={`Example ${offer.vehicle.vehicleClass} photo (illustrative)`}
              fill
              sizes="(min-width: 768px) 176px, 100vw"
              loading={eager ? "eager" : "lazy"}
              className="object-cover"
            />
          )}
        </div>

        {/* Times + agency */}
        <div className="min-w-0">
          <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] items-center gap-x-3" aria-label="Schedule">
            <p className="whitespace-nowrap font-heading text-base font-bold tabular-nums text-ink sm:text-lg">{formatInstantTime(offer.pickup.expectedDepartureAt)}</p>
            <div className="relative flex items-center" aria-hidden="true">
              <span className="size-2.5 shrink-0 rounded-full border-2 border-green-700 bg-surface" />
              <span className="h-0.5 flex-1 bg-green-700" />
              <span className="size-2.5 shrink-0 rounded-full border-2 border-green-700 bg-surface" />
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-caption font-medium text-ink-muted">{formatHoursMinutes(mins)}</span>
            </div>
            <p className="whitespace-nowrap font-heading text-base font-bold tabular-nums text-ink sm:text-lg">{formatInstantTime(offer.drop.expectedArrivalAt)}</p>
            <p className="truncate text-sm text-ink-muted">{offer.pickup.placeName}</p>
            <p className="hidden truncate text-center text-caption text-ink-subtle 2xl:block">{via.length ? `via ${via.join(", ")}` : ""}</p>
            <span className="2xl:hidden" aria-hidden="true" />
            <p className="truncate text-right text-sm text-ink-muted">{offer.drop.placeName}</p>
          </div>
          <p className="sr-only">
            Departs {offer.pickup.placeName} at {formatInstantTime(offer.pickup.expectedDepartureAt)}, arrives {offer.drop.placeName} at{" "}
            {formatInstantTime(offer.drop.expectedArrivalAt)}, {formatHoursMinutes(mins)}.
          </p>

          <div className="mt-3 flex min-w-0 items-center gap-3">
            <Avatar name={offer.agency.name} size="md" decorative />
            <div className="min-w-0">
              <Heading className="flex min-w-0 items-center gap-1.5 font-heading text-base font-semibold leading-6 text-ink">
                <span className="truncate">{offer.agency.name}</span>
                {offer.agency.verified ? (
                  <>
                    <BadgeCheck aria-hidden="true" strokeWidth={2} className="size-5 shrink-0 fill-green-600 text-surface" />
                    <span className="sr-only">Verified agency</span>
                  </>
                ) : null}
              </Heading>
              <div className="text-sm text-ink-muted">
                {offer.agency.ratingCount > 0 ? <Rating value={offer.agency.ratingAvg} count={offer.agency.ratingCount} countLabel="reviews" /> : <span>New agency</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Vehicle + tags */}
        <div className="flex min-w-0 flex-col gap-2 text-sm text-ink-muted md:col-start-2 xl:col-start-3">
          <p className="flex items-start gap-2">
            <Truck aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
            <span className="min-w-0">
              {vehicleLabel}
              <span className="text-ink-subtle"> · {BODY_TYPE_LABEL[offer.vehicle.bodyType]}</span>
            </span>
          </p>
          <p className="flex items-center gap-2">
            <Layers aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-ink-subtle" />
            Capacity: <span className="tabular-nums">{formatKg(offer.offeredCapacityKg)}</span>
          </p>
          <p className="w-fit rounded-md bg-green-100 px-2.5 py-1 font-semibold tabular-nums text-green-800">Available: {formatKg(offer.availableCapacityKg)}</p>
          <div className="flex flex-wrap gap-2">
            {offer.badge ? (
              <Badge tone={BADGE_TONE[offer.badge]} size="md">
                {BADGE_LABEL[offer.badge]}
              </Badge>
            ) : null}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-caption font-semibold text-green-800">
              <Users aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
              Shared capacity
            </span>
          </div>
        </div>

        {/* Price + CTA */}
        <div className="flex flex-col justify-center gap-3 border-t border-border pt-4 md:col-span-2 md:flex-row md:items-center md:justify-between xl:col-span-1 xl:flex-col xl:items-stretch xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
          <div>
            <p className="type-amount-md font-bold text-price">{formatINR(offer.pricing.totalPayable)}</p>
            <p className="text-sm text-ink-muted">
              for your {formatKg(offer.pricing.weightKg)} · {offer.segmentKm.toLocaleString("en-IN")} km
            </p>
            <p className="text-caption text-ink-subtle">incl. TAKI fee</p>
          </div>
          <ButtonLink href={href} size="md" trailingIcon={<ArrowRight strokeWidth={2} />} className="w-full md:w-auto xl:w-full">
            View details<span className="sr-only"> for {offer.agency.name}</span>
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}
