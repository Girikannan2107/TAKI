"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, Clock3, ExternalLink, FileUp, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, FileUpload, FormField, Input, Select, useToast, type BadgeTone, type FileUploadValue } from "@/components/ui";
import {
  DOCUMENT_KINDS_FOR,
  DOCUMENT_LABELS,
  type DocumentDTO,
  type DocumentStatus,
  type DocumentUploadResultDTO,
} from "@/lib/api/contracts/auth";
import { accountApi } from "@/lib/api/client/auth";
import { errorMessage, isApiError } from "@/lib/api/http";
import type { IdentityDocumentKind, VerificationStatus } from "@/lib/domain/model";
import { formatInstantDate } from "@/lib/format";
import { FormAlert } from "@/features/auth/AuthBits";

export const DOCUMENT_STATUS: Record<DocumentStatus, { label: string; tone: BadgeTone }> = {
  missing: { label: "Not uploaded", tone: "attention" },
  pending: { label: "Under review", tone: "warning" },
  verified: { label: "Verified", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};

const NUMBER_HINT: Record<IdentityDocumentKind, string> = {
  aadhaar: "12 digits. Only the last 4 are shown after upload.",
  pan: "10 characters, e.g. ABCDE1234F.",
  driving_license: "10–20 letters and digits, as printed on the licence.",
};

export interface DocumentsCardProps {
  role: "agency" | "driver";
  documents: DocumentDTO[];
  /** Called after each successful upload (refresh the profile / verification status). */
  onUploaded?(result: DocumentUploadResultDTO): void;
  className?: string;
}

/**
 * Identity documents with MASKED numbers only (P2 §4.3): agency = one of Aadhaar / PAN / driving licence;
 * driver = driving licence + Aadhaar. Files open through the access-checked /api/files route.
 */
export function DocumentsCard({ role, documents, onUploaded, className }: DocumentsCardProps) {
  const rows: Array<{ kind: IdentityDocumentKind | null; doc: DocumentDTO | null }> =
    role === "driver"
      ? DOCUMENT_KINDS_FOR.driver.map((k) => ({ kind: k, doc: documents.find((d) => d.kind === k) ?? null }))
      : [{ kind: documents[0]?.kind ?? null, doc: documents[0] ?? null }];

  return (
    <Card as="section" aria-labelledby="documents-title" className={className}>
      <div className="mb-4 flex items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mint-100 text-green-700">
          <ShieldCheck strokeWidth={1.75} className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="documents-title" className="type-h3 text-ink">
            {role === "agency" ? "Identity document" : "Documents"}
          </h2>
          <p className="text-sm text-ink-muted">
            {role === "agency"
              ? "Upload one: Aadhaar, PAN card or driving licence of the owner."
              : "Upload your driving licence and Aadhaar. TAKI checks them before you can drive trips."}
          </p>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((r, i) => (
          <li key={r.kind ?? `slot-${i}`} className="py-4 first:pt-0 last:pb-0">
            <DocumentRow role={role} fixedKind={role === "driver" ? r.kind : null} doc={r.doc} onUploaded={onUploaded} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DocumentRow({
  role,
  fixedKind,
  doc,
  onUploaded,
}: {
  role: "agency" | "driver";
  fixedKind: IdentityDocumentKind | null;
  doc: DocumentDTO | null;
  onUploaded?(r: DocumentUploadResultDTO): void;
}) {
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState<DocumentDTO | null>(doc);
  const status = DOCUMENT_STATUS[current?.status ?? "missing"];
  const title = current ? current.label : fixedKind ? DOCUMENT_LABELS[fixedKind] : "Identity document";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{title}</p>
          {current?.numberMasked ? (
            <p className="mt-0.5 font-mono text-sm tabular-nums text-ink-muted" aria-label={`Number ending ${current.numberMasked.slice(-4)}`}>
              {current.numberMasked}
            </p>
          ) : null}
          {current?.uploadedAt ? <p className="text-caption text-ink-subtle">Uploaded {formatInstantDate(current.uploadedAt)}</p> : null}
        </div>
        <Badge tone={status.tone} icon={<StatusIcon status={current?.status ?? "missing"} />}>
          {status.label}
        </Badge>
      </div>

      {current?.fileUrl || current?.backFileUrl ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {current.fileUrl ? <FileLink href={current.fileUrl} label={`View ${title}${current.backFileUrl ? " (front)" : ""}`} /> : null}
          {current.backFileUrl ? <FileLink href={current.backFileUrl} label={`View ${title} (back)`} /> : null}
        </div>
      ) : null}

      {editing ? (
        <DocumentForm
          role={role}
          fixedKind={fixedKind}
          initialKind={current?.kind ?? null}
          onCancel={() => setEditing(false)}
          onDone={(r) => {
            setCurrent(r.document);
            setEditing(false);
            onUploaded?.(r);
          }}
        />
      ) : current?.status !== "verified" || role === "agency" ? (
        <div>
          <Button variant={current ? "ghost" : "secondary"} size="sm" leadingIcon={<FileUp className="size-4" />} onClick={() => setEditing(true)}>
            {current ? "Replace document" : "Upload document"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StatusIcon({ status }: { status: DocumentStatus }) {
  const cls = "size-3.5";
  if (status === "verified") return <CircleCheck aria-hidden="true" className={cls} />;
  if (status === "pending") return <Clock3 aria-hidden="true" className={cls} />;
  return <CircleAlert aria-hidden="true" className={cls} />;
}

function FileLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-1 font-semibold text-green-700 underline-offset-4 hover:underline"
    >
      {label}
      <ExternalLink aria-hidden="true" className="size-3.5" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function staged(file: File | null): FileUploadValue | null {
  return file ? { name: file.name, status: "selected", sizeBytes: file.size } : null;
}

function DocumentForm({
  role,
  fixedKind,
  initialKind,
  onCancel,
  onDone,
}: {
  role: "agency" | "driver";
  fixedKind: IdentityDocumentKind | null;
  initialKind: IdentityDocumentKind | null;
  onCancel(): void;
  onDone(r: DocumentUploadResultDTO): void;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<IdentityDocumentKind | "">(fixedKind ?? initialKind ?? "");
  const [number, setNumber] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasBack = kind === "aadhaar" || kind === "driving_license";
  const idBase = `doc-${fixedKind ?? "agency"}`;

  async function submit() {
    const next: Record<string, string> = {};
    if (!kind) next.kind = "Choose a document type";
    if (number.trim().length < 8) next.number = "Enter the document number";
    if (!front) next.file = "Upload a photo or PDF of the document";
    setErrors(next);
    if (Object.keys(next).length || !kind || !front) return;
    setBusy(true);
    setServiceError(null);
    try {
      const r = await accountApi.uploadDocument(kind, { number, file: front, backFile: back, validUntil: kind === "driving_license" && validUntil ? validUntil : undefined });
      toast({ tone: "success", title: `${DOCUMENT_LABELS[kind]} uploaded`, description: r.verification === "pending" ? "TAKI will review it shortly." : undefined });
      onDone(r);
    } catch (e) {
      if (isApiError(e) && e.fields) {
        setErrors((prev) => ({ ...prev, ...e.fields }));
        if (!e.fields.number && !e.fields.file) setServiceError(e.message);
      } else {
        setServiceError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4 rounded-md border border-border bg-surface-muted/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {role === "agency" && !fixedKind ? (
        <FormField label="Document type" htmlFor={`${idBase}-kind`} error={errors.kind} required>
          <Select
            id={`${idBase}-kind`}
            placeholder="Choose a document"
            value={kind}
            onChange={(e) => setKind(e.target.value as IdentityDocumentKind)}
            options={DOCUMENT_KINDS_FOR.agency.map((k) => ({ value: k, label: DOCUMENT_LABELS[k] }))}
          />
        </FormField>
      ) : null}
      <FormField label="Document number" htmlFor={`${idBase}-number`} error={errors.number} hint={kind ? NUMBER_HINT[kind] : undefined} required>
        <Input
          id={`${idBase}-number`}
          value={number}
          autoComplete="off"
          spellCheck={false}
          inputMode={kind === "aadhaar" ? "numeric" : "text"}
          onChange={(e) => setNumber(e.target.value.toUpperCase())}
        />
      </FormField>
      {kind === "driving_license" ? (
        <FormField label="Valid until" htmlFor={`${idBase}-valid`} optionalLabel>
          <Input id={`${idBase}-valid`} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </FormField>
      ) : null}
      <FileUpload
        label={hasBack ? "Front side" : "Document"}
        kind="document"
        capture="environment"
        value={staged(front)}
        onSelect={setFront}
        onRemove={() => setFront(null)}
        error={errors.file}
        required
      />
      {hasBack ? (
        <FileUpload label="Back side (optional)" kind="document" capture="environment" value={staged(back)} onSelect={setBack} onRemove={() => setBack(null)} error={errors.backFile} />
      ) : null}
      <FormAlert>{serviceError}</FormAlert>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          {busy ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </form>
  );
}

/** Small status line for verification state (agency or driver). */
export function verificationCopy(status: VerificationStatus, submitted: boolean): { title: string; body: string; tone: BadgeTone } {
  if (status === "verified") return { title: "Verified", body: "Your documents have been checked by TAKI.", tone: "success" };
  if (status === "rejected") return { title: "Needs attention", body: "Update your documents and photo, then they'll be reviewed again.", tone: "danger" };
  if (submitted) return { title: "Under review", body: "TAKI is checking your documents. This usually takes one working day.", tone: "warning" };
  return { title: "Documents needed", body: "Upload your photo and documents to get verified.", tone: "attention" };
}
