import type { Metadata } from "next";
import { Suspense } from "react";
import { DevGatewayView } from "@/features/payment/DevGatewayView";

export const metadata: Metadata = { title: "Test payment gateway", robots: { index: false } };

/** Dev-only gateway (the server refuses to confirm unless PAYMENT_PROVIDER=dev outside production). */
export default function DevGatewayPage() {
  return (
    <Suspense fallback={null}>
      <DevGatewayView />
    </Suspense>
  );
}
