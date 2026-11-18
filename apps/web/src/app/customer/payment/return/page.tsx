import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentReturnView } from "@/features/payment/PaymentReturnView";

export const metadata: Metadata = { title: "Confirming payment", robots: { index: false } };

/** Gateway return URL: polls the server-verified payment status. */
export default function PaymentReturnPage() {
  return (
    <Suspense fallback={null}>
      <PaymentReturnView />
    </Suspense>
  );
}
