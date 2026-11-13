"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, CircleCheckBig, Flag, MapPinned, Truck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Button, CapacityBar, Card, FormField, Modal, Skeleton, Textarea, useToast } from "@/components/ui";
import type { DriverTripBookingRef, DriverTripCheckpointDTO, DriverTripDTO, DriverTripNextStep } from "@/lib/api/contracts/driver";
import { driverApi } from "@/lib/api/client/driver";
import { errorMessage, isApiError } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { formatDateTime, formatKg, formatKm } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { delayLabel, TRIP_STATUS_LABEL, TRIP_TONE } from "./labels";
import { LoadError, NotLinkedNotice, Section, StatusBadge } from "./parts";
import { useResource } from "./useResource";

/** Trip run (P3 §4.5): Source → checkpoints → Destination, recorded strictly in route order. */
export function TripRunView({ tripId }: { tripId: string }) {
  const { state, reload, replace } = useResource((signal) => driverApi.trip(tripId, signal), tripId);
  const backHref = paths.driver.dashboard;

  if (state.status === "loading") return <TripLoading />;
  if (state.status === "error") {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="Trip" backHref={backHref} backLabel="Back to dashboard" />
        {state.code === "not_found" || state.code === "forbidden" ? (
          <Card tone="muted">
            <h2 className="type-h3 text-ink">Trip not found</h2>
            <p className="mt-1 text-sm text-ink-muted">This trip isn&apos;t assigned to you. Your agency may have reassigned it.</p>
          </Card>
        ) : state.code === "driver_not_linked" ? (
          <NotLinkedNotice />
        ) : (
          <LoadError message={state.message} onRetry={reload} />
        )}
      </div>
    );
  }
  return <TripRun t={state.data} backHref={backHref} onChange={replace} onStale={reload} />;
}

function stepLabel(t: DriverTripDTO, step: DriverTripNextStep): string {
  const last = t.checkpoints.length - 1;
  if (step.kind === "depart" && step.index === 0) return "Start trip";
  if (step.kind === "arrive" && step.index === last) return "Arrived at destination";
  return step.kind === "arrive" ? `Arrived at ${step.placeName}` : `Departed ${step.placeName}`;
}

function TripRun({ t, backHref, onChange, onStale }: { t: DriverTripDTO; backHref: string; onChange(v: DriverTripDTO): void; onStale(): void }) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState<DriverTripNextStep | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const step = t.nextStep;
  const hasBar = !!step || t.canComplete;
  const currentIndex = step?.index ?? null;

  async function complete() {
    setCompleting(true);
    try {
      const v = await driverApi.completeTrip(t.id);
      onChange(v);
      setCompleteOpen(false);
      toast({ title: "Trip completed", description: "Your agency has been notified.", tone: "success" });
    } catch (e) {
      toast({ title: "Trip not completed", description: errorMessage(e), tone: "error" });
      if (isApiError(e) && e.status === 409) onStale();
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className={cn("mx-auto flex w-full max-w-3xl flex-col gap-4", hasBar && "pb-28")}>
      <PageHeader
        title={t.routeLabel}
        backHref={backHref}
        backLabel="Back to dashboard"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={TRIP_TONE[t.status]} size="md">
              {TRIP_STATUS_LABEL[t.status]}
            </Badge>
            <span className="text-[13px] text-ink-muted">
              {t.startedAt ? `Started ${formatDateTime(t.startedAt)}` : `Departs ${formatDateTime(t.departureAt)}`}
              {t.completedAt ? ` · Completed ${formatDateTime(t.completedAt)}` : ""}
            </span>
          </span>
        }
        className="mb-0 lg:mb-2"
      />

      <Section id="trip-vehicle" title="Vehicle and load">
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
          <Truck aria-hidden="true" className="size-4 text-green-700" />
          <span className="font-semibold">{t.vehicle.registrationNumber}</span>
          {t.vehicle.vehicleClass ? <span className="text-ink-muted">· {t.vehicle.vehicleClass}</span> : null}
          {t.vehicle.makeModel ? <span className="text-ink-muted">· {t.vehicle.makeModel}</span> : null}
        </p>
        <CapacityBar totalKg={t.capacity.offeredKg} bookedKg={t.capacity.bookedKg} reservedKg={t.capacity.reservedKg} />
        <p className="text-[13px] text-ink-muted">
          {t.shipmentCount} {t.shipmentCount === 1 ? "shipment" : "shipments"} · arrives {formatDateTime(t.arrivalAt)}
        </p>
      </Section>

      <section aria-labelledby="route-heading" className="flex flex-col gap-3">
        <h2 id="route-heading" className="type-h3 text-ink">
          Route
        </h2>
        <ol className="flex flex-col gap-3">
          {t.checkpoints.map((c) => (
            <CheckpointRow key={c.index} c={c} last={t.checkpoints.length - 1} current={currentIndex === c.index} remarks={t.events.filter((e) => e.checkpointIndex === c.index && e.remarks)} />
          ))}
        </ol>
      </section>

      {t.status === "completed" ? (
        <Card tone="muted" role="status" className="flex items-center gap-3">
          <CircleCheckBig aria-hidden="true" className="size-5 shrink-0 text-green-600" />
          <p className="text-sm text-ink">This trip is complete. Delivered shipments are in your history.</p>
        </Card>
      ) : t.status === "cancelled" ? (
        <Card tone="muted" role="status">
          <p className="text-sm text-ink">Your agency cancelled this trip.</p>
        </Card>
      ) : !step && !t.canComplete && t.status === "in_progress" ? (
        <Card tone="muted" role="status">
          <p className="text-sm text-ink">You&apos;ve arrived at the destination. Deliver the remaining shipments, then complete the trip.</p>
        </Card>
      ) : null}

      {hasBar ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 pb-safe shadow-raised backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 sm:px-6">
            {step ? (
              <>
                <p className="hidden min-w-0 flex-1 text-[13px] text-ink-muted sm:block">
                  {step.expectedAt ? `Expected ${formatDateTime(step.expectedAt)}` : "Record this when it happens."}
                </p>
                <Button
                  size="lg"
                  className="flex-1 sm:flex-none"
                  leadingIcon={step.kind === "arrive" ? <ArrowDownToLine className="size-5" aria-hidden="true" /> : <ArrowUpFromLine className="size-5" aria-hidden="true" />}
                  onClick={() => setConfirming(step)}
                >
                  {stepLabel(t, step)}
                </Button>
              </>
            ) : (
              <Button size="lg" className="flex-1 sm:ml-auto sm:flex-none" leadingIcon={<Flag className="size-5" aria-hidden="true" />} onClick={() => setCompleteOpen(true)}>
                Complete trip
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <CheckpointSheet t={t} step={confirming} onClose={() => setConfirming(null)} onDone={onChange} onStale={onStale} />

      <Modal
        open={completeOpen}
        onClose={completing ? () => undefined : () => setCompleteOpen(false)}
        hideClose={completing}
        size="sm"
        title="Complete this trip?"
        description="Every shipment on it has been delivered or closed. Your agency will see the trip as completed."
        footer={
          <>
            <Button variant="outline" onClick={() => setCompleteOpen(false)} disabled={completing}>
              Not yet
            </Button>
            <Button onClick={() => void complete()} loading={completing}>
              {completing ? "Completing…" : "Complete trip"}
            </Button>
          </>
        }
      >
        <span className="sr-only">Confirm trip completion</span>
      </Modal>
    </div>
  );
}

function CheckpointRow({
  c,
  last,
  current,
  remarks,
}: {
  c: DriverTripCheckpointDTO;
  last: number;
  current: boolean;
  remarks: DriverTripDTO["events"];
}) {
  const kind = c.index === 0 ? "Source" : c.index === last ? "Destination" : `Checkpoint ${c.index}`;
  const arrival = delayLabel(c.expectedArrivalAt, c.actualArrivalAt);
  const departure = delayLabel(c.expectedDepartureAt, c.actualDepartureAt);
  const done = (c.index === 0 || !!c.actualArrivalAt) && (c.index === last || !!c.actualDepartureAt);
  return (
    <li aria-current={current ? "step" : undefined}>
      <Card tone={current ? "selected" : "default"} padding="sm" className="flex flex-col gap-3 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                done ? "bg-green-700 text-white" : current ? "bg-mint-100 text-green-800" : "bg-surface-muted text-ink-muted",
              )}
            >
              {done ? <CircleCheckBig className="size-4" /> : <MapPinned className="size-4" />}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] text-ink-muted">
                {kind}
                {c.kmFromOrigin > 0 ? ` · ${formatKm(c.kmFromOrigin)}` : ""}
              </p>
              <h3 className="font-semibold text-ink">{c.placeName}</h3>
              <p className="text-[13px] text-ink-muted">{c.districtName}</p>
            </div>
          </div>
          {current ? <Badge tone="attention">Next</Badge> : done ? <Badge tone="success">Done</Badge> : null}
        </div>

        <dl className="grid grid-cols-1 gap-2 text-sm min-[400px]:grid-cols-2">
          {c.index > 0 ? <TimeFact label="Arrival" expected={c.expectedArrivalAt} actual={c.actualArrivalAt} delta={arrival} /> : null}
          {c.index < last ? <TimeFact label="Departure" expected={c.expectedDepartureAt} actual={c.actualDepartureAt} delta={departure} /> : null}
        </dl>

        {c.pickups.length > 0 ? <BookingRefs title="Pick up here" items={c.pickups} /> : null}
        {c.drops.length > 0 ? <BookingRefs title="Drop here" items={c.drops} /> : null}

        {remarks.length > 0 ? (
          <ul className="flex flex-col gap-1 border-t border-border pt-2 text-[13px]" aria-label={`Remarks at ${c.placeName}`}>
            {remarks.map((e) => (
              <li key={e.id} className="break-words text-ink">
                <span className="tabular-nums text-ink-muted">{formatDateTime(e.at)} · </span>
                {e.remarks}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </li>
  );
}

function TimeFact({ label, expected, actual, delta }: { label: string; expected: string | null; actual: string | null; delta: { text: string; late: boolean } | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="flex flex-wrap items-center gap-1.5">
        {actual ? (
          <span className="font-semibold tabular-nums text-ink">Recorded {formatDateTime(actual)}</span>
        ) : (
          <span className="tabular-nums text-ink">{expected ? `Expected ${formatDateTime(expected)}` : "Not scheduled"}</span>
        )}
        {delta ? <Badge tone={delta.late ? "attention" : "neutral"}>{delta.text}</Badge> : null}
      </dd>
    </div>
  );
}

function BookingRefs({ title, items }: { title: string; items: DriverTripBookingRef[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {items.map((b) => (
          <li key={b.bookingId}>
            <Link
              href={paths.driver.shipment(b.bookingId)}
              className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
            >
              <span className="min-w-0">
                <span className="font-mono font-semibold tabular-nums text-ink">{b.bookingId}</span>
                <span className="block truncate text-[13px] text-ink-muted">
                  {b.customerName}
                  {b.receiverName ? ` → ${b.receiverName}` : ""} · {formatKg(b.weightKg)}
                </span>
              </span>
              <StatusBadge status={b.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckpointSheet({
  t,
  step,
  onClose,
  onDone,
  onStale,
}: {
  t: DriverTripDTO;
  step: DriverTripNextStep | null;
  onClose(): void;
  onDone(v: DriverTripDTO): void;
  onStale(): void;
}) {
  const { toast } = useToast();
  const formId = useId();
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const label = step ? stepLabel(t, step) : "";

  async function submit() {
    if (!step) return;
    setBusy(true);
    try {
      const v = await driverApi.checkpoint(t.id, step.index, step.kind, { remarks: remarks.trim() || undefined });
      onDone(v);
      onClose();
      setRemarks("");
      toast({ title: label, description: "Recorded. Customers on this trip can see the update.", tone: "success" });
    } catch (e) {
      toast({ title: "Not recorded", description: errorMessage(e), tone: "error" });
      // Someone else (or another device) moved the trip on: refresh so the next step is right.
      if (isApiError(e) && (e.code === "checkpoint_out_of_order" || e.code === "invalid_transition")) {
        onClose();
        onStale();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!step}
      onClose={busy ? () => undefined : onClose}
      hideClose={busy}
      title={`${label}?`}
      description={
        step && step.kind === "depart" && step.index === 0
          ? "This starts the trip. Customers see that you're on the way, and picked-up shipments move to in transit."
          : "The time is recorded on our server when you confirm."
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            {busy ? "Recording…" : "Confirm"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormField label="Remarks" htmlFor={`${formId}-remarks`} optionalLabel>
          <Textarea id={`${formId}-remarks`} rows={2} maxLength={300} showCount value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={busy} placeholder="e.g. Traffic near toll plaza" />
        </FormField>
      </form>
    </Modal>
  );
}

function TripLoading() {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <span className="sr-only">Loading trip…</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-32 w-full" rounded="md" />
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-36 w-full" rounded="md" />
      ))}
    </div>
  );
}
