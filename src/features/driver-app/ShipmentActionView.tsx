"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, CircleCheck, ExternalLink, MapPin, MessageSquarePlus, PackageCheck, Route, Truck, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Button, Card, FileUpload, FormField, Input, Modal, OtpInput, Skeleton, Textarea, useToast } from "@/components/ui";
import type { DriverAddressDTO, DriverEventDTO, DriverShipmentDTO } from "@/lib/api/contracts/driver";
import { MAX_PROOF_FILES } from "@/lib/api/contracts/driver";
import { driverApi } from "@/lib/api/client/driver";
import { errorMessage, isApiError } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { UPLOAD_LIMITS } from "@/lib/domain/constants";
import { formatDateTime, formatKg } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { GOODS_LABEL, PACKAGE_LABEL } from "./labels";
import { CallButton, HandlingChips, LoadError, NotLinkedNotice, Section, StatusBadge } from "./parts";
import { useResource } from "./useResource";

type Sheet = null | "pickup" | "refuse" | "transit" | "out" | "deliver" | "remark";

const EVENT_LABEL: Record<DriverEventDTO["type"], string> = {
  requested: "Booking requested",
  accepted: "Accepted by agency",
  rejected: "Rejected",
  payment_succeeded: "Payment received",
  payment_failed: "Payment failed",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  picked_up: "Picked up",
  in_transit: "In transit",
  checkpoint_arrived: "Arrived at checkpoint",
  checkpoint_departed: "Departed checkpoint",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  delivery_proof_added: "Delivery photo added",
  remark: "Remark",
};

export interface ShipmentActionViewProps {
  bookingId: string;
  /** History record: no actions, back to history. */
  readOnly?: boolean;
}

/** Shipment action screen (P3 §4.5): details + sticky bottom action bar by status. */
export function ShipmentActionView({ bookingId, readOnly = false }: ShipmentActionViewProps) {
  const { state, reload, replace } = useResource((signal) => driverApi.shipment(bookingId, signal), bookingId);
  const backHref = readOnly ? paths.driver.history() : paths.driver.shipments();

  if (state.status === "loading") return <ShipmentLoading />;
  if (state.status === "error") {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title={bookingId} backHref={backHref} backLabel="Back to shipments" />
        {state.code === "not_found" ? (
          <Card tone="muted">
            <h2 className="type-h3 text-ink">Shipment not found</h2>
            <p className="mt-1 text-sm text-ink-muted">This shipment isn&apos;t assigned to you, or it hasn&apos;t been confirmed yet.</p>
          </Card>
        ) : state.code === "driver_not_linked" ? (
          <NotLinkedNotice />
        ) : (
          <LoadError message={state.message} onRetry={reload} />
        )}
      </div>
    );
  }
  return <ShipmentDetail s={state.data} readOnly={readOnly} backHref={backHref} onChange={replace} onRemark={reload} />;
}

function ShipmentDetail({
  s,
  readOnly,
  backHref,
  onChange,
  onRemark,
}: {
  s: DriverShipmentDTO;
  readOnly: boolean;
  backHref: string;
  onChange(v: DriverShipmentDTO): void;
  onRemark(): void;
}) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const actions = readOnly ? [] : s.allowedActions;
  const primary = actions.find((a) => a !== "remark" && a !== "refuse_pickup") ?? null;
  const lastEvent = s.events.at(-1) ?? null;

  return (
    <div className={cn("mx-auto flex w-full max-w-3xl flex-col gap-4", actions.length > 0 && "pb-28")}>
      <PageHeader
        title={s.bookingId}
        backHref={backHref}
        backLabel={readOnly ? "Back to history" : "Back to shipments"}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={s.status} size="md" />
            {lastEvent ? <span className="text-[13px] text-ink-muted">Recorded {formatDateTime(lastEvent.at)}</span> : null}
          </span>
        }
        className="mb-0 lg:mb-2"
      />

      {s.cancellation ? (
        <Card tone="muted" role="status">
          <p className="font-semibold text-ink">This shipment was cancelled</p>
          <p className="mt-1 text-sm text-ink-muted">
            {formatDateTime(s.cancellation.at)}
            {s.cancellation.note ? ` · ${s.cancellation.note}` : ""}
          </p>
        </Card>
      ) : null}

      {s.delivery ? <DeliveryProof delivery={s.delivery} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Section id="customer" title="Customer">
          <PersonRow name={s.customer.name} phone={s.customer.phone} />
        </Section>
        <Section id="receiver" title="Receiver">
          <PersonRow name={s.receiver.name} phone={s.receiver.phone} />
        </Section>
        <Section id="pickup" title={`Pickup · ${s.pickup.placeName}`}>
          <AddressBlock address={s.pickupAddress} fallback={s.pickup.district} when={`Expected ${formatDateTime(s.pickup.expectedAt)}`} />
        </Section>
        <Section id="drop" title={`Drop · ${s.drop.placeName}`}>
          <AddressBlock address={s.dropAddress} fallback={s.drop.district} when={`Expected ${formatDateTime(s.drop.expectedAt)}`} />
        </Section>
      </div>

      <Section id="package" title="Package">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <Fact label="Weight" value={formatKg(s.package.weightKg)} />
          <Fact label="Pieces" value={`${s.package.pieces} × ${PACKAGE_LABEL[s.package.packageType]}`} />
          <Fact label="Goods" value={GOODS_LABEL[s.package.goodsCategory]} />
          <Fact label="Booking" value={s.bookingId} mono />
        </dl>
        {s.description ? <p className="text-sm text-ink">{s.description}</p> : null}
        <HandlingChips items={s.package.specialHandling} />
      </Section>

      <Section
        id="trip"
        title="Trip and vehicle"
        action={
          <Link href={paths.driver.trip(s.tripId)} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-green-700 underline-offset-4 hover:underline">
            <Route aria-hidden="true" className="size-4" /> Open trip
          </Link>
        }
      >
        <p className="text-sm text-ink">
          <span className="font-semibold">{s.trip.routeLabel}</span> · departs {formatDateTime(s.trip.departureAt)}
        </p>
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Truck aria-hidden="true" className="size-4" />
          {s.vehicle.registrationNumber}
          {s.vehicle.vehicleClass ? ` · ${s.vehicle.vehicleClass}` : ""}
          {s.vehicle.makeModel ? ` · ${s.vehicle.makeModel}` : ""}
        </p>
        {s.checkpoints.length > 0 ? (
          <ol className="mt-1 flex flex-col gap-2 border-l-2 border-border pl-4" aria-label="Checkpoints on this shipment's route">
            {s.checkpoints.map((c) => (
              <li key={c.index} className="relative text-sm">
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute -left-[23px] top-1 size-3 rounded-full border-2 border-surface",
                    c.actualArrivalAt || c.actualDepartureAt ? "bg-green-600" : "bg-border-strong",
                  )}
                />
                <span className="font-medium text-ink">{c.placeName}</span>
                {c.isPickup ? <Badge className="ml-2" tone="info">Pickup</Badge> : null}
                {c.isDrop ? <Badge className="ml-2" tone="info">Drop</Badge> : null}
                <span className="block text-[13px] text-ink-muted">
                  {c.actualDepartureAt
                    ? `Departed ${formatDateTime(c.actualDepartureAt)}`
                    : c.actualArrivalAt
                      ? `Arrived ${formatDateTime(c.actualArrivalAt)}`
                      : c.expectedArrivalAt
                        ? `Expected ${formatDateTime(c.expectedArrivalAt)}`
                        : c.expectedDepartureAt
                          ? `Departs ${formatDateTime(c.expectedDepartureAt)}`
                          : ""}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </Section>

      <Section id="timeline" title="Updates">
        {s.events.length === 0 ? (
          <p className="text-sm text-ink-muted">No updates yet.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {[...s.events].reverse().map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-green-600" />
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {EVENT_LABEL[e.type]}
                    {e.placeName ? <span className="font-normal text-ink-muted"> · {e.placeName}</span> : null}
                  </p>
                  <p className="text-[13px] tabular-nums text-ink-muted">{formatDateTime(e.at)}</p>
                  {e.remarks ? <p className="mt-0.5 break-words text-ink">{e.remarks}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {actions.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 pb-safe shadow-raised backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 sm:px-6">
            {actions.includes("remark") ? (
              <Button variant="outline" onClick={() => setSheet("remark")} leadingIcon={<MessageSquarePlus className="size-4" aria-hidden="true" />} aria-label="Add remark">
                <span className="hidden sm:inline">Remark</span>
              </Button>
            ) : null}
            {actions.includes("refuse_pickup") ? (
              <Button variant="ghost" onClick={() => setSheet("refuse")} leadingIcon={<Ban className="size-4" aria-hidden="true" />}>
                Can&apos;t pick up
              </Button>
            ) : null}
            {primary ? (
              <Button
                className="ml-auto flex-1 sm:flex-none"
                size="lg"
                onClick={() => setSheet(primary === "pickup" ? "pickup" : primary === "start_transit" ? "transit" : primary === "out_for_delivery" ? "out" : "deliver")}
                leadingIcon={<PackageCheck className="size-5" aria-hidden="true" />}
              >
                {primary === "pickup" ? "Confirm pickup" : primary === "start_transit" ? "Start transit" : primary === "out_for_delivery" ? "Out for delivery" : "Confirm delivery"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <PickupSheet open={sheet === "pickup"} s={s} onClose={() => setSheet(null)} onDone={onChange} />
      <RefuseSheet open={sheet === "refuse"} s={s} onClose={() => setSheet(null)} onDone={onChange} />
      <StepSheet open={sheet === "transit"} kind="transit" s={s} onClose={() => setSheet(null)} onDone={onChange} />
      <StepSheet open={sheet === "out"} kind="out" s={s} onClose={() => setSheet(null)} onDone={onChange} />
      <DeliverSheet open={sheet === "deliver"} s={s} onClose={() => setSheet(null)} onDone={onChange} />
      <RemarkSheet open={sheet === "remark"} s={s} onClose={() => setSheet(null)} onDone={onRemark} />
    </div>
  );
}

function PersonRow({ name, phone }: { name: string; phone: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="min-w-0 truncate font-medium text-ink">{name}</p>
      {phone ? <CallButton phone={phone} name={name} /> : <span className="text-[13px] text-ink-subtle">No contact</span>}
    </div>
  );
}

function AddressBlock({ address, fallback, when }: { address: DriverAddressDTO | null; fallback: string; when: string }) {
  if (!address) return <p className="text-sm text-ink-muted">{fallback}</p>;
  return (
    <div className="flex flex-col gap-2">
      <address className="text-sm not-italic text-ink">
        {address.line1}
        {address.line2 ? <>, {address.line2}</> : null}
        {address.landmark ? <span className="block text-ink-muted">Landmark: {address.landmark}</span> : null}
        <span className="block">
          {address.districtName} {address.pincode}
        </span>
      </address>
      <p className="text-[13px] text-ink-muted">{when}</p>
      <a
        href={address.mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-green-700 underline-offset-4 hover:underline"
      >
        <MapPin aria-hidden="true" className="size-4" /> Open in Maps
        <ExternalLink aria-hidden="true" className="size-3.5" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className={cn("truncate font-semibold text-ink", mono && "font-mono tabular-nums")}>{value}</dd>
    </div>
  );
}

function DeliveryProof({ delivery }: { delivery: NonNullable<DriverShipmentDTO["delivery"]> }) {
  return (
    <Card as="section" aria-labelledby="proof" className="flex flex-col gap-3 border-green-300 bg-green-50">
      <h2 id="proof" className="type-h3 flex items-center gap-2 text-ink">
        <CircleCheck aria-hidden="true" className="size-5 text-green-600" /> Delivered {formatDateTime(delivery.at)}
      </h2>
      {delivery.remarks ? <p className="text-sm text-ink">{delivery.remarks}</p> : null}
      {delivery.proofUrls.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Delivery photos">
          {delivery.proofUrls.map((u, i) => (
            <li key={u}>
              <a href={u} target="_blank" rel="noopener noreferrer" className="block size-24 overflow-hidden rounded-md border border-border bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element -- private, access-checked file */}
                <img src={u} alt={`Delivery photo ${i + 1}`} className="size-full object-cover" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

// ── Action sheets ────────────────────────────────────────────────────────────
interface SheetProps {
  open: boolean;
  s: DriverShipmentDTO;
  onClose(): void;
  onDone(v: DriverShipmentDTO): void;
}

function otpError(e: unknown): string {
  if (isApiError(e)) {
    if (e.code === "otp_invalid") {
      const left = typeof e.details?.attemptsLeft === "number" ? e.details.attemptsLeft : null;
      return left !== null ? `That code is incorrect. ${left} ${left === 1 ? "attempt" : "attempts"} left.` : e.message;
    }
    if (e.code === "too_many_attempts") return "Too many incorrect attempts. Ask the customer to generate a new code in their TAKI app.";
  }
  return errorMessage(e);
}

function isOtpProblem(e: unknown): boolean {
  return isApiError(e) && (e.code === "otp_invalid" || e.code === "too_many_attempts" || e.code === "otp_expired");
}

function SheetFooter({ busy, label, onCancel, form }: { busy: boolean; label: string; onCancel(): void; form: string }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="outline" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" form={form} loading={busy}>
        {busy ? "Recording…" : label}
      </Button>
    </div>
  );
}

function PickupSheet({ open, s, onClose, onDone }: SheetProps) {
  const { toast } = useToast();
  const formId = useId();
  const [otp, setOtp] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (otp.length !== 6) {
      setError("Enter the 6-digit pickup code from the customer.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const v = await driverApi.pickup(s.bookingId, { otp, remarks: remarks.trim() || undefined });
      onDone(v);
      onClose();
      setOtp("");
      setRemarks("");
      toast({ title: "Pickup confirmed", description: `${s.bookingId} is on board. The customer has been notified.`, tone: "success" });
    } catch (e) {
      if (isOtpProblem(e)) setError(otpError(e));
      else toast({ title: "Pickup not recorded", description: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      hideClose={busy}
      title="Confirm pickup"
      description={`Ask ${s.customer.name} for the 6-digit pickup code shown in their TAKI app.`}
      footer={<SheetFooter busy={busy} label="Confirm pickup" onCancel={onClose} form={formId} />}
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <OtpInput value={otp} onChange={setOtp} label="Pickup code" invalid={!!error} autoFocus aria-describedby={error ? `${formId}-err` : undefined} disabled={busy} />
          {error ? (
            <p id={`${formId}-err`} role="alert" className="text-sm text-error">
              {error}
            </p>
          ) : null}
        </div>
        <FormField label="Remarks" htmlFor={`${formId}-remarks`} optionalLabel>
          <Textarea id={`${formId}-remarks`} rows={2} maxLength={300} showCount value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. 2 boxes, sealed" disabled={busy} />
        </FormField>
      </form>
    </Modal>
  );
}

function RefuseSheet({ open, s, onClose, onDone }: SheetProps) {
  const { toast } = useToast();
  const formId = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (reason.trim().length < 5) {
      setError("Tell us why (at least 5 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const v = await driverApi.refusePickup(s.bookingId, reason.trim());
      onDone(v);
      onClose();
      toast({ title: "Pickup refused", description: "The customer and your agency have been notified. The customer gets a full refund.", tone: "info" });
    } catch (e) {
      toast({ title: "Not recorded", description: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      hideClose={busy}
      title="Can't pick up this shipment?"
      description="Only refuse if the goods can't be carried (for example prohibited or unsafe goods). This cancels the booking."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Keep booking
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={busy}>
            Refuse pickup
          </Button>
        </div>
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
        <FormField label="Reason" htmlFor={`${formId}-reason`} error={error ?? undefined} required>
          <Textarea id={`${formId}-reason`} rows={3} maxLength={300} showCount value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!error} disabled={busy} />
        </FormField>
      </form>
    </Modal>
  );
}

function StepSheet({ open, s, onClose, onDone, kind }: SheetProps & { kind: "transit" | "out" }) {
  const { toast } = useToast();
  const formId = useId();
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const title = kind === "transit" ? "Start transit" : "Mark out for delivery";

  async function submit() {
    setBusy(true);
    try {
      const r = remarks.trim() || undefined;
      const v = kind === "transit" ? await driverApi.startTransit(s.bookingId, r) : await driverApi.outForDelivery(s.bookingId, r);
      onDone(v);
      onClose();
      setRemarks("");
      toast({ title: kind === "transit" ? "In transit" : "Out for delivery", description: "The customer can see this update now.", tone: "success" });
    } catch (e) {
      toast({ title: "Not recorded", description: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      hideClose={busy}
      title={title}
      description={
        kind === "transit"
          ? "This usually happens automatically when you depart a checkpoint on the trip screen."
          : `Use this when you're on the way to ${s.receiver.name} in ${s.drop.placeName}.`
      }
      footer={<SheetFooter busy={busy} label={title} onCancel={onClose} form={formId} />}
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
          <Textarea id={`${formId}-remarks`} rows={2} maxLength={300} showCount value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={busy} />
        </FormField>
      </form>
    </Modal>
  );
}

interface Photo {
  id: number;
  file: File;
  url: string;
}
let photoSeq = 0;

function DeliverSheet({ open, s, onClose, onDone }: SheetProps) {
  const { toast } = useToast();
  const formId = useId();
  const [otp, setOtp] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [receivedBy, setReceivedBy] = useState("");
  const [remarks, setRemarks] = useState("");
  const [errors, setErrors] = useState<{ otp?: string; proof?: string }>({});
  const [busy, setBusy] = useState(false);

  function addPhoto(file: File) {
    setPhotos((p) => (p.length >= MAX_PROOF_FILES ? p : [...p, { id: ++photoSeq, file, url: URL.createObjectURL(file) }]));
    setErrors((e) => ({ ...e, proof: undefined }));
  }
  function removePhoto(id: number) {
    setPhotos((p) => {
      const gone = p.find((x) => x.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return p.filter((x) => x.id !== id);
    });
  }

  async function submit() {
    const next: { otp?: string; proof?: string } = {};
    if (otp.length !== 6) next.otp = "Enter the 6-digit delivery code from the receiver.";
    if (photos.length === 0) next.proof = "Take at least one photo of the delivered goods.";
    setErrors(next);
    if (next.otp || next.proof) return;
    setBusy(true);
    try {
      const v = await driverApi.deliver(s.bookingId, {
        otp,
        proof: photos.map((p) => p.file),
        receivedBy: receivedBy.trim() || undefined,
        remarks: remarks.trim() || undefined,
      });
      for (const p of photos) URL.revokeObjectURL(p.url);
      setPhotos([]);
      setOtp("");
      onDone(v);
      onClose();
      toast({ title: "Delivery confirmed", description: `${s.bookingId} is delivered. The customer and your agency have been notified.`, tone: "success" });
    } catch (e) {
      // The form keeps every value so the driver can retry (P3: "upload failed — retry keeps form").
      if (isOtpProblem(e)) setErrors({ otp: otpError(e) });
      else if (isApiError(e) && (e.code === "proof_required" || e.code === "file_invalid" || e.code === "file_too_large")) setErrors({ proof: e.message });
      else toast({ title: "Delivery not recorded", description: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      hideClose={busy}
      size="lg"
      title="Confirm delivery"
      description={`Ask ${s.receiver.name} for the 6-digit delivery code. The customer shares it with the receiver.`}
      footer={<SheetFooter busy={busy} label="Confirm delivery" onCancel={onClose} form={formId} />}
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-5"
      >
        <div className="flex flex-col gap-2">
          <OtpInput value={otp} onChange={setOtp} label="Delivery code" invalid={!!errors.otp} aria-describedby={errors.otp ? `${formId}-otp-err` : undefined} disabled={busy} />
          {errors.otp ? (
            <p id={`${formId}-otp-err`} role="alert" className="text-sm text-error">
              {errors.otp}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          {photos.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Delivery photos">
              {photos.map((p, i) => (
                <li key={p.id} className="relative size-24 overflow-hidden rounded-md border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local preview (blob URL) */}
                  <img src={p.url} alt={`Delivery photo ${i + 1}`} className="size-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(p.id)}
                    disabled={busy}
                    aria-label={`Remove photo ${i + 1}`}
                    className="absolute right-0 top-0 inline-flex size-11 items-center justify-center text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]"
                  >
                    <span className="flex size-7 items-center justify-center rounded-full bg-ink/70">
                      <X aria-hidden="true" className="size-4" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {photos.length < MAX_PROOF_FILES ? (
            <FileUpload
              label={photos.length === 0 ? "Delivery photo" : "Add another photo"}
              description={`Photograph the goods at the drop point (up to ${MAX_PROOF_FILES} photos).`}
              kind="image"
              capture="environment"
              maxSizeMb={UPLOAD_LIMITS.proofBytes / (1024 * 1024)}
              value={null}
              onSelect={addPhoto}
              error={errors.proof}
              required={photos.length === 0}
              disabled={busy}
              privateNote="Visible only to the customer, your agency and TAKI."
            />
          ) : (
            <p className="text-[13px] text-ink-muted">You&apos;ve added the maximum of {MAX_PROOF_FILES} photos.</p>
          )}
          {errors.proof && photos.length >= MAX_PROOF_FILES ? (
            <p role="alert" className="text-sm text-error">
              {errors.proof}
            </p>
          ) : null}
        </div>

        <FormField label="Received by" htmlFor={`${formId}-rcv`} optionalLabel hint="Name of the person who took the goods.">
          <Input id={`${formId}-rcv`} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} maxLength={80} autoComplete="off" disabled={busy} placeholder={s.receiver.name} />
        </FormField>
        <FormField label="Remarks" htmlFor={`${formId}-remarks`} optionalLabel>
          <Textarea id={`${formId}-remarks`} rows={2} maxLength={200} showCount value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={busy} />
        </FormField>
      </form>
    </Modal>
  );
}

function RemarkSheet({ open, s, onClose, onDone }: Omit<SheetProps, "onDone"> & { onDone(): void }) {
  const { toast } = useToast();
  const formId = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!text.trim()) {
      setError("Enter a remark.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await driverApi.addRemark(s.bookingId, text.trim());
      setText("");
      onClose();
      onDone();
      toast({ title: "Remark added", description: "The customer and your agency can see it.", tone: "success" });
    } catch (e) {
      toast({ title: "Remark not saved", description: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      hideClose={busy}
      title="Add a remark"
      description="Remarks are timestamped and shown to the customer and your agency."
      footer={<SheetFooter busy={busy} label="Add remark" onCancel={onClose} form={formId} />}
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormField label="Remark" htmlFor={`${formId}-text`} error={error ?? undefined} required>
          <Textarea id={`${formId}-text`} rows={3} maxLength={300} showCount value={text} onChange={(e) => setText(e.target.value)} invalid={!!error} disabled={busy} />
        </FormField>
      </form>
    </Modal>
  );
}

function ShipmentLoading(): ReactNode {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <span className="sr-only">Loading shipment…</span>
      <Skeleton className="h-9 w-48" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" rounded="md" />
        ))}
      </div>
      <Skeleton className="h-36 w-full" rounded="md" />
      <Skeleton className="h-48 w-full" rounded="md" />
    </div>
  );
}
