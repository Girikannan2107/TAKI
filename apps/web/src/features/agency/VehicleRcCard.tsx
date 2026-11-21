"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, Clock3, FileText } from "lucide-react";
import { Badge, Button, Card, FileUpload, FormField, Input, useToast, type BadgeTone, type FileUploadValue } from "@/components/ui";
import { agencyApi } from "@/lib/api/client/agency";
import type { VehicleDTO } from "@/lib/api/contracts/agency";
import { errorMessage, isApiError } from "@/lib/api/http";
import { formatDate } from "@/lib/format";
import { FormAlert } from "@/features/auth/AuthBits";
import { when } from "./format";

/** RC files chosen in the form; uploaded with E59 (PUT /agency/vehicles/{id}/documents/rc). */
export interface RcDraft {
  file: File | null;
  backFile: File | null;
  validUntil: string;
}

export const EMPTY_RC_DRAFT: RcDraft = { file: null, backFile: null, validUntil: "" };

export type RcState = "missing" | "pending" | "verified" | "rejected" | "suspended";

/** Where the vehicle's RC stands (no RC uploaded = "missing", whatever the review field says). */
export function rcStateOf(v: Pick<VehicleDTO, "rc" | "rcVerification">): RcState {
  if (!v.rc) return "missing";
  const s = v.rcVerification?.status;
  if (s === "verified" || s === "rejected" || s === "suspended") return s;
  return "pending";
}

export const RC_STATE: Record<RcState, { label: string; tone: BadgeTone }> = {
  missing: { label: "RC needed", tone: "attention" },
  pending: { label: "RC under review", tone: "warning" },
  verified: { label: "RC verified", tone: "success" },
  rejected: { label: "RC rejected", tone: "danger" },
  suspended: { label: "RC suspended", tone: "danger" },
};

const staged = (f: File | null): FileUploadValue | null => (f ? { name: f.name, status: "selected", sizeBytes: f.size } : null);

/** Field errors for a draft; `requireFile` when the user is about to upload. */
export function rcDraftErrors(d: RcDraft, requireFile: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (requireFile && !d.file) e.rcFile = "Add the front of the registration certificate";
  if (!d.file && (d.backFile || d.validUntil)) e.rcFile = "Add the front of the registration certificate";
  if (d.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(d.validUntil)) e.rcValidUntil = "Enter a valid date";
  return e;
}

export async function uploadRc(vehicleId: string, d: RcDraft): Promise<VehicleDTO> {
  return agencyApi.uploadVehicleRc(vehicleId, { file: d.file!, backFile: d.backFile, validUntil: d.validUntil || undefined });
}

export interface VehicleRcCardProps {
  /** Saved vehicle: the card uploads on its own. `null` = Add vehicle: the parent uploads `draft` after creating it. */
  vehicle: VehicleDTO | null;
  onSaved?(v: VehicleDTO): void;
  draft?: RcDraft;
  onDraftChange?(d: RcDraft): void;
  errors?: Record<string, string>;
}

/**
 * Registration certificate (RC) for a vehicle. TAKI requires an uploaded RC before a trip with this vehicle can
 * be published; TAKI then reviews it (pending → verified / rejected with a reason). The RC number is the
 * vehicle's registration number, so only the images and the expiry date are asked for.
 */
export function VehicleRcCard({ vehicle, onSaved, draft: controlled, onDraftChange, errors: outerErrors = {} }: VehicleRcCardProps) {
  const { toast } = useToast();
  const [local, setLocal] = useState<RcDraft>(EMPTY_RC_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);

  const draft = controlled ?? local;
  const setDraft = (patch: Partial<RcDraft>) => {
    const next = { ...draft, ...patch };
    if (onDraftChange) onDraftChange(next);
    else setLocal(next);
    setErrors({});
    setServiceError(null);
  };
  const shown = { ...outerErrors, ...errors };

  const state: RcState = vehicle ? rcStateOf(vehicle) : "missing";
  const meta = RC_STATE[state];
  const Icon = state === "verified" ? CircleCheck : state === "pending" ? Clock3 : CircleAlert;
  const showForm = !vehicle || state === "missing" || state === "rejected" || replacing;

  async function submit() {
    if (!vehicle) return;
    const e = rcDraftErrors(draft, true);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServiceError(null);
    try {
      const v = await uploadRc(vehicle.id, draft);
      setLocal(EMPTY_RC_DRAFT);
      setReplacing(false);
      onSaved?.(v);
      toast({ title: "RC uploaded", description: "TAKI will review it.", tone: "success" });
    } catch (err) {
      if (isApiError(err) && err.fields) {
        setErrors({
          ...(err.fields.file ? { rcFile: err.fields.file } : {}),
          ...(err.fields.backFile ? { rcBackFile: err.fields.backFile } : {}),
          ...(err.fields.validUntil ? { rcValidUntil: err.fields.validUntil } : {}),
        });
      }
      setServiceError(isApiError(err) && err.code === "already_verified" ? "This RC is already verified." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="veh-rc-title" padding="lg" data-testid="vehicle-rc">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="veh-rc-title" className="type-h3 text-ink">
            Registration certificate (RC)
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {vehicle
              ? state === "missing"
                ? "Upload the RC to publish trips with this vehicle."
                : state === "pending"
                  ? "Uploaded. TAKI is reviewing it."
                  : state === "verified"
                    ? "Checked by TAKI."
                    : "Upload a clear copy of the RC again."
              : "Required to publish trips with this vehicle. You can also add it later from the vehicle page."}
          </p>
        </div>
        {vehicle ? (
          <Badge tone={meta.tone} size="md" icon={<Icon aria-hidden="true" className="size-4" />}>
            {meta.label}
          </Badge>
        ) : null}
      </div>

      {vehicle?.rcVerification?.status === "rejected" && vehicle.rcVerification.reason ? (
        <p className="mb-4 rounded-md bg-danger-100 px-3 py-2 text-sm text-error">
          <span className="font-semibold">Reason:</span> {vehicle.rcVerification.reason}
        </p>
      ) : null}

      {vehicle?.rc ? (
        <dl className="mb-4 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-muted">Registration number</dt>
            <dd className="font-medium text-ink">{vehicle.rc.numberMasked ?? vehicle.registrationNumber}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Valid until</dt>
            <dd className="font-medium text-ink">{vehicle.rc.validUntil ? formatDate(vehicle.rc.validUntil) : "Not given"}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Uploaded</dt>
            <dd className="font-medium text-ink">{vehicle.rc.uploadedAt ? when(vehicle.rc.uploadedAt) : "—"}</dd>
          </div>
          <div className="flex flex-wrap gap-x-4">
            {vehicle.rc.fileUrl ? <FileLink href={vehicle.rc.fileUrl} label="Open front" /> : null}
            {vehicle.rc.backFileUrl ? <FileLink href={vehicle.rc.backFileUrl} label="Open back" /> : null}
          </div>
        </dl>
      ) : null}

      {showForm ? (
        <div className="flex flex-col gap-4">
          <FileUpload
            id="rc-front"
            label="RC front"
            kind="document"
            capture="environment"
            value={staged(draft.file)}
            onSelect={(f) => setDraft({ file: f })}
            onRemove={() => setDraft({ file: null })}
            error={shown.rcFile}
            required={!!vehicle}
          />
          <FileUpload
            id="rc-back"
            label="RC back (optional)"
            kind="document"
            capture="environment"
            value={staged(draft.backFile)}
            onSelect={(f) => setDraft({ backFile: f })}
            onRemove={() => setDraft({ backFile: null })}
            error={shown.rcBackFile}
          />
          <FormField label="Valid until" htmlFor="rc-valid-until" error={shown.rcValidUntil} optionalLabel hint="As printed on the RC.">
            <Input id="rc-valid-until" type="date" value={draft.validUntil} invalid={!!shown.rcValidUntil} onChange={(e) => setDraft({ validUntil: e.target.value })} />
          </FormField>
          {vehicle ? (
            <>
              <FormAlert>{serviceError}</FormAlert>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                {replacing ? (
                  <Button variant="ghost" onClick={() => setReplacing(false)} disabled={busy}>
                    Cancel
                  </Button>
                ) : null}
                <Button onClick={() => void submit()} loading={busy}>
                  {busy ? "Uploading…" : "Upload RC"}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : state === "pending" ? (
        <Button variant="ghost" size="sm" onClick={() => setReplacing(true)}>
          Replace RC
        </Button>
      ) : null}
    </Card>
  );
}

function FileLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-green-700 underline-offset-4 hover:underline">
      <FileText aria-hidden="true" strokeWidth={1.75} className="size-4" />
      {label}
    </a>
  );
}
