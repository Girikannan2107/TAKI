"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleCheck, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Button, DataList, EmptyState, FormField, Select, useToast, type BadgeTone } from "@/components/ui";
import { ADMIN_PAYMENT_STATUSES, type AdminPaymentRowDTO, type AdminPaymentStatus } from "@/lib/api/contracts/admin";
import { adminApi } from "@/lib/api/client/admin";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { formatINR, formatInstantDate } from "@/lib/format";
import { ListSkeleton, LoadError, useLoad } from "./AdminBits";

export const PAYMENT_STATUS_LABEL: Record<AdminPaymentStatus, { label: string; tone: BadgeTone }> = {
  created: { label: "Created", tone: "neutral" },
  pending: { label: "Pending", tone: "warning" },
  succeeded: { label: "Paid", tone: "paid" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  refund_pending: { label: "Refund pending", tone: "attention" },
  refunded: { label: "Refunded", tone: "info" },
  refund_failed: { label: "Refund failed", tone: "danger" },
};

function isStatus(v: string | null): v is AdminPaymentStatus {
  return !!v && (ADMIN_PAYMENT_STATUSES as readonly string[]).includes(v);
}

/**
 * /admin/payments?status= (M7): payments by status (E127), default "refund failed" — the rows that need a
 * person. Shows the last Cashfree order status seen and the refund state; "Retry refund" (E128) re-queues a
 * failed refund with the same refund id, so Cashfree never pays twice.
 */
export function AdminPaymentsView() {
  const params = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const raw = params.get("status");
  const status: AdminPaymentStatus = isStatus(raw) ? raw : "refund_failed";
  const { state, reload, set } = useLoad(() => adminApi.payments({ status, limit: 50 }), `payments:${status}`);
  const [more, setMore] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  async function loadMore() {
    if (state.status !== "ready" || !state.data.nextCursor) return;
    setMore(true);
    try {
      const page = await adminApi.payments({ status, cursor: state.data.nextCursor, limit: 50 });
      set({ items: [...state.data.items, ...page.items], nextCursor: page.nextCursor });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't load more payments", description: errorMessage(e) });
    } finally {
      setMore(false);
    }
  }

  async function retry(row: AdminPaymentRowDTO) {
    setRetrying(row.id);
    try {
      await adminApi.retryRefund(row.id);
      toast({ tone: "success", title: "Refund queued again", description: `Payment ${row.id} for booking ${row.bookingId}.` });
      reload();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't retry the refund", description: errorMessage(e) });
    } finally {
      setRetrying(null);
    }
  }

  return (
    <>
      <PageHeader title="Payments" subtitle="Payment attempts and refunds. Retry a refund that Cashfree rejected." />
      <div className="mb-5 max-w-xs">
        <FormField label="Status" htmlFor="payment-status">
          <Select
            id="payment-status"
            options={ADMIN_PAYMENT_STATUSES.map((s) => ({ value: s, label: PAYMENT_STATUS_LABEL[s].label }))}
            value={status}
            onChange={(e) => router.replace(paths.admin.payments(e.target.value))}
          />
        </FormField>
      </div>
      {state.status === "loading" ? (
        <ListSkeleton rows={4} label="Loading payments" />
      ) : state.status === "error" ? (
        <LoadError message={state.message} onRetry={reload} />
      ) : (
        <>
          <DataList
            label={`Payments: ${PAYMENT_STATUS_LABEL[status].label}`}
            rows={state.data.items}
            rowKey={(r) => r.id}
            empty={<EmptyState icon={<CircleCheck className="size-6" />} title="Nothing here" description={`No payments are ${PAYMENT_STATUS_LABEL[status].label.toLowerCase()}.`} />}
            columns={[
              {
                id: "booking",
                header: "Booking",
                cell: (r) => (
                  <Link href={paths.admin.booking(r.bookingId)} className="font-semibold tabular-nums text-green-700 underline-offset-4 hover:underline">
                    {r.bookingId}
                  </Link>
                ),
              },
              { id: "payment", header: "Payment", cell: (r) => <span className="tabular-nums text-ink-muted">{r.id}</span> },
              { id: "amount", header: "Amount", align: "right", cell: (r) => <span className="tabular-nums">{formatINR(r.amountRupees)}</span> },
              { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
              { id: "gateway", header: "Cashfree", cell: (r) => r.cfOrderStatus ?? "—" },
              { id: "refund", header: "Refund", cell: (r) => refundText(r) },
              { id: "updated", header: "Updated", cell: (r) => formatInstantDate(r.updatedAt) },
              {
                id: "action",
                header: "Action",
                hideHeader: true,
                align: "right",
                cell: (r) => (r.status === "refund_failed" ? <RetryButton row={r} busy={retrying === r.id} onRetry={retry} /> : null),
              },
            ]}
            renderMobile={(r) => (
              <div className="flex flex-col gap-1.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Link href={paths.admin.booking(r.bookingId)} className="font-semibold tabular-nums text-green-700">
                    {r.bookingId}
                  </Link>
                  <StatusBadge status={r.status} />
                </div>
                <p className="tabular-nums text-ink">{formatINR(r.amountRupees)}</p>
                <p className="text-ink-muted">
                  Cashfree: {r.cfOrderStatus ?? "—"} · Refund: {refundText(r)}
                </p>
                {r.failureReason ? <p className="text-error">{r.failureReason}</p> : null}
                {r.status === "refund_failed" ? <RetryButton row={r} busy={retrying === r.id} onRetry={retry} /> : null}
              </div>
            )}
          />
          {state.data.nextCursor ? (
            <Button variant="ghost" className="mt-4" loading={more} onClick={() => void loadMore()}>
              Load more
            </Button>
          ) : null}
        </>
      )}
    </>
  );
}

export function StatusBadge({ status }: { status: AdminPaymentStatus }) {
  const s = PAYMENT_STATUS_LABEL[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function refundText(r: Pick<AdminPaymentRowDTO, "refund">): string {
  if (!r.refund) return "—";
  const st = typeof r.refund.status === "string" ? r.refund.status : "unknown";
  const amount = typeof r.refund.amountRupees === "number" ? ` · ${formatINR(r.refund.amountRupees)}` : "";
  return `${st.replace(/_/g, " ")}${amount}`;
}

function RetryButton({ row, busy, onRetry }: { row: AdminPaymentRowDTO; busy: boolean; onRetry(r: AdminPaymentRowDTO): void }) {
  return (
    <Button size="sm" variant="secondary" loading={busy} leadingIcon={<RotateCcw className="size-4" />} onClick={() => onRetry(row)}>
      Retry refund<span className="sr-only"> for {row.bookingId}</span>
    </Button>
  );
}
