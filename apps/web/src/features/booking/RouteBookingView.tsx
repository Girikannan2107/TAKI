"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Ban,
  CalendarDays,
  Check,
  Clock,
  Gauge,
  IdCard,
  Info,
  KeyRound,
  Layers,
  MapPin,
  PackageCheck,
  PackageSearch,
  Phone,
  Route as RouteIcon,
  ShieldCheck,
  TriangleAlert,
  Truck,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useShellSession } from "@/components/layout/useShellSession";
import { Avatar, Badge, Button, ButtonLink, CapacityBar, Card, EmptyState, Modal, Rating, Skeleton, useToast } from "@/components/ui";
import { customerApi, type TripDetailsParams } from "@/lib/api/client/customer";
import type { TripDetailsDTO } from "@/lib/api/contracts/customer";
import { errorMessage, isApiError, newIdempotencyKey } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { todayIst } from "@/lib/domain/dates";
import { GOODS_CATEGORIES, STATE_NAMES } from "@/lib/domain/model";
import { vehicleImageSrc } from "@/lib/domain/vehicles";
import { formatDateShort, formatDateTime, formatHoursMinutes, formatINR, formatInstantDate, formatInstantTime, formatKg, formatKm } from "@/lib/format";
import { parseSearchQuery, type SearchCriteria } from "@/lib/schemas/shipment-search.schema";
import { cn } from "@/lib/utils/cn";
import { BODY_TYPE_LABEL, GOODS_LABEL, HANDLING_LABEL } from "@/features/customer-shipment/labels";
import { LoadError } from "@/features/customer-shipment/LoadError";
import { isNotFound, useApi } from "@/features/customer-shipment/use-api";
import { newShipmentHref, vehiclesHref, type SearchSource } from "@/features/customer-shipment/urls";
import { BookingSummary } from "./BookingSummary";
import { GoogleRouteMap } from "@/components/maps/GoogleRouteMap";

const TITLE = "Transport Details";

/** Vehicle (trip) details, `/customer/booking/[tripId]?shipment=` or with guest search params (P3 §4.3). */
export function RouteBookingView() {
  const params = useParams<{ vehicleId: string }>();
  const query = useSearchParams();
  const tripId = params?.vehicleId ? decodeURIComponent(params.vehicleId) : "";
  const [today] = useState(() => todayIst(new Date()));
  const shipmentId = query.get("shipment");
  const criteria = shipmentId ? null : parseSearchQuery(query, today);
  const src: SearchSource | null = shipmentId ? { shipmentId } : criteria ? { criteria } : null;

  const backHref = src ? vehiclesHref(src) : paths.customer.dashboard;
  const header = (
    <PageHeader
      title={TITLE}
      subtitle="Review route, vehicle, transporter and booking terms before requesting this shipment."
      backHref={backHref}
      backLabel={src ? "Back to available vehicles" : "Back to dashboard"}
    />
  );

  const apiParams: TripDetailsParams | null = shipmentId
    ? { shipmentId }
    : criteria
      ? { from: criteria.from, to: criteria.to, weightKg: criteria.weightKg, goods: criteria.goods, handling: criteria.handling }
      : null;
  const trip = useApi(apiParams && tripId ? `customer:trip:${tripId}:${JSON.stringify(apiParams)}` : null, (signal) => customerApi.trip(tripId, apiParams!, signal));

  if (!src) {
    return (
      <>
        {header}
        <EmptyState
          icon={<PackageSearch strokeWidth={1.75} />}
          title="Price not shown yet"
          description="Enter your shipment details to see this vehicle's route and price for your goods."
          action={{ label: "Enter shipment details", href: paths.customer.newShipment() }}
        />
      </>
    );
  }
  if (trip.loading) {
    return (
      <>
        {header}
        <LoadingSkeleton />
      </>
    );
  }
  if (trip.error || !trip.data) {
    const gone = isNotFound(trip.error) || (isApiError(trip.error) && trip.error.code === "not_on_route");
    return (
      <>
        {header}
        {gone ? (
          <EmptyState
            icon={<Truck strokeWidth={1.75} />}
            title="Vehicle no longer available"
            description={isApiError(trip.error) && trip.error.code === "not_on_route" ? trip.error.message : "This trip isn't listed any more."}
            action={{ label: "Back to available vehicles", href: backHref }}
          />
        ) : (
          <LoadError error={trip.error} title="We couldn't load this vehicle" onRetry={() => void trip.reload()} />
        )}
      </>
    );
  }
  return <Details d={trip.data} src={src} criteria={criteria} backHref={backHref} header={header} />;
}

function Details({ d, src, criteria, backHref, header }: { d: TripDetailsDTO; src: SearchSource; criteria: SearchCriteria | null; backHref: string; header: ReactNode }) {
  const router = useRouter();
  const session = useShellSession();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; bookingId?: string } | null>(null);
  const idemKey = useRef<string | null>(null);
  const errorId = useId();

  const signedIn = session.signedIn && session.role === "customer";
  const shipmentId = "shipmentId" in src ? src.shipmentId : null;
  const blocked = !!d.problem;
  const existing = d.existingBookingId;
  const saveHref = newShipmentHref(criteria ?? {}, d.tripId);

  async function request() {
    if (!shipmentId || pending) return;
    setPending(true);
    setError(null);
    idemKey.current ??= newIdempotencyKey("bkg");
    try {
      const booking = await customerApi.requestBooking(shipmentId, d.tripId, idemKey.current);
      idemKey.current = null;
      toast({ title: "Request sent", description: `${d.agency.name} will review it. You pay only after they accept.`, tone: "success" });
      router.push(paths.customer.tracking(booking.id));
    } catch (e) {
      setPending(false);
      const bookingId = isApiError(e) && typeof e.details?.bookingId === "string" ? e.details.bookingId : undefined;
      // A definitive rejection: a retry should be a new request.
      if (isApiError(e) && e.status < 500) idemKey.current = null;
      setError({ message: errorMessage(e, "We couldn't send your request. Please try again."), bookingId });
    }
  }

  const cta: { label: string; href?: string; onClick?: () => void } = existing
    ? { label: "View your booking", href: paths.customer.tracking(existing) }
    : !signedIn
      ? { label: "Log in to request booking", href: paths.login({ role: "customer", next: saveHref }) }
      : !shipmentId
        ? { label: "Add shipment details", href: saveHref }
        : { label: "Request booking", onClick: () => setConfirmOpen(true) };

  const ctaButton = (className?: string) =>
    cta.href ? (
      <ButtonLink href={cta.href} size="lg" fullWidth trailingIcon={<ArrowRight aria-hidden="true" strokeWidth={2} />} className={className}>
        {cta.label}
      </ButtonLink>
    ) : (
      <Button
        size="lg"
        fullWidth
        disabled={blocked || pending}
        loading={pending}
        onClick={cta.onClick}
        aria-describedby={blocked ? "offer-problem" : error ? errorId : undefined}
        trailingIcon={<ArrowRight aria-hidden="true" strokeWidth={2} />}
        className={className}
      >
        {pending ? "Sending request…" : cta.label}
      </Button>
    );

  const mapStops = d.route.filter((s) => s.lat !== null && s.lng !== null).map((s) => ({ name: s.placeName, lat: s.lat!, lng: s.lng! }));
  const bookedKg = Math.max(0, d.offeredCapacityKg - d.availableCapacityKg);
  const restricted = GOODS_CATEGORIES.filter((g) => !d.goods.accepted.includes(g));
  const shipmentGoods = criteria?.goods;

  return (
    <div className="pb-28 lg:pb-0">
      {header}

      {blocked && d.problemMessage ? (
        <div
          role="alert"
          id="offer-problem"
          data-testid="offer-problem"
          className="mb-5 flex flex-col gap-3 rounded-lg border border-warning-700/25 bg-warning-100 p-4 text-warning-700 sm:flex-row sm:items-center sm:justify-between lg:mb-6"
        >
          <div className="flex items-start gap-3">
            <TriangleAlert aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-semibold">This vehicle can&apos;t take your shipment</p>
              <p className="mt-0.5 text-sm">{d.problemMessage}</p>
            </div>
          </div>
          <ButtonLink href={backHref} variant="outline" size="sm" className="self-start sm:self-auto">
            Choose another vehicle
          </ButtonLink>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-6">
        <div className="flex min-w-0 flex-col gap-5">
          {/* 1. Schedule + map */}
          <div className="grid gap-5 md:grid-cols-2">
            <Card as="section" aria-labelledby="schedule-heading" padding="md">
              <h2 id="schedule-heading" className="sr-only">
                Schedule
              </h2>
              <ol className="flex flex-col">
                <ScheduleStop time={d.pickup.expectedDepartureAt} place={d.pickup.placeName} sub={d.pickup.districtName} line />
                <ScheduleStop time={d.drop.expectedArrivalAt} place={d.drop.placeName} sub={d.drop.districtName} />
              </ol>
              <dl className="mt-4 grid grid-cols-2 divide-x divide-border border-t border-border pt-4" data-testid="route-stats">
                <Stat icon={<RouteIcon strokeWidth={1.75} />} term="Distance" value={formatKm(d.segmentKm)} />
                <Stat icon={<Clock strokeWidth={1.75} />} term="Duration" value={formatHoursMinutes((Date.parse(d.drop.expectedArrivalAt) - Date.parse(d.pickup.expectedDepartureAt)) / 60_000)} />
              </dl>
            </Card>
            {mapStops.length > 1 ? (
              <Card as="section" aria-label="Route map" padding="sm" className="overflow-hidden">
                <GoogleRouteMap stops={mapStops} polyline={d.routePolyline} />
              </Card>
            ) : null}
          </div>

          {/* 2. Transporter */}
          <Card as="section" aria-labelledby="agency-heading" padding="md">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
              <div className="flex min-w-0 items-center gap-4 xl:w-[40%]">
                <Avatar name={d.agency.name} size="lg" decorative />
                <div className="min-w-0">
                  <h2 id="agency-heading" className="type-h3 flex items-center gap-1.5 text-ink">
                    <span className="truncate">{d.agency.name}</span>
                    {d.agency.verified ? (
                      <>
                        <BadgeCheck aria-hidden="true" strokeWidth={2} className="size-5 shrink-0 fill-green-600 text-surface" />
                        <span className="sr-only">(verified agency)</span>
                      </>
                    ) : null}
                  </h2>
                  {d.agency.ratingCount > 0 ? (
                    <Rating value={d.agency.ratingAvg} count={d.agency.ratingCount} countLabel="reviews" className="mt-1" />
                  ) : (
                    <p className="mt-1 text-sm text-ink-muted">New on TAKI</p>
                  )}
                </div>
              </div>
              <dl className="grid flex-1 grid-cols-3 gap-3 sm:divide-x sm:divide-border">
                <IconStat icon={<Truck strokeWidth={1.75} />} term="Completed shipments" value={d.agencyInfo.delivered.toLocaleString("en-IN")} />
                <IconStat icon={<CalendarDays strokeWidth={1.75} />} term="On TAKI since" value={formatMonthYear(d.agencyInfo.memberSince)} />
                <IconStat icon={<MapPin strokeWidth={1.75} />} term="Base location" value={d.agencyInfo.districtName} />
              </dl>
            </div>
            <p className="mt-4 text-sm text-ink-muted">
              Serves {d.agencyInfo.statesCovered.map((s) => STATE_NAMES[s]).join(", ") || "its home state"}.
            </p>
          </Card>

          {/* 3. Vehicle */}
          <Card as="section" aria-labelledby="overview-heading" padding="md">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-center">
              <VehiclePhoto d={d} />
              <div className="min-w-0">
                <h2 id="overview-heading" className="type-h3 text-ink">
                  Vehicle Details
                </h2>
                <dl className="mt-3 flex flex-col gap-2.5 text-sm">
                  <Row icon={<Truck strokeWidth={1.75} />} term="Type" value={`${d.vehicle.vehicleClass} · ${d.vehicle.makeModel}`} />
                  <Row icon={<PackageSearch strokeWidth={1.75} />} term="Body" value={BODY_TYPE_LABEL[d.vehicle.bodyType]} />
                  <Row icon={<Layers strokeWidth={1.75} />} term="Capacity" value={formatKg(d.offeredCapacityKg)} />
                  <Row
                    icon={<Gauge strokeWidth={1.75} />}
                    term="Available space"
                    value={<span className="rounded-md bg-green-100 px-2.5 py-1 font-semibold tabular-nums text-green-800">{formatKg(d.availableCapacityKg)}</span>}
                  />
                  <Row icon={<IdCard strokeWidth={1.75} />} term="Registration" value="Shared after acceptance" />
                </dl>
                <CapacityBar totalKg={d.offeredCapacityKg} bookedKg={bookedKg} className="mt-4" />
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1.5 text-caption font-semibold text-green-800">
                  <Users aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
                  Shared capacity
                </p>
              </div>
            </div>
          </Card>

          {/* 4. Route checkpoints */}
          <Card as="section" aria-labelledby="route-heading" padding="md">
            <h2 id="route-heading" className="type-h3 mb-4 text-ink">
              Route
            </h2>
            <ol className="flex flex-col" aria-label="Checkpoints">
              {d.route.map((s, i) => (
                <li key={s.index} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < d.route.length - 1 ? <span aria-hidden="true" className={cn("absolute left-[7px] top-4 h-full w-0.5", s.inSegment && d.route[i + 1]?.inSegment ? "bg-green-600" : "bg-border")} /> : null}
                  <span aria-hidden="true" className={cn("relative z-10 mt-1 size-4 shrink-0 rounded-full border-2", s.role ? "border-green-700 bg-green-700" : s.inSegment ? "border-green-600 bg-surface" : "border-border-strong bg-surface")} />
                  <div className="min-w-0">
                    <p className={cn("text-sm", s.role ? "font-semibold text-ink" : s.inSegment ? "text-ink" : "text-ink-muted")}>
                      {s.placeName}, {s.districtName}
                      {s.role ? (
                        <Badge tone="success" className="ml-2">
                          {s.role === "pickup" ? "Your pickup" : "Your drop"}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-caption text-ink-subtle tabular-nums">
                      {s.expectedArrivalAt ? `Arrives ${formatDateTime(s.expectedArrivalAt)}` : null}
                      {s.expectedArrivalAt && s.expectedDepartureAt ? " · " : null}
                      {s.expectedDepartureAt ? `Departs ${formatDateTime(s.expectedDepartureAt)}` : null}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {/* 5. Driver and reviews */}
          <Card as="section" aria-labelledby="driver-heading" padding="md">
            <h2 id="driver-heading" className="type-h3 text-ink">
              Driver
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Avatar name="Driver" decorative />
              <div className="min-w-0">
                {d.driver.ratingCount > 0 ? <Rating value={d.driver.ratingAvg} count={d.driver.ratingCount} countLabel="reviews" /> : <p className="text-sm text-ink-muted">No ratings yet</p>}
                <p className="text-sm text-ink-muted">{d.driver.deliveries.toLocaleString("en-IN")} deliveries completed</p>
              </div>
              <p className="flex items-center gap-1.5 text-caption text-ink-subtle">
                <Phone aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
                Name and phone are shared after the agency accepts.
              </p>
            </div>
            <Reviews d={d} />
          </Card>

          {/* 6. Cargo compatibility */}
          <Card as="section" aria-labelledby="goods-heading" padding="md">
            <h2 id="goods-heading" className="type-h3 flex items-center gap-2 text-ink">
              <PackageCheck aria-hidden="true" strokeWidth={1.75} className="size-5 text-green-700" />
              Cargo Compatibility
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Accepted goods">
              {d.goods.accepted.map((g) => (
                <li key={g}>
                  <Badge tone="success" size="md" icon={<Check strokeWidth={2} />}>
                    {GOODS_LABEL[g]}
                    {g === shipmentGoods ? " (yours)" : ""}
                  </Badge>
                </li>
              ))}
            </ul>
            {restricted.length ? (
              <>
                <h3 className="mt-4 text-sm font-semibold text-ink">Not accepted</h3>
                <ul className="mt-2 flex flex-wrap gap-2" aria-label="Restricted goods">
                  {restricted.map((g) => (
                    <li key={g}>
                      <Badge tone="neutral" size="md" icon={<Ban strokeWidth={2} />}>
                        {GOODS_LABEL[g]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <ul className="mt-4 flex flex-col gap-1 text-sm text-ink-muted">
              <li>Special handling: {d.goods.handlingSupported.length ? d.goods.handlingSupported.map((h) => HANDLING_LABEL[h]).join(", ") : "none offered"}</li>
              {d.goods.maxPackageKg ? <li>Max. per package: {formatKg(d.goods.maxPackageKg)}</li> : null}
              {d.goods.notes ? <li>Agency notes: {d.goods.notes}</li> : null}
            </ul>
          </Card>
        </div>

        {/* Right column: booking summary + CTA */}
        <div>
          <Card as="section" aria-labelledby="summary-heading" padding="md" className="lg:sticky lg:top-[calc(var(--header-height)+1.5rem)]">
            <h2 id="summary-heading" className="type-h3 text-ink">
              Booking Summary
            </h2>
            <dl className="mt-4 flex flex-col gap-3 border-b border-border pb-4 text-sm">
              <Row icon={<CalendarDays strokeWidth={1.75} />} term="Selected date" value={formatInstantDate(d.pickup.expectedDepartureAt)} />
              <Row icon={<PackageSearch strokeWidth={1.75} />} term="Load requested" value={`${formatKg(d.pricing.weightKg)}${criteria ? ` · ${GOODS_LABEL[criteria.goods]}` : ""}`} />
              <Row icon={<RouteIcon strokeWidth={1.75} />} term="Route" value={`${d.pickup.placeName} → ${d.drop.placeName}`} />
            </dl>
            <BookingSummary
              pricing={d.pricing}
              title="Pricing"
              className="mt-4 rounded-none border-0 bg-transparent p-0 shadow-none sm:p-0"
            />
            <p className="mt-4 flex items-start gap-2 rounded-md border border-coral-300/60 bg-coral-100 px-3.5 py-3 text-sm text-coral-700">
              <Info aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
              Payment is requested only after partner acceptance.
            </p>
            <div className="mt-5 hidden lg:block">{ctaButton("h-14 text-lg")}</div>
            {!signedIn && !existing ? <p className="mt-2 hidden text-center text-caption text-ink-muted lg:block">This vehicle is kept while you log in.</p> : null}
            <ErrorLine error={error} id={errorId} />
            <ul className="mt-5 flex flex-col gap-2.5 border-t border-border pt-4 text-sm text-ink-muted">
              <TrustItem icon={<ShieldCheck strokeWidth={1.75} />}>Secure booking on TAKI Travel</TrustItem>
              <TrustItem icon={<BadgeCheck strokeWidth={1.75} />}>Confirmed only after the agency accepts</TrustItem>
              <TrustItem icon={<KeyRound strokeWidth={1.75} />}>Pickup and delivery verified with OTP</TrustItem>
            </ul>
          </Card>
        </div>
      </div>

      {/* Sticky bottom CTA < lg */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-4 border-t border-border bg-surface px-4 py-3 shadow-raised lg:hidden">
        <div className="shrink-0">
          <p className="text-caption text-ink-subtle">Total</p>
          <p className="type-amount-md text-price">{formatINR(d.pricing.totalPayable)}</p>
        </div>
        <div className="min-w-0 flex-1">{ctaButton()}</div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => (pending ? undefined : setConfirmOpen(false))}
        title="Request this vehicle?"
        description="The agency reviews your request. You pay only after they accept."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={async () => {
                await request();
                setConfirmOpen(false);
              }}
            >
              {pending ? "Sending…" : "Send request"}
            </Button>
          </>
        }
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Detail term="Agency" value={d.agency.name} />
          <Detail term="Vehicle" value={d.vehicle.vehicleClass} />
          <Detail term="Pickup" value={`${d.pickup.placeName} · ${formatDateTime(d.pickup.expectedDepartureAt)}`} />
          <Detail term="Drop" value={`${d.drop.placeName} · ${formatDateTime(d.drop.expectedArrivalAt)}`} />
          <Detail term="Total payable" value={formatINR(d.pricing.totalPayable)} />
        </dl>
      </Modal>
    </div>
  );
}

function ErrorLine({ error, id }: { error: { message: string; bookingId?: string } | null; id: string }) {
  return (
    <div role="alert" aria-live="assertive">
      {error ? (
        <p id={id} className="mt-3 flex items-start gap-1.5 text-sm text-error">
          <TriangleAlert aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
          <span>
            {error.message}
            {error.bookingId ? (
              <>
                {" "}
                <Link href={paths.customer.tracking(error.bookingId)} className="font-semibold underline">
                  View booking {error.bookingId}
                </Link>
              </>
            ) : null}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function Reviews({ d }: { d: TripDetailsDTO }) {
  const [all, setAll] = useState(false);
  const latest = d.reviews.slice(0, 3);
  return (
    <div className="mt-5 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-ink">Driver reviews</h3>
      {latest.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No reviews yet</p>
      ) : (
        <>
          <ReviewList reviews={latest} />
          {d.reviews.length > latest.length ? (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll(true)}>
              Show all reviews
            </Button>
          ) : null}
          <Modal open={all} onClose={() => setAll(false)} title="Driver reviews" size="md">
            <ReviewList reviews={d.reviews} />
          </Modal>
        </>
      )}
    </div>
  );
}

function ReviewList({ reviews }: { reviews: TripDetailsDTO["reviews"] }) {
  return (
    <ul className="mt-2 flex flex-col divide-y divide-border">
      {reviews.map((r) => (
        <li key={r.id} className="py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Rating value={r.rating} />
            <span className="text-caption text-ink-subtle">
              {r.customerFirstName.charAt(0)}. · {formatInstantDate(r.createdAt)}
            </span>
          </div>
          {r.comment ? <p className="mt-1 text-sm text-ink">{r.comment}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function VehiclePhoto({ d }: { d: TripDetailsDTO }) {
  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-md bg-surface-muted">
      {d.vehicle.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.vehicle.photoUrl} alt={`${d.vehicle.makeModel} photo`} className="size-full object-cover" />
      ) : (
        <Image src={vehicleImageSrc(d.vehicle.imageKey)} alt={`${d.vehicle.vehicleClass} (illustrative photo)`} fill sizes="(min-width: 1024px) 420px, 100vw" className="object-cover" />
      )}
    </div>
  );
}

function Stat({ icon, term, value }: { icon: ReactNode; term: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-1 px-2 text-center">
      <dt className="flex items-center gap-1 text-caption text-ink-muted [&_svg]:size-4">
        <span aria-hidden="true">{icon}</span>
        {term}
      </dt>
      <dd className="text-sm font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function ScheduleStop({ time, place, sub, line }: { time: string; place: string; sub: string; line?: boolean }) {
  return (
    <li className="relative grid grid-cols-[6.75rem_1.25rem_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0">
      <div>
        <p className="whitespace-nowrap font-heading text-lg font-bold tabular-nums text-ink">{formatInstantTime(time)}</p>
        <p className="text-caption text-ink-muted">{formatDateShort(formatIsoDateIst(time))}</p>
      </div>
      <div className="relative flex justify-center">
        <span aria-hidden="true" className="relative z-10 mt-1.5 size-4 rounded-full border-[3px] border-green-700 bg-surface" />
        {line ? <span aria-hidden="true" className="absolute top-6 h-full w-0.5 bg-green-700" /> : null}
      </div>
      <div className="min-w-0">
        <p className="font-heading text-lg font-semibold text-ink">{place}</p>
        <p className="flex items-center gap-1.5 text-sm text-ink-muted">
          <MapPin aria-hidden="true" strokeWidth={1.75} className="size-4 text-green-700" />
          {sub}
        </p>
      </div>
    </li>
  );
}

/** "2026-11-16T00:30:00Z" → "2026-11-16" (IST calendar date). */
function formatIsoDateIst(instant: string): string {
  return new Date(Date.parse(instant) + 330 * 60_000).toISOString().slice(0, 10);
}

function formatMonthYear(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}

function IconStat({ icon, term, value }: { icon: ReactNode; term: string; value: string }) {
  return (
    <div className="group relative min-w-0 sm:px-3 sm:pl-10 sm:first:pl-7">
      <dt className="text-caption text-ink-muted">
        <span aria-hidden="true" className="absolute left-3 top-0.5 hidden text-green-700 group-first:left-0 sm:flex [&_svg]:size-5">
          {icon}
        </span>
        {term}
      </dt>
      <dd className="mt-0.5 font-heading text-base font-semibold text-ink">{value}</dd>
    </div>
  );
}

function Row({ icon, term, value }: { icon: ReactNode; term: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="flex text-ink-subtle [&_svg]:size-[18px]">
        {icon}
      </span>
      <dt className="w-32 shrink-0 text-ink-muted">{term}</dt>
      <dd className="min-w-0 flex-1 text-right font-medium text-ink lg:text-left">{value}</dd>
    </div>
  );
}

function TrustItem({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span aria-hidden="true" className="flex text-green-700 [&_svg]:size-5">
        {icon}
      </span>
      {children}
    </li>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-ink-subtle">{term}</dt>
      <dd className="mt-0.5 font-medium text-ink">{value}</dd>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-6">
      <span className="sr-only">Loading vehicle details…</span>
      <div className="flex flex-col gap-5">
        <Skeleton className="h-36 rounded-lg" />
        <Skeleton className="h-80 rounded-lg" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
      <Skeleton className="h-72 rounded-lg" />
    </div>
  );
}
