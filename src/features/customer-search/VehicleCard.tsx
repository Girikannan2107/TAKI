import Image from "next/image";
import { ArrowRight, BadgeCheck, Clock } from "lucide-react";
import { Badge, ButtonLink, Card, Rating, type BadgeTone } from "@/components/ui";
import { badgeLabel } from "@/lib/domain/labels";
import type { OfferBadge, VehicleOffer } from "@/lib/domain/types";
import { vehicleImageSrc } from "@/lib/domain/vehicles";
import { formatINR, formatKg, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

const BADGE_TONE: Record<OfferBadge, BadgeTone> = {
  best_price: "success",
  top_rated: "success",
  more_capacity: "lavender",
};

export interface VehicleCardProps {
  offer: VehicleOffer;
  /** "View & Select" link → /customer/booking/<offer.routeId>. */
  href: string;
  headingLevel?: 2 | 3;
  /** Load the photo eagerly (first card, above the fold). */
  eager?: boolean;
  className?: string;
}

/** Available-vehicle result card (board 07): photo, operator, rating, vehicle, capacity, price, badge, CTA. */
export function VehicleCard({ offer, href, headingLevel = 2, eager, className }: VehicleCardProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <Card
      as="article"
      padding="none"
      data-testid="vehicle-card"
      className={cn("p-4 transition-shadow duration-200 hover:shadow-raised sm:p-5", className)}
    >
      <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-x-5">
        <div className="relative h-[72px] w-[88px] overflow-hidden rounded-md bg-surface-muted sm:row-span-2 sm:h-[120px] sm:w-[160px]">
          <Image
            src={vehicleImageSrc(offer.imageKey)}
            alt={`Example ${offer.vehicleLabel} truck photo (illustrative)`}
            fill
            sizes="(min-width: 640px) 160px, 88px"
            loading={eager ? "eager" : "lazy"}
            className="object-cover"
          />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
            <Heading className="flex min-w-0 items-center gap-1.5 font-heading text-base font-semibold leading-6 text-ink sm:text-lg">
              <span className="truncate">{offer.businessName}</span>
              <BadgeCheck aria-hidden="true" strokeWidth={2} className="size-5 shrink-0 fill-green-600 text-surface" />
              <span className="sr-only">Verified (demo)</span>
            </Heading>
            {offer.badge ? (
              <Badge tone={BADGE_TONE[offer.badge]} size="md" className="sm:-mt-0.5">
                {badgeLabel(offer.badge)}
              </Badge>
            ) : null}
          </div>
          <Rating value={offer.ratingAvg} count={offer.ratingCount} className="mt-1" />
          <p className="mt-1.5 text-sm text-ink-muted">
            {offer.vehicleLabel}
            <span aria-hidden="true" className="mx-2 text-border-strong">
              |
            </span>
            <span className="sr-only">, </span>
            <span className="tabular-nums">{formatKg(offer.availableCapacityKg)} available</span>
          </p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-ink-muted">
            <Clock aria-hidden="true" strokeWidth={1.75} className="size-4 text-green-600" />
            Departs <span className="font-medium tabular-nums text-ink">{formatTime(offer.departureTime)}</span>
          </p>
        </div>

        <div className="col-span-2 flex flex-col gap-3 border-t border-border pt-4 sm:col-span-1 sm:col-start-2 sm:flex-row sm:items-end sm:justify-between sm:border-0 sm:pt-0">
          <div>
            <p className="type-amount-md font-bold text-price">{formatINR(offer.pricing.totalPayable)}</p>
            <p className="text-caption text-ink-subtle">incl. TAKI fee</p>
          </div>
          <ButtonLink href={href} size="sm" trailingIcon={<ArrowRight strokeWidth={2} />} className="w-full sm:w-auto">
            View &amp; Select<span className="sr-only"> {offer.businessName}</span>
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}
