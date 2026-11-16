"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, Card, EmptyState, Spinner } from "@/components/ui";
import type { PaymentStatusResponse } from "@/lib/api/contracts/payments";
import { paths } from "@/lib/config/routes";
import { LoadError } from "@/features/customer-shipment/LoadError";
import { isNotFound, useApi, usePolling } from "@/features/customer-shipment/use-api";
import { withParams } from "@/features/customer-shipment/urls";
import { paymentsApi } from "@/lib/api/client/payments";

const POLL_MS = 3000;
const POLL_FOR_MS = 60_000;

/** Paid only when the payment succeeded AND the booking's payment state says paid (contract §9). */
function isPaid(p: PaymentStatusResponse): boolean {
  return p.status === "succeeded" && (!p.bookingState || p.bookingState.paymentStatus === "paid");
}

function isOpen(p: PaymentStatusResponse): boolean {
  return p.status === "created" || p.status === "pending" || (p.status === "succeeded" && !isPaid(p));
}

/**
 * `/customer/payment/return?paymentId=…` — where Cashfree sends the customer back.
 * Never shows success on its own: it first asks the API to verify with Cashfree (E44 POST …/verify), then
 * polls the stored status (E43) every 3 s for up to 60 s until the server reports a final state.
 */
export function PaymentReturnView() {
  const paymentId = useSearchParams().get("paymentId") ?? "";
  const router = useRouter();
  const [startedAt] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(startedAt);
  const verified = useRef(false);
  const status = useApi(paymentId ? `payment:${paymentId}` : null, (signal) => paymentsApi.status(paymentId, signal));

  // One explicit verify per visit; its result arrives through the next poll. Gateway errors are not fatal:
  // the webhook or the sweep still confirms, and the stored status keeps being polled.
  useEffect(() => {
    if (!paymentId || verified.current) return;
    verified.current = true;
    void paymentsApi
      .verify(paymentId)
      .catch(() => undefined)
      .finally(() => void status.reload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId]);

  const p = status.data;
  const pending = !!p && isOpen(p);
  const timedOut = pending && nowMs - startedAt > POLL_FOR_MS;
  usePolling(
    async () => {
      setNowMs(Date.now());
      await status.reload();
    },
    POLL_MS,
    pending && !timedOut,
  );

  useEffect(() => {
    if (!p || isOpen(p)) return;
    if (isPaid(p)) router.replace(paths.customer.confirmation(p.bookingId));
    else router.replace(withParams(paths.customer.payment(p.bookingId), { failed: "1" }));
  }, [p, router]);

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
  if (timedOut && p) {
    return (
      <>
        {header}
        <Card as="section" padding="lg" className="mx-auto flex max-w-[560px] flex-col items-center gap-4 text-center">
          <p role="status" className="type-h3 text-ink">
            Still waiting for the payment provider
          </p>
          <p className="text-sm text-ink-muted">
            If money left your account, your booking will be confirmed automatically once Cashfree reports it. You don&apos;t need to pay again.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button
              onClick={() => {
                setNowMs(Date.now());
                void status.reload();
              }}
            >
              Check again
            </Button>
            <Button variant="ghost" onClick={() => router.replace(paths.customer.tracking(p.bookingId))}>
              View booking
            </Button>
          </div>
        </Card>
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
