"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, EmptyState, Spinner } from "@/components/ui";
import { paths } from "@/lib/config/routes";
import { LoadError } from "@/features/customer-shipment/LoadError";
import { isNotFound, useApi, usePolling } from "@/features/customer-shipment/use-api";
import { withParams } from "@/features/customer-shipment/urls";
import { paymentsApi } from "./payments-api";

const POLL_MS = 2500;

/**
 * `/customer/payment/return?paymentId=…` — where the gateway sends the customer back.
 * Never shows success on its own: GET /api/payments/[id] asks the provider, and we wait
 * ("Confirming payment…") until the server reports a final status.
 */
export function PaymentReturnView() {
  const paymentId = useSearchParams().get("paymentId") ?? "";
  const router = useRouter();
  const status = useApi(paymentId ? `payment:${paymentId}` : null, (signal) => paymentsApi.status(paymentId, signal));
  const s = status.data?.status;
  const pending = s === "created" || s === "pending";
  usePolling(status.reload, POLL_MS, pending);

  useEffect(() => {
    if (!status.data || pending) return;
    const { bookingId } = status.data;
    if (s === "succeeded") router.replace(paths.customer.confirmation(bookingId));
    else router.replace(withParams(paths.customer.payment(bookingId), { failed: "1" }));
  }, [status.data, pending, s, router]);

  const header = <PageHeader title="Payment" />;
  if (!paymentId || isNotFound(status.error)) {
    return (
      <>
        {header}
        <EmptyState title="Payment not found" description="Open your booking to check its payment status." action={{ label: "My Shipments", href: paths.customer.shipments }} />
      </>
    );
  }
  if (status.error && !status.data) {
    return (
      <>
        {header}
        <LoadError error={status.error} title="We couldn't check your payment" onRetry={() => void status.reload()} />
      </>
    );
  }
  return (
    <>
      {header}
      <Card as="section" padding="lg" className="mx-auto flex max-w-[560px] flex-col items-center gap-4 text-center" aria-busy="true">
        <Spinner />
        <p role="status" className="type-h3 text-ink">
          Confirming payment…
        </p>
        <p className="text-sm text-ink-muted">We&apos;re checking with the payment provider. Please don&apos;t close this page.</p>
      </Card>
    </>
  );
}
