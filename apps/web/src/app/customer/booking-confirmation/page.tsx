import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingConfirmationView, ConfirmationSkeleton } from "@/features/payment/BookingConfirmationView";

export const metadata: Metadata = {
  title: "Booking placed",
  description: "Your payment is received and your booking is confirmed.",
};

/** Post-payment confirmation. Reads `?bookingId` in the client view. */
export default function BookingConfirmationPage() {
  return (
    <Suspense fallback={<ConfirmationSkeleton />}>
      <BookingConfirmationView />
    </Suspense>
  );
}
