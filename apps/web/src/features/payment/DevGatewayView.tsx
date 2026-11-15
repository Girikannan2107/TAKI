"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Check, FlaskConical, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { formatINR } from "@/lib/format";
import { LoadError } from "@/features/customer-shipment/LoadError";
import { isNotFound, useApi } from "@/features/customer-shipment/use-api";
import { withParams } from "@/features/customer-shipment/urls";
import { PaymentMethodSelector, type PaymentMethod } from "./PaymentMethodSelector";
import { paymentsApi } from "@/lib/api/client/payments";

/**
 * Development payment gateway (`PAYMENT_PROVIDER=dev` only; the server returns 404 otherwise).
 * Nothing succeeds on its own: the payment is confirmed only when you press Approve, which
 * calls POST /api/payments/dev/confirm with the signed token from the checkout URL.
 */
export function DevGatewayView() {
  const params = useSearchParams();
  const router = useRouter();
  const paymentId = params.get("paymentId") ?? "";
  const token = params.get("token") ?? "";
  const status = useApi(paymentId ? `payment:${paymentId}` : null, (signal) => paymentsApi.status(paymentId, signal));
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [busy, setBusy] = useState<"success" | "failure" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const header = <PageHeader title="Test payment gateway" />;

  if (!paymentId || !token || isNotFound(status.error)) {
    return (
      <>
        {header}
        <EmptyState title="Payment link not valid" description="Start the payment again from your booking." action={{ label: "My Shipments", href: paths.customer.shipments }} />
      </>
    );
  }
  if (status.loading) {
    return (
      <>
        {header}
        <Skeleton className="mx-auto h-96 max-w-[560px] rounded-lg" />
      </>
    );
  }
  if (status.error || !status.data) {
    return (
      <>
        {header}
        <LoadError error={status.error} title="We couldn't load this payment" onRetry={() => void status.reload()} />
      </>
    );
  }
  const p = status.data;
  const open = p.status === "created" || p.status === "pending";

  async function decide(outcome: "success" | "failure") {
    setBusy(outcome);
    setError(null);
    try {
      const r = await paymentsApi.devConfirm({ paymentId, outcome, devToken: token });
      router.replace(r.status === "succeeded" ? paths.customer.confirmation(r.bookingId) : withParams(paths.customer.payment(r.bookingId), { failed: "1" }));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <>
      {header}
      <Card as="section" aria-labelledby="gw-heading" padding="lg" className="mx-auto w-full max-w-[560px]">
        <p className="flex items-center gap-2 rounded-md bg-warning-100 px-3 py-2 text-sm font-medium text-warning-700">
          <FlaskConical aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
          Development gateway: no money moves. Approve or decline to test both paths.
        </p>
        <h2 id="gw-heading" className="mt-5 text-sm text-ink-muted">
          Amount for booking <span className="font-semibold tabular-nums text-ink">{p.bookingId}</span>
        </h2>
        <p className="type-amount-lg text-price">{formatINR(p.amountRupees)}</p>
        {open ? (
          <>
            <PaymentMethodSelector value={method} onChange={setMethod} disabled={busy !== null} className="mt-6" />
            <div role="alert" aria-live="assertive" className="empty:hidden">
              {error ? <p className="mt-4 text-sm text-error">{error}</p> : null}
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
              <Button size="lg" fullWidth loading={busy === "success"} disabled={busy !== null} onClick={() => decide("success")} leadingIcon={<Check strokeWidth={2} />}>
                {busy === "success" ? "Approving…" : "Approve payment"}
              </Button>
              <Button size="lg" variant="outline" fullWidth loading={busy === "failure"} disabled={busy !== null} onClick={() => decide("failure")} leadingIcon={<X strokeWidth={2} />}>
                Decline
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-6">
            <p className="text-sm text-ink-muted">This payment is already {p.status.replace("_", " ")}.</p>
            <Button className="mt-4" onClick={() => router.replace(p.status === "succeeded" ? paths.customer.confirmation(p.bookingId) : paths.customer.tracking(p.bookingId))}>
              Continue
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
