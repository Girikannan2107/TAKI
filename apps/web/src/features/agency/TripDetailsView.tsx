"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CircleCheck, Circle, EyeOff, MapPin, Pencil, Truck, UserRound, Users } from "lucide-react";
import { Avatar, Badge, Button, ButtonLink, CapacityBar, Card, EmptyState, FormField, Modal, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { agencyApi } from "@/lib/api/client/agency";
import type { AgencyTripDTO, TripFormDriverOption } from "@/lib/api/contracts/agency";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { formatINR, formatKg, formatKm, formatRate } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { fieldErrorsOf, when } from "./format";
import { BOOKING_STATUS, GOODS_LABEL, HANDLING_LABEL, TRIP_STATUS, plural } from "./labels";
import { LoadError } from "./states";
import { useApi } from "./useApi";

/** Trip details (`/agency/trips/[tripId]`, P3 §4.4): checkpoints (expected vs actual), vehicle, driver, capacity, bookings, actions. */
export function TripDetailsView({ tripId }: { tripId: string }) {
  const { state, reload, setData } = useApi(`trip:${tripId}`, () => agencyApi.trip(tripId));

  if (state.status === "loading") {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">Loading trip…</span>
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Skeleton className="h-96 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <PageHeader title="Trip" backHref={paths.agency.trips()} backLabel="Back to trips" />
        {state.code === "not_found" ? (
          <EmptyState title="Trip not found" description="It may have been deleted, or it belongs to another agency." action={{ label: "Back to trips", href: paths.agency.trips() }} />
        ) : (
          <LoadError message={state.message} onRetry={reload} />
        )}
      </>
    );
  }
  return <TripDetails trip={state.data} onChange={setData} />;
}

function TripDetails({ trip, onChange }: { trip: AgencyTripDTO; onChange(t: AgencyTripDTO): void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [modal, setModal] = useState<null | "cancel" | "reassign" | "unpublish">(null);
  const status = trip.status === "published" && trip.departed ? { label: "Departed", tone: "info" as const } : TRIP_STATUS[trip.status];
  const live = trip.status === "published" || trip.status === "in_progress";
  const held = trip.bookings.filter((b) => ["pending_payment", "payment_failed", "confirmed", "picked_up", "in_transit", "out_for_delivery"].includes(b.status));

  return (
    <>
      <PageHeader
        title={trip.routeLabel}
        backHref={paths.agency.trips()}
        backLabel="Back to trips"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone} size="md">
              {status.label}
            </Badge>
            <span>
              {formatKm(trip.distanceKm)} · {when(trip.departureAt)} → {when(trip.arrivalAt)}
            </span>
          </span>
        }
        actions={
          trip.status === "draft" ? (
            <ButtonLink href={paths.agency.newTrip(trip.id)} leadingIcon={<Pencil aria-hidden="true" strokeWidth={2} />}>
              Continue editing
            </ButtonLink>
          ) : undefined
        }
      />

      {trip.status === "cancelled" && trip.cancelReason ? (
        <Card tone="muted" padding="sm" className="mb-5">
          <p className="text-sm text-ink">
            <span className="font-semibold">Cancelled {when(trip.cancelledAt)}:</span> {trip.cancelReason}
          </p>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-6">
        <div className="flex min-w-0 flex-col gap-5">
          <Card as="section" aria-labelledby="checkpoints-title">
            <h2 id="checkpoints-title" className="type-h3 mb-4 text-ink">
              Route & checkpoints
            </h2>
            <ol className="flex flex-col" data-testid="trip-checkpoints">
              {trip.checkpoints.map((c, i) => {
                const last = i === trip.checkpoints.length - 1;
                const reached = !!(c.actualArrivalAt || c.actualDepartureAt);
                return (
                  <li key={c.index} className="relative flex gap-3 pb-5 last:pb-0">
                    {!last ? <span aria-hidden="true" className={cn("absolute left-[9px] top-6 h-[calc(100%-1rem)] w-0.5", reached ? "bg-green-500" : "bg-border")} /> : null}
                    {reached ? (
                      <CircleCheck aria-hidden="true" strokeWidth={2} className="relative mt-0.5 size-5 shrink-0 text-green-600" />
                    ) : (
                      <Circle aria-hidden="true" strokeWidth={2} className="relative mt-0.5 size-5 shrink-0 text-border-strong" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">
                        {c.placeName}
                        <span className="font-normal text-ink-muted">
                          {" "}
                          · {c.districtName} · {i === 0 ? "Source" : last ? "Destination" : `${formatKm(c.kmFromOrigin)} from source`}
                        </span>
                      </p>
                      <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
                        {i > 0 ? (
                          <div>
                            <dt className="inline text-ink-muted">Arrive: </dt>
                            <dd className="inline text-ink">
                              {when(c.expectedArrivalAt)}
                              {c.actualArrivalAt ? <span className="text-green-700"> (actual {when(c.actualArrivalAt)})</span> : null}
                            </dd>
                          </div>
                        ) : null}
                        {!last ? (
                          <div>
                            <dt className="inline text-ink-muted">Depart: </dt>
                            <dd className="inline text-ink">
                              {when(c.expectedDepartureAt)}
                              {c.actualDepartureAt ? <span className="text-green-700"> (actual {when(c.actualDepartureAt)})</span> : null}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="mt-4 text-xs text-ink-subtle">Distances are approximate road km. Actual times come from the driver&apos;s checkpoint updates.</p>
          </Card>

          <Card as="section" aria-labelledby="trip-bookings-title">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="trip-bookings-title" className="type-h3 text-ink">
                Bookings on this trip
              </h2>
              {trip.counts.awaiting > 0 ? <Badge tone="attention">{plural(trip.counts.awaiting, "pending request")}</Badge> : null}
            </div>
            {trip.bookings.length === 0 ? (
              <p className="text-sm text-ink-muted">No bookings yet.</p>
            ) : (
              <ul className="divide-y divide-border" data-testid="trip-bookings">
                {trip.bookings.map((b) => (
                  <li key={b.id}>
                    <Link href={paths.agency.booking(b.id)} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-3 hover:bg-surface-muted">
                      <span className="min-w-0">
                        <span className="block font-semibold text-ink">
                          {b.id} · {b.customerName}
                        </span>
                        <span className="block text-sm text-ink-muted">
                          {b.pickup.placeName} → {b.drop.placeName} · {formatKg(b.weightKg)} · {GOODS_LABEL[b.goodsCategory]}
                        </span>
                      </span>
                      <Badge tone={BOOKING_STATUS[b.status].tone}>{BOOKING_STATUS[b.status].label}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card as="section" aria-labelledby="capacity-title">
            <h2 id="capacity-title" className="type-h3 mb-3 text-ink">
              Capacity
            </h2>
            <CapacityBar totalKg={trip.capacity.offeredKg} bookedKg={trip.capacity.bookedKg} reservedKg={trip.capacity.reservedKg} />
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-ink-muted">Offered for booking</dt>
              <dd className="text-right font-semibold text-ink">{formatKg(trip.capacity.offeredKg)}</dd>
              <dt className="text-ink-muted">Paid</dt>
              <dd className="text-right text-ink">{formatKg(trip.capacity.bookedKg)}</dd>
              <dt className="text-ink-muted">Accepted, awaiting payment</dt>
              <dd className="text-right text-ink">{formatKg(trip.capacity.reservedKg)}</dd>
              <dt className="text-ink-muted">Remaining</dt>
              <dd className="text-right font-semibold text-green-700">{formatKg(trip.capacity.availableKg)}</dd>
            </dl>
          </Card>

          <Card as="section" aria-labelledby="vehicle-driver-title">
            <h2 id="vehicle-driver-title" className="type-h3 mb-3 text-ink">
              Vehicle & driver
            </h2>
            <p className="flex items-center gap-2 text-sm text-ink">
              <Truck aria-hidden="true" strokeWidth={1.75} className="size-[18px] text-green-500" />
              <Link href={paths.agency.vehicle(trip.vehicle.id)} className="underline-offset-4 hover:underline">
                {trip.vehicle.makeModel} · {trip.vehicle.registrationNumber}
              </Link>
            </p>
            <div className="mt-3 flex items-center gap-3">
              <Avatar name={trip.driver.fullName} src={trip.driver.photoUrl ?? undefined} size="sm" />
              <Link href={paths.agency.driver(trip.driver.id)} className="text-sm font-semibold text-ink underline-offset-4 hover:underline">
                {trip.driver.fullName}
              </Link>
            </div>
            {trip.status === "published" ? (
              <Button variant="outline" size="sm" className="mt-4" leadingIcon={<UserRound aria-hidden="true" strokeWidth={2} />} onClick={() => setModal("reassign")}>
                Reassign driver
              </Button>
            ) : null}
          </Card>

          <Card as="section" aria-labelledby="goods-title">
            <h2 id="goods-title" className="type-h3 mb-3 text-ink">
              Goods & pricing
            </h2>
            <p className="text-sm text-ink-muted">Accepted goods</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {trip.goods.accepted.map((g) => (
                <li key={g}>
                  <Badge tone="neutral">{GOODS_LABEL[g]}</Badge>
                </li>
              ))}
            </ul>
            {trip.goods.handlingSupported.length ? (
              <p className="mt-3 text-sm text-ink">
                <span className="text-ink-muted">Handling: </span>
                {trip.goods.handlingSupported.map((h) => HANDLING_LABEL[h]).join(", ")}
              </p>
            ) : null}
            {trip.goods.maxPackageKg ? <p className="mt-1 text-sm text-ink">Max per package: {formatKg(trip.goods.maxPackageKg)}</p> : null}
            {trip.goods.notes ? <p className="mt-1 text-sm text-ink">{trip.goods.notes}</p> : null}
            <p className="mt-3 text-sm text-ink tabular-nums">
              {formatRate(trip.rates.perKmPaise)}/km · {formatRate(trip.rates.perKgPaise)}/kg
              {trip.rates.additionalCharges?.length
                ? trip.rates.additionalCharges.map((c) => ` · ${c.label} ${formatINR(c.amountRupees)}${c.basis === "special_handling_only" ? " (special handling)" : ""}`).join("")
                : trip.rates.handlingFeeRupees
                  ? ` · ${formatINR(trip.rates.handlingFeeRupees)} handling`
                  : ""}
            </p>
          </Card>

          {trip.status === "draft" && trip.publishBlockers.length ? (
            <Card tone="muted" padding="sm" role="note">
              <p className="text-sm font-semibold text-ink">Before you can publish</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-muted">
                {trip.publishBlockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {trip.status === "published" ? (
            <div className="flex flex-wrap gap-2">
              {held.length === 0 && trip.counts.awaiting === 0 ? (
                <Button variant="outline" leadingIcon={<EyeOff aria-hidden="true" strokeWidth={2} />} onClick={() => setModal("unpublish")}>
                  Unpublish
                </Button>
              ) : null}
              <Button variant="danger" leadingIcon={<Ban aria-hidden="true" strokeWidth={2} />} onClick={() => setModal("cancel")}>
                Cancel trip
              </Button>
            </div>
          ) : null}
          {live && trip.status === "in_progress" ? (
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <MapPin aria-hidden="true" strokeWidth={1.75} className="size-4" /> The driver updates progress from the driver app.
            </p>
          ) : null}
        </div>
      </div>

      <CancelTripModal
        open={modal === "cancel"}
        trip={trip}
        affected={held.length + trip.counts.awaiting}
        onClose={() => setModal(null)}
        onDone={(t) => {
          setModal(null);
          onChange(t);
          toast({ title: "Trip cancelled", description: "Affected customers have been notified.", tone: "success" });
        }}
      />
      <ReassignModal
        open={modal === "reassign"}
        trip={trip}
        onClose={() => setModal(null)}
        onDone={(t) => {
          setModal(null);
          onChange(t);
          toast({ title: "Driver reassigned", description: t.driver.fullName, tone: "success" });
        }}
      />
      <UnpublishModal
        open={modal === "unpublish"}
        trip={trip}
        onClose={() => setModal(null)}
        onDone={() => {
          setModal(null);
          toast({ title: "Trip moved back to drafts", tone: "success" });
          router.push(paths.agency.trips({ tab: "drafts" }));
        }}
      />
    </>
  );
}

function CancelTripModal({ open, trip, affected, onClose, onDone }: { open: boolean; trip: AgencyTripDTO; affected: number; onClose(): void; onDone(t: AgencyTripDTO): void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (reason.trim().length < 3) {
      setError("Give a short reason (at least 3 characters)");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onDone(await agencyApi.cancelTrip(trip.id, reason.trim()));
      setReason("");
    } catch (e) {
      setError(fieldErrorsOf(e).reason ?? errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cancel this trip?"
      description={
        affected > 0
          ? `${plural(affected, "booking")} on this trip will be cancelled. Customers are notified, and paid bookings are refunded under TAKI's refund rules.`
          : "No bookings are affected. The trip will no longer be listed."
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Keep trip
          </Button>
          <Button variant="danger" loading={busy} onClick={submit}>
            Cancel trip
          </Button>
        </>
      }
    >
      <FormField label="Reason (shared with customers)" htmlFor="cancel-reason" error={error} required>
        <Textarea id="cancel-reason" value={reason} maxLength={300} showCount invalid={!!error} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      {trip.bookings.length > 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
          <Users aria-hidden="true" strokeWidth={1.75} className="size-4" />
          {trip.bookings
            .filter((b) => b.status !== "rejected" && b.status !== "cancelled")
            .map((b) => b.id)
            .join(", ") || "No active bookings"}
        </p>
      ) : null}
    </Modal>
  );
}

function ReassignModal({ open, trip, onClose, onDone }: { open: boolean; trip: AgencyTripDTO; onClose(): void; onDone(t: AgencyTripDTO): void }) {
  const options = useApi<TripFormDriverOption[] | null>(open ? `reassign:${trip.id}` : "reassign:closed", async () =>
    open ? (await agencyApi.tripFormOptions({ departureAt: trip.departureAt, arrivalAt: trip.arrivalAt, excludeTripId: trip.id })).drivers : null,
  );
  const [driverId, setDriverId] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!driverId) {
      setError("Choose a driver");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onDone(await agencyApi.reassignDriver(trip.id, driverId));
      setDriverId("");
    } catch (e) {
      setError(fieldErrorsOf(e).driverId ?? errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const drivers = options.state.status === "ready" ? (options.state.data ?? []) : [];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reassign driver"
      description="Only approved drivers who are free during this trip can be assigned. The new driver sees the confirmed shipments."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button loading={busy} onClick={submit} disabled={options.state.status !== "ready"}>
            Reassign
          </Button>
        </>
      }
    >
      {options.state.status === "error" ? (
        <p role="alert" className="text-sm text-error">
          {options.state.message}
        </p>
      ) : (
        <FormField label="New driver" htmlFor="reassign-driver" error={error} required>
          <Select
            id="reassign-driver"
            value={driverId}
            invalid={!!error}
            disabled={options.state.status !== "ready"}
            placeholder={options.state.status === "ready" ? "Choose a driver" : "Loading drivers…"}
            onChange={(e) => setDriverId(e.target.value)}
            options={drivers
              .filter((d) => d.id !== trip.driver.id)
              .map((d) => ({
                value: d.id,
                label: d.busy ? `${d.fullName} (on trip ${when(d.busy.from)} – ${when(d.busy.to)})` : d.availability === "unavailable" ? `${d.fullName} (unavailable)` : d.fullName,
                disabled: !!d.busy || d.availability === "unavailable",
              }))}
          />
        </FormField>
      )}
    </Modal>
  );
}

function UnpublishModal({ open, trip, onClose, onDone }: { open: boolean; trip: AgencyTripDTO; onClose(): void; onDone(): void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await agencyApi.unpublishTrip(trip.id);
      onDone();
    } catch (e) {
      toast({ title: "Couldn't unpublish", description: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Unpublish this trip?"
      description="Customers won't find it any more. It goes back to your drafts so you can edit and publish it again."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Keep listed
          </Button>
          <Button loading={busy} onClick={submit}>
            Unpublish
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink">{trip.routeLabel}</p>
    </Modal>
  );
}
