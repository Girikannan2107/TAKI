"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { CircleAlert, CircleCheck, CreditCard, KeyRound, MapPin, MapPinned, PackageSearch, Phone, ReceiptText, RefreshCw, Truck, UserRound, Wallet } from "lucide-react";
import { Avatar, Badge, Button, ButtonLink, Card, EmptyState, Modal, Rating, RatingInput, Skeleton, Textarea, useToast } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { customerApi } from "@/lib/api/client/customer";
import type { CustomerBookingDTO, TrackingDTO } from "@/lib/api/contracts/customer";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { V2 } from "@/lib/domain/constants";
import { vehicleImageSrc } from "@/lib/domain/vehicles";
import { formatDateTime, formatINR, formatInstantDate, formatKg, formatPhone } from "@/lib/format";
import { BookingSummary } from "@/features/booking/BookingSummary";
import { RouteMap } from "@/features/booking/RouteMap";
import { CANCEL_REASON_TEXT, GOODS_LABEL, HANDLING_LABEL, PACKAGE_TYPE_LABEL, REJECT_REASON_TEXT, bookingStatusLabel, bookingStatusTone } from "@/features/customer-shipment/labels";
import { LoadError } from "@/features/customer-shipment/LoadError";
import { isNotFound, useApi, usePolling } from "@/features/customer-shipment/use-api";
import { BookingIdCopy } from "./BookingIdCopy";
import { CancelPaidBooking } from "./CancelPaidBooking";
import { StatusTimeline } from "./StatusTimeline";

const MAP_CAPTION = "Illustrative route — not live location";
const POLL_MS = 30_000;
const TERMINAL = new Set(["delivered", "rejected", "cancelled"]);

const PAYMENT_STATUS_TEXT: Record<NonNullable<CustomerBookingDTO["payment"]>["status"], string> = {
  created: "Started",
  pending: "Pending",
  succeeded: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  refund_pending: "Refund in progress",
  refunded: "Refunded",
  refund_failed: "Refund delayed",
};

/** `/customer/tracking/[bookingId]` — canonical shipment details + tracking + feedback (P3 §4.3). */
export function TrackingView() {
  const params = useParams<{ bookingId: string }>();
  const bookingId = params?.bookingId ? decodeURIComponent(params.bookingId) : "";
  const booking = useApi(bookingId ? `customer:booking:${bookingId}` : null, (signal) => customerApi.booking(bookingId, signal));
  const tracking = useApi(bookingId ? `customer:tracking:${bookingId}` : null, (signal) => customerApi.tracking(bookingId, signal));
  const live = !!booking.data && !TERMINAL.has(booking.data.status);
  usePolling(
    async () => {
      await Promise.all([booking.reload(), tracking.reload()]);
    },
    POLL_MS,
    live,
  );

  const header = (
    <PageHeader
      title={booking.data ? `Shipment ${booking.data.id}` : "Shipment details"}
      subtitle="Track approval, pickup, transit and delivery milestones."
      backHref={paths.customer.shipments}
      backLabel="Back to my shipments"
    />
  );

  if (booking.loading) {
    return (
      <>
        {header}
        <TrackingSkeleton />
      </>
    );
  }
  if (isNotFound(booking.error) || !bookingId) {
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
  if (booking.error || !booking.data) {
    return (
      <>
        {header}
        <LoadError error={booking.error} title="We couldn't load this shipment" onRetry={() => void booking.reload()} />
      </>
    );
  }
  return (
    <>
      {header}
      <Details
        b={booking.data}
        tracking={tracking}
        onChange={(next) => {
          booking.setData(next);
          void tracking.reload();
        }}
      />
    </>
  );
}

function Details({
  b,
  tracking,
  onChange,
}: {
  b: CustomerBookingDTO;
  tracking: { data: TrackingDTO | undefined; error: unknown; loading: boolean; reload: () => Promise<void> };
  onChange(b: CustomerBookingDTO): void;
}) {
  const [mapOpen, setMapOpen] = useState(false);
  const agency = b.trip.agency.name;
  const mapStops = b.trip.route.filter((s) => s.inSegment && s.lat !== null && s.lng !== null).map((s) => ({ name: s.placeName, lat: s.lat!, lng: s.lng! }));

  let notice: ReactNode = null;
  if (b.status === "awaiting_agency") {
    notice = (
      <Notice tone="warning" title="Waiting for the agency to accept">
        <p>
          {agency} has until {formatDateTime(b.respondBy)} to respond. You pay only after they accept: no money has been taken.
        </p>
      </Notice>
    );
  } else if (b.status === "pending_payment" || b.status === "payment_failed") {
    notice = (
      <Notice tone="warning" title={b.status === "payment_failed" ? "Payment failed: try again" : "Accepted: payment due"}>
        <p>
          {agency} accepted your request. Total <span className="font-semibold tabular-nums">{formatINR(b.pricing.totalPayable)}</span>
          {b.paymentDueAt ? <>. Pay by {formatDateTime(b.paymentDueAt)} to keep your space.</> : "."}
        </p>
        {b.canPay ? (
          <ButtonLink href={paths.customer.payment(b.id)} size="sm" className="mt-3" leadingIcon={<CreditCard strokeWidth={1.75} />}>
            Pay now
          </ButtonLink>
        ) : null}
      </Notice>
    );
  } else if (b.status === "rejected" && b.rejection) {
    notice = (
      <Notice tone="danger" title="Request declined">
        <p>
          {REJECT_REASON_TEXT[b.rejection.reason] ?? "The agency couldn't take this shipment."}
          {b.rejection.note ? ` Note: ${b.rejection.note}` : ""} No money was taken.
        </p>
        <ButtonLink href={`${paths.customer.vehicles({ shipment: b.shipment.id })}`} size="sm" className="mt-3">
          Find another vehicle
        </ButtonLink>
      </Notice>
    );
  } else if (b.status === "cancelled" && b.cancellation) {
    const refund = b.payment?.refund;
    notice = (
      <Notice tone="danger" title="Booking cancelled">
        <p>
          {CANCEL_REASON_TEXT[b.cancellation.reason] ?? "This booking was cancelled."}
          {b.cancellation.note ? ` Note: ${b.cancellation.note}` : ""}{" "}
          {refund
            ? refund.status === "succeeded"
              ? `${formatINR(refund.amountRupees)} has been refunded.`
              : refund.status === "failed"
                ? "Your refund is delayed. Our team will follow up."
                : `A refund of ${formatINR(refund.amountRupees)} is in progress.`
            : "No money was taken."}
        </p>
      </Notice>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-6">
      <div className="flex min-w-0 flex-col gap-5">
        <Card as="section" aria-labelledby="progress-heading" padding="md">
          <div className="flex items-start justify-between gap-3 sm:gap-4">
            <div className="min-w-0">
              <BookingIdCopy bookingId={b.id} />
              <div className="mt-2" data-testid="tracking-status">
                <Badge tone={bookingStatusTone(b.status)} size="md">
                  {bookingStatusLabel(b.status)}
                </Badge>
              </div>
            </div>
            <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-mint-100 text-green-600 max-[379px]:hidden sm:size-16">
              <Truck strokeWidth={1.75} className="size-6 sm:size-8" />
            </span>
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            Current status: {bookingStatusLabel(b.status)}
          </p>
          {notice ? <div className="mt-5">{notice}</div> : null}

          <h2 id="progress-heading" className="type-h3 mt-6 text-ink">
            Shipment Tracking
          </h2>
          <div className="mt-4">
            {tracking.data ? (
              <StatusTimeline stages={tracking.data.stages} />
            ) : tracking.loading ? (
              <Skeleton lines={5} />
            ) : (
              <LoadError error={tracking.error} title="We couldn't load tracking" onRetry={() => void tracking.reload()} />
            )}
          </div>
          {tracking.data?.proofUrls.length ? (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-ink">Proof of delivery</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {tracking.data.proofUrls.map((u, i) => (
                  <li key={u}>
                    <a href={u} target="_blank" rel="noreferrer" className="block size-20 overflow-hidden rounded-md border border-border">
                      {/* Private file: plain <img> with the access-checked URL, never next/image. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`Delivery photo ${i + 1}`} className="size-full object-cover" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {b.otps ? <VerificationCodes b={b} onChange={onChange} /> : null}

          <div className="mt-6 flex flex-col gap-3">
            {b.status === "delivered" ? (
              <ButtonLink href={paths.customer.receipt(b.id)} variant="outline" size="lg" fullWidth leadingIcon={<ReceiptText aria-hidden="true" strokeWidth={1.75} />}>
                View receipt
              </ButtonLink>
            ) : null}
            {mapStops.length > 1 ? (
              <Button size="lg" variant="secondary" fullWidth onClick={() => setMapOpen(true)} leadingIcon={<MapPin aria-hidden="true" strokeWidth={1.75} />}>
                View route
              </Button>
            ) : null}
            <CancelPaidBooking booking={b} onCancelled={onChange} />
          </div>
        </Card>

        {b.status === "delivered" ? <Feedback b={b} onChange={onChange} /> : null}
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <Card as="section" aria-labelledby="driver-heading" padding="md">
          <CardTitle id="driver-heading" icon={<UserRound strokeWidth={1.75} />}>
            Driver
          </CardTitle>
          {b.driver ? (
            <div className="mt-3 flex items-center gap-3">
              <Avatar name={b.driver.name} src={b.driver.photoUrl ?? undefined} />
              <div className="min-w-0">
                <p className="font-semibold text-ink">{b.driver.name}</p>
                {b.driver.ratingCount > 0 ? <Rating value={b.driver.ratingAvg} count={b.driver.ratingCount} countLabel="reviews" /> : null}
                {b.driver.phone ? (
                  <a href={`tel:${b.driver.phone}`} className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-green-700 hover:underline">
                    <Phone aria-hidden="true" strokeWidth={1.75} className="size-4" />
                    {formatPhone(b.driver.phone.replace(/^\+91/, ""))}
                  </a>
                ) : (
                  <p className="mt-1 text-caption text-ink-subtle">Phone shared once your payment is confirmed.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">Driver details are shared after {agency} accepts.</p>
          )}
        </Card>

        <Card as="section" aria-labelledby="vehicle-heading" padding="md">
          <CardTitle id="vehicle-heading" icon={<Truck strokeWidth={1.75} />}>
            Vehicle
          </CardTitle>
          <div className="mt-3 flex items-start gap-4">
            <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-md bg-surface-muted">
              {b.vehicle?.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.vehicle.photoUrl} alt={`${b.vehicle.makeModel} photo`} className="size-full object-cover" />
              ) : (
                <Image src={vehicleImageSrc(b.trip.vehicle.imageKey)} alt={`${b.trip.vehicle.vehicleClass} (illustrative photo)`} fill sizes="80px" className="object-cover" />
              )}
            </div>
            <dl className="min-w-0 flex-1 space-y-2 text-sm">
              <Info term="Agency" value={agency} />
              <Info term="Type" value={`${b.trip.vehicle.vehicleClass} · ${b.trip.vehicle.makeModel}`} />
              <Info term="Registration" value={b.vehicle?.registrationNumber ?? "Shared after acceptance"} />
            </dl>
          </div>
        </Card>

        <Card as="section" aria-labelledby="route-info-heading" padding="md">
          <CardTitle id="route-info-heading" icon={<MapPinned strokeWidth={1.75} />}>
            Route
          </CardTitle>
          <dl className="mt-3 space-y-3 text-sm">
            <Info term="Pickup" value={`${b.shipment.source.line1}, ${b.shipment.source.districtName} ${b.shipment.source.pincode}`} />
            <Info term="Pickup point" value={`${b.trip.pickup.placeName} · ${formatDateTime(b.trip.pickup.expectedDepartureAt)}`} />
            <Info term="Delivery" value={`${b.shipment.destination.line1}, ${b.shipment.destination.districtName} ${b.shipment.destination.pincode}`} />
            <Info term="Expected arrival" value={formatDateTime(b.trip.drop.expectedArrivalAt)} />
            <Info term="Receiver" value={`${b.shipment.receiver.name} · ${formatPhone(b.shipment.receiver.phone.replace(/^\+91/, ""))}`} />
          </dl>
        </Card>

        <Card as="section" aria-labelledby="booking-heading" padding="md">
          <CardTitle id="booking-heading" icon={<Wallet strokeWidth={1.75} />}>
            Booking / Payment
          </CardTitle>
          <dl className="mt-3 space-y-3 text-sm">
            <Info term="Requested" value={formatInstantDate(b.createdAt)} />
            <Info term="Package" value={`${formatKg(b.shipment.package.weightKg)} · ${b.shipment.package.pieces} × ${PACKAGE_TYPE_LABEL[b.shipment.package.packageType]}`} />
            <Info term="Goods" value={`${GOODS_LABEL[b.shipment.package.goodsCategory]}: ${b.shipment.package.description}`} />
            {b.shipment.package.specialHandling.length ? <Info term="Special handling" value={b.shipment.package.specialHandling.map((h) => HANDLING_LABEL[h]).join(", ")} /> : null}
            <Info term="Payment" value={b.payment ? `${PAYMENT_STATUS_TEXT[b.payment.status]}${b.payment.methodLabel ? ` · ${b.payment.methodLabel}` : ""}` : "Not paid yet"} />
          </dl>
          <BookingSummary pricing={b.pricing} title="Price breakdown" className="mt-4 rounded-none border-0 border-t border-border bg-transparent px-0 pb-0 pt-4 shadow-none sm:px-0 sm:pb-0" />
        </Card>
      </div>

      <Modal open={mapOpen} onClose={() => setMapOpen(false)} title="Route" description={`${b.trip.pickup.placeName} to ${b.trip.drop.placeName}`} size="lg">
        <RouteMap stops={mapStops} variant="modal" caption={MAP_CAPTION} />
        <p className="mt-3 text-caption text-ink-muted">{MAP_CAPTION}. The map shows the planned stops, not the vehicle&apos;s position.</p>
      </Modal>
    </div>
  );
}

/** Pickup / delivery OTPs, shown to the customer only. The driver enters them to confirm each handover. */
function VerificationCodes({ b, onChange }: { b: CustomerBookingDTO; onChange(b: CustomerBookingDTO): void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"pickup" | "delivery" | null>(null);
  const otps = b.otps!;
  const rows = [
    { key: "pickup" as const, label: "Pickup OTP", code: otps.pickup, used: otps.pickupUsed, locked: otps.pickupLocked, hint: "Share with the driver when they collect your goods." },
    { key: "delivery" as const, label: "Delivery OTP", code: otps.delivery, used: otps.deliveryUsed, locked: otps.deliveryLocked, hint: "Give this to the receiver. Share only when the goods arrive." },
  ];

  async function regenerate(which: "pickup" | "delivery") {
    setBusy(which);
    try {
      const r = await customerApi.regenerateOtp(b.id, which);
      onChange({ ...b, otps: r.otps });
      toast({ title: "New code generated", tone: "success" });
    } catch (e) {
      toast({ title: "Couldn't generate a new code", description: errorMessage(e), tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="otp-heading" className="mt-6 rounded-md border border-border bg-surface-muted p-4" data-testid="verification-codes">
      <h3 id="otp-heading" className="flex items-center gap-2 font-heading text-base font-semibold text-ink">
        <KeyRound aria-hidden="true" strokeWidth={1.75} className="size-4.5 text-green-700" />
        Verification codes
      </h3>
      <p className="mt-1 text-caption text-ink-muted">Only you can see these codes. TAKI will never ask for them.</p>
      <dl className="mt-3 space-y-3 text-sm">
        {rows.map((r) => (
          <div key={r.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <dt className="min-w-0">
              <span className="block font-medium text-ink">{r.label}</span>
              <span className="block text-caption text-ink-muted">{r.used ? "Verified by the driver" : r.locked ? "Too many wrong attempts. Generate a new code." : r.hint}</span>
            </dt>
            <dd data-testid={`${r.key}-otp`} className="flex items-center gap-2 font-heading text-lg font-bold tracking-[0.25em] tabular-nums text-ink">
              {r.used ? (
                <span className="flex items-center gap-1.5 text-sm font-semibold tracking-normal text-green-700">
                  <CircleCheck aria-hidden="true" strokeWidth={1.75} className="size-4" />
                  Verified
                </span>
              ) : (
                <>
                  {r.code ?? "——"}
                  {r.locked ? (
                    <Button size="sm" variant="outline" className="tracking-normal" loading={busy === r.key} onClick={() => regenerate(r.key)} leadingIcon={<RefreshCw strokeWidth={1.75} />}>
                      New code
                    </Button>
                  ) : null}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** "How was your delivery?" — one review per shipment; read-only after submit. */
function Feedback({ b, onChange }: { b: CustomerBookingDTO; onChange(b: CustomerBookingDTO): void }) {
  const { toast } = useToast();
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (b.review) {
    return (
      <Card as="section" id="feedback" aria-labelledby="feedback-heading" padding="md">
        <h2 id="feedback-heading" className="type-h3 text-ink">
          Your feedback
        </h2>
        <Rating value={b.review.rating} className="mt-2" />
        {b.review.comment ? <p className="mt-2 text-sm text-ink">{b.review.comment}</p> : null}
        <p className="mt-2 text-sm text-green-700">Thanks for your feedback.</p>
      </Card>
    );
  }
  if (!b.canReview) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rating) {
      setError("Choose a rating");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const review = await customerApi.review(b.id, { rating, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      toast({ title: "Thanks for your feedback", tone: "success" });
      onChange({ ...b, review, canReview: false });
    } catch (err) {
      setError(errorMessage(err));
      setSending(false);
    }
  }

  return (
    <Card as="section" id="feedback" aria-labelledby="feedback-heading" padding="md">
      <h2 id="feedback-heading" className="type-h3 text-ink">
        How was your delivery?
      </h2>
      <form onSubmit={submit} noValidate className="mt-3 flex flex-col gap-4">
        <RatingInput value={rating} onChange={(v) => setRating(v)} legend="Rate the driver" required error={error === "Choose a rating" ? error : undefined} />
        <Textarea aria-label="Comment (optional)" placeholder="Tell others about the pickup and delivery (optional)" rows={3} maxLength={V2.reviewCommentMax} value={comment} onChange={(e) => setComment(e.target.value)} />
        {error && error !== "Choose a rating" ? (
          <p role="alert" className="flex items-start gap-1.5 text-sm text-error">
            <CircleAlert aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={sending} className="self-start">
          {sending ? "Sending…" : "Submit feedback"}
        </Button>
      </form>
    </Card>
  );
}

function Info({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-ink-muted">{term}</dt>
      <dd className="min-w-0 font-medium text-ink sm:text-right">{value}</dd>
    </div>
  );
}

function Notice({ tone, title, children }: { tone: "warning" | "danger"; title: string; children: ReactNode }) {
  return (
    <div
      data-testid="tracking-notice"
      className={tone === "danger" ? "rounded-md border border-error/25 bg-danger-100 p-4 text-sm text-ink" : "rounded-md border border-warning-700/20 bg-warning-100 p-4 text-sm text-ink"}
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
      <div className="space-y-5 rounded-lg border border-border bg-surface p-5 shadow-card">
        <Skeleton lines={2} className="w-1/2" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="size-8 shrink-0" rounded="full" />
            <Skeleton lines={2} className="flex-1" />
          </div>
        ))}
      </div>
      <div className="space-y-5">
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    </div>
  );
}

/** Card heading with the reference's light-green icon badge. */
function CardTitle({ id, icon, children }: { id: string; icon: ReactNode; children: ReactNode }) {
  return (
    <h2 id={id} className="type-h3 flex items-center gap-3 text-ink">
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-green-100 text-green-700 [&_svg]:size-5">
        {icon}
      </span>
      {children}
    </h2>
  );
}
