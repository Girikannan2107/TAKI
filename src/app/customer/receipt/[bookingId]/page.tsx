import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmationSkeleton } from "@/features/payment/BookingConfirmationView";
import { ReceiptView } from "@/features/payment/ReceiptView";

export const metadata: Metadata = {
  title: "Receipt",
  description: "Delivery receipt with the price breakdown and payment details.",
};

/** Delivery receipt. The `[bookingId]` segment is read in the client view with useParams(). */
export default function ReceiptPage() {
  return (
    <Suspense fallback={<ConfirmationSkeleton />}>
      <ReceiptView />
    </Suspense>
  );
}
