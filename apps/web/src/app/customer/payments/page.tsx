import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentsView } from "@/features/payments/PaymentsView";

export const metadata: Metadata = {
  title: "Payments",
  description: "Your payment history and refunds.",
};

export default function PaymentsPage() {
  return (
    <Suspense fallback={null}>
      <PaymentsView />
    </Suspense>
  );
}
