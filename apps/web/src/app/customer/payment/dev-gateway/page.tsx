import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DevGatewayView } from "@/features/payment/DevGatewayView";

export const metadata: Metadata = { title: "Test payment gateway", robots: { index: false } };

/**
 * Local / e2e TEST gateway only: the page exists only in builds with NEXT_PUBLIC_ENABLE_DEV_GATEWAY=true (never
 * staging or production), and the API refuses to confirm unless PAYMENT_PROVIDER=dev in development / test.
 */
export default function DevGatewayPage() {
  if (process.env.NEXT_PUBLIC_ENABLE_DEV_GATEWAY !== "true") notFound();
  return (
    <Suspense fallback={null}>
      <DevGatewayView />
    </Suspense>
  );
}
