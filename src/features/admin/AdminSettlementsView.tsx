"use client";

import { useState } from "react";
import { Banknote, CircleCheck, Clock3 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, Card, DataList, EmptyState, FormField, Input, Modal, useToast } from "@/components/ui";
import type { AdminSettlementRowDTO } from "@/lib/api/contracts/admin";
import { adminApi } from "@/lib/api/client/admin";
import { errorMessage, isApiError } from "@/lib/api/http";
import { formatINR, formatInstantDate } from "@/lib/format";
import { FormAlert } from "@/features/auth/AuthBits";
import { ListSkeleton, LoadError, useLoad } from "./AdminBits";

/** Today's date in IST (YYYY-MM-DD). */
function todayIst(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * /admin/settlements — read-only settlements (plan decision 11): agencies with pending earnings; "Mark settled"
 * records a payout reference (UTR) and settles earnings delivered up to a date. No money moves here.
 */
export function AdminSettlementsView() {
  const { state, reload } = useLoad(() => adminApi.settlements(), "settlements");
  const [target, setTarget] = useState<AdminSettlementRowDTO | null>(null);

  return (
    <>
      <PageHeader title="Settlements" subtitle="Record payouts made to agencies. This marks their earnings as settled." />
      {state.status === "loading" ? (
        <ListSkeleton rows={3} label="Loading settlements" />
      ) : state.status === "error" ? (
        <LoadError message={state.message} onRetry={reload} />
      ) : !state.data.available ? (
        <EmptyState icon={<Clock3 className="size-6" />} title="Settlements aren't available yet" description="Earnings tracking is still being set up. Check back later." />
      ) : (
        <DataList
          label="Agencies with pending earnings"
          rows={state.data.items}
          rowKey={(r) => r.agencyId}
          empty={<EmptyState icon={<CircleCheck className="size-6" />} title="Everything is settled" description="No agency has pending earnings." />}
          columns={[
            { id: "agency", header: "Agency", cell: (r) => <span className="font-semibold text-ink">{r.agencyName}</span> },
            { id: "amount", header: "Pending", align: "right", cell: (r) => <span className="tabular-nums">{formatINR(r.pendingAmount)}</span> },
            { id: "count", header: "Bookings", align: "right", cell: (r) => <span className="tabular-nums">{r.pendingCount}</span> },
            { id: "oldest", header: "Oldest delivery", cell: (r) => formatInstantDate(r.oldestDeliveredAt) },
            {
              id: "action",
              header: "Action",
              hideHeader: true,
              align: "right",
              cell: (r) => (
                <Button size="sm" variant="secondary" onClick={() => setTarget(r)}>
                  Mark settled<span className="sr-only"> for {r.agencyName}</span>
                </Button>
              ),
            },
          ]}
          renderMobile={(r) => (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 font-semibold text-ink">{r.agencyName}</p>
                <p className="shrink-0 font-heading font-bold tabular-nums text-ink">{formatINR(r.pendingAmount)}</p>
              </div>
              <p className="text-sm text-ink-muted">
                {r.pendingCount} {r.pendingCount === 1 ? "booking" : "bookings"} · oldest {formatInstantDate(r.oldestDeliveredAt)}
              </p>
              <Button size="sm" variant="secondary" onClick={() => setTarget(r)} className="self-start">
                Mark settled<span className="sr-only"> for {r.agencyName}</span>
              </Button>
            </div>
          )}
        />
      )}
      <SettleDialog
        row={target}
        onClose={() => setTarget(null)}
        onDone={() => {
          setTarget(null);
          reload();
        }}
      />
    </>
  );
}

function SettleDialog({ row, onClose, onDone }: { row: AdminSettlementRowDTO | null; onClose(): void; onDone(): void }) {
  return (
    <Modal open={!!row} onClose={onClose} title="Mark earnings settled" description={row ? `${row.agencyName} · ${formatINR(row.pendingAmount)} pending` : undefined} size="sm">
      {row ? <SettleForm row={row} onCancel={onClose} onDone={onDone} /> : null}
    </Modal>
  );
}

function SettleForm({ row, onCancel, onDone }: { row: AdminSettlementRowDTO; onCancel(): void; onDone(): void }) {
  const { toast } = useToast();
  const [through, setThrough] = useState(todayIst());
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const next: Record<string, string> = {};
    if (!through) next.through = "Choose a date";
    if (reference.trim().length < 4) next.reference = "Enter the bank reference (UTR)";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setServiceError(null);
    try {
      const r = await adminApi.settle({ agencyId: row.agencyId, through, reference: reference.trim() });
      toast({ tone: "success", title: "Settlement recorded", description: `${formatINR(r.amount)} for ${r.count} ${r.count === 1 ? "booking" : "bookings"}.` });
      onDone();
    } catch (e) {
      if (isApiError(e) && e.fields) setErrors(e.fields);
      setServiceError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4 pb-1"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <FormField label="Settle deliveries up to" htmlFor="settle-through" error={errors.through} required>
        <Input id="settle-through" type="date" value={through} max={todayIst()} onChange={(e) => setThrough(e.target.value)} />
      </FormField>
      <FormField label="Bank reference (UTR)" htmlFor="settle-reference" error={errors.reference} hint="The transfer reference from your bank statement." required>
        <Input
          id="settle-reference"
          value={reference}
          autoComplete="off"
          spellCheck={false}
          leadingIcon={<Banknote strokeWidth={1.75} />}
          onChange={(e) => setReference(e.target.value.toUpperCase())}
        />
      </FormField>
      <Card tone="muted" padding="sm">
        <p className="text-sm text-ink-muted">Record this only after the money has been sent. It can&apos;t be undone from here.</p>
      </Card>
      <FormAlert>{serviceError}</FormAlert>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          {busy ? "Saving…" : "Mark settled"}
        </Button>
      </div>
    </form>
  );
}
