import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingRequestsView } from "@/features/driver-requests/BookingRequestsView";

export const metadata: Metadata = { title: "Booking Requests" };

/** Screen 14. The view reads `?tab=` via useSearchParams, so it renders inside Suspense. */
export default function BookingRequestsPage() {
  return (
    <Suspense fallback={null}>
      <BookingRequestsView />
    </Suspense>
  );
}
