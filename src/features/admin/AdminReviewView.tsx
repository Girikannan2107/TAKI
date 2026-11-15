"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { CircleCheck, CircleX, ExternalLink, FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar, Button, Card, FormField, Modal, Textarea, useToast } from "@/components/ui";
import type { AdminAgencyDetailDTO, AdminDriverDetailDTO } from "@/lib/api/contracts/admin";
import type { DocumentDTO } from "@/lib/api/contracts/auth";
import { adminApi } from "@/lib/api/client/admin";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { STATE_NAMES } from "@/lib/domain/model";
import { formatDate, formatInstantDate } from "@/lib/format";
import { FormAlert } from "@/features/auth/AuthBits";
import { DOCUMENT_STATUS } from "@/features/account/DocumentsCard";
import { ListSkeleton, LoadError, ReviewBadge, useLoad } from "./AdminBits";

type Detail = { kind: "agency"; data: AdminAgencyDetailDTO } | { kind: "driver"; data: AdminDriverDetailDTO };

const vehicleRangeLabel = (r: string) => (r === "50+" ? "More than 50 vehicles" : `${r.replace("-", "–")} vehicles`);
const LINK_LABEL = { pending: "Awaiting agency approval", active: "Active", rejected: "Rejected by agency", removed: "Removed" } as const;

/** /admin/agencies/[agencyId] and /admin/drivers/[driverId] — details, masked documents, verify / reject. */
export function AdminReviewView({ kind }: { kind: "agency" | "driver" }) {
  const params = useParams<{ agencyId?: string; driverId?: string }>();
  const id = (kind === "agency" ? params.agencyId : params.driverId) ?? "";
  const { state, reload, set } = useLoad<Detail>(
    async () => (kind === "agency" ? { kind: "agency", data: await adminApi.agency(id) } : { kind: "driver", data: await adminApi.driver(id) }),
    `${kind}:${id}`,
  );
  const backHref = kind === "agency" ? paths.admin.agencies() : paths.admin.drivers();
  const backLabel = kind === "agency" ? "Back to agencies" : "Back to drivers";

  if (state.status === "loading") {
    return (
      <>
        <PageHeader title={kind === "agency" ? "Agency" : "Driver"} backHref={backHref} backLabel={backLabel} />
        <ListSkeleton rows={3} label="Loading details" />
      </>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <PageHeader title={kind === "agency" ? "Agency" : "Driver"} backHref={backHref} backLabel={backLabel} />
        <LoadError message={state.message} onRetry={reload} />
      </>
    );
  }

  const d = state.data;
  const name = d.kind === "agency" ? d.data.agencyName : d.data.fullName;

  return (
    <div className="mx-auto w-full max-w-[880px]">
      <PageHeader title={name} backHref={backHref} backLabel={backLabel} actions={<ReviewBadge verification={d.data.verification} complete={d.data.documentsComplete} />} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card as="section" aria-labelledby="details-title">
            <div className="mb-4 flex items-center gap-4">
              <Avatar name={d.kind === "agency" ? d.data.ownerName : d.data.fullName} src={d.data.photoUrl ?? undefined} size="lg" decorative />
              <div className="min-w-0">
                <h2 id="details-title" className="type-h3 text-ink">
                  {d.kind === "agency" ? "Agency details" : "Driver details"}
                </h2>
                <p className="text-sm text-ink-muted">{d.data.photoUrl ? "Photo uploaded" : "No photo yet"}</p>
                {d.data.photoUrl ? <FileLink href={d.data.photoUrl} label="Open photo" /> : null}
              </div>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {d.kind === "agency" ? (
                <>
                  <Item term="Owner" value={d.data.ownerName} />
                  <Item term="Phone" value={d.data.phone} />
                  <Item term="District" value={`${d.data.districtName}, ${STATE_NAMES[d.data.state] ?? d.data.state}`} />
                  <Item term="States covered" value={d.data.statesCovered.map((s) => STATE_NAMES[s] ?? s).join(", ")} />
                  <Item term="Fleet size" value={vehicleRangeLabel(d.data.vehicleCountRange)} />
                  <Item term="Signed up" value={formatInstantDate(d.data.createdAt)} />
                </>
              ) : (
                <>
                  <Item term="Phone" value={d.data.phone} />
                  <Item term="Agency" value={d.data.agencyName ? `${d.data.agencyName}${d.data.linkStatus ? ` · ${LINK_LABEL[d.data.linkStatus]}` : ""}` : "None"} />
                  <Item term="Licence valid until" value={d.data.licenseValidUntil ? formatDate(d.data.licenseValidUntil) : "Not given"} />
                  <Item term="Signed up" value={formatInstantDate(d.data.createdAt)} />
                </>
              )}
            </dl>
          </Card>

          <Card as="section" aria-labelledby="docs-title">
            <h2 id="docs-title" className="type-h3 mb-1 text-ink">
              Documents
            </h2>
            <p className="mb-4 text-sm text-ink-muted">Numbers are masked. Files open in a new tab through the access-checked file route.</p>
            {d.data.documents.length === 0 ? (
              <p className="rounded-md bg-surface-muted px-4 py-3 text-sm text-ink-muted">No documents uploaded yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {d.data.documents.map((doc) => (
                  <DocumentItem key={doc.kind} doc={doc} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <DecisionPanel
          detail={d}
          onDecided={(next) => {
            set(next);
          }}
        />
      </div>
    </div>
  );
}

function Item({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-ink-subtle">{term}</dt>
      <dd className="break-words font-medium text-ink">{value}</dd>
    </div>
  );
}

function FileLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-green-700 underline-offset-4 hover:underline">
      {label}
      <ExternalLink aria-hidden="true" className="size-3.5" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function DocumentItem({ doc }: { doc: DocumentDTO }) {
  const s = DOCUMENT_STATUS[doc.status];
  return (
    <li className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <FileText aria-hidden="true" className="size-4 text-green-700" />
          {doc.label}
        </p>
        <span className="text-caption text-ink-muted">{doc.status === "missing" ? s.label : doc.uploadedAt ? `Uploaded ${formatInstantDate(doc.uploadedAt)}` : ""}</span>
      </div>
      {doc.numberMasked ? <p className="font-mono text-sm tabular-nums text-ink-muted">{doc.numberMasked}</p> : null}
      <div className="flex flex-wrap gap-x-4">
        {doc.fileUrl ? <FileLink href={doc.fileUrl} label={doc.backFileUrl ? "Open front" : "Open file"} /> : null}
        {doc.backFileUrl ? <FileLink href={doc.backFileUrl} label="Open back" /> : null}
      </div>
    </li>
  );
}

function DecisionPanel({ detail, onDecided }: { detail: Detail; onDecided(next: Detail): void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"verify" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const v = detail.data.verification;
  const id = detail.data.id;
  const noun = detail.kind === "agency" ? "agency" : "driver";

  async function verify() {
    setBusy("verify");
    setError(null);
    try {
      const next: Detail = detail.kind === "agency" ? { kind: "agency", data: await adminApi.verifyAgency(id) } : { kind: "driver", data: await adminApi.verifyDriver(id) };
      onDecided(next);
      toast({ tone: "success", title: `${detail.kind === "agency" ? "Agency" : "Driver"} verified`, description: "They've been notified." });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    const r = reason.trim();
    if (r.length < 3) {
      setReasonError("Give a reason (at least 3 characters)");
      return;
    }
    setBusy("reject");
    setError(null);
    try {
      const next: Detail =
        detail.kind === "agency" ? { kind: "agency", data: await adminApi.rejectAgency(id, r) } : { kind: "driver", data: await adminApi.rejectDriver(id, r) };
      onDecided(next);
      setRejectOpen(false);
      setReason("");
      toast({ tone: "info", title: "Marked as rejected", description: "They've been notified with your reason." });
    } catch (e) {
      setReasonError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card as="section" aria-labelledby="decision-title" className="h-fit lg:sticky lg:top-6">
      <h2 id="decision-title" className="type-h3 text-ink">
        Decision
      </h2>
      <dl className="mt-3 flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-caption text-ink-subtle">Submitted</dt>
          <dd className="font-medium text-ink">{v.submittedAt ? formatInstantDate(v.submittedAt) : "Not yet — documents incomplete"}</dd>
        </div>
        {v.reviewedAt ? (
          <div>
            <dt className="text-caption text-ink-subtle">Last reviewed</dt>
            <dd className="font-medium text-ink">{formatInstantDate(v.reviewedAt)}</dd>
          </div>
        ) : null}
        {v.status === "rejected" && v.reason ? (
          <div>
            <dt className="text-caption text-ink-subtle">Reason given</dt>
            <dd className="font-medium text-error">{v.reason}</dd>
          </div>
        ) : null}
      </dl>
      {!detail.data.documentsComplete ? (
        <p className="mt-3 rounded-md bg-warning-100 px-3 py-2 text-sm text-warning-700">
          The {noun} hasn&apos;t uploaded every document and photo yet, so it can&apos;t be verified.
        </p>
      ) : null}
      <FormAlert className="mt-3">{error}</FormAlert>
      <div className="mt-4 flex flex-col gap-3">
        <Button
          fullWidth
          onClick={() => void verify()}
          loading={busy === "verify"}
          disabled={busy !== null || !detail.data.documentsComplete || v.status === "verified"}
          leadingIcon={<CircleCheck className="size-5" />}
        >
          {v.status === "verified" ? "Verified" : busy === "verify" ? "Verifying…" : `Verify ${noun}`}
        </Button>
        <Button
          variant="outline"
          fullWidth
          onClick={() => {
            setReasonError(null);
            setRejectOpen(true);
          }}
          disabled={busy !== null}
          leadingIcon={<CircleX className="size-5" />}
        >
          {v.status === "rejected" ? "Update rejection" : "Reject…"}
        </Button>
      </div>

      <Modal
        open={rejectOpen}
        onClose={() => (busy ? undefined : setRejectOpen(false))}
        title={`Reject ${noun}`}
        description="Explain what needs fixing. The reason is shown to them."
        size="sm"
        hideClose={busy !== null}
      >
        <form
          noValidate
          className="flex flex-col gap-4 pb-1"
          onSubmit={(e) => {
            e.preventDefault();
            void reject();
          }}
        >
          <FormField label="Reason" htmlFor="reject-reason" error={reasonError ?? undefined} required>
            <Textarea
              id="reject-reason"
              rows={4}
              maxLength={300}
              value={reason}
              autoFocus
              placeholder="e.g. The Aadhaar photo is blurred. Upload a clearer picture."
              onChange={(e) => {
                setReasonError(null);
                setReason(e.target.value);
              }}
            />
          </FormField>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setRejectOpen(false)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={busy === "reject"}>
              {busy === "reject" ? "Saving…" : "Reject"}
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
