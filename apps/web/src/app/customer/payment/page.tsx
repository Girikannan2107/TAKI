import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PaymentSkeleton, PaymentView } from "@/features/payment/PaymentView";

export const metadata: Metadata = {
  title: "Payment",
  description: "Choose a payment method and pay for your booking (demo — no money moves).",
};

/** Screen 09. Reads `?bookingId` in the client view. */
export default function PaymentPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Payment" />
          <PaymentSkeleton />
        </>
      }
    >
      <PaymentView />
    </Suspense>
  );
}
