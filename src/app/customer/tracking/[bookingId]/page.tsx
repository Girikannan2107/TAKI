import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { TrackingSkeleton, TrackingView } from "@/features/tracking/TrackingView";

export const metadata: Metadata = {
  title: "Track Shipment",
  description: "Follow your shipment's status from booking to delivery.",
};

/** Screen 10. The `[bookingId]` segment is read in the client view with useParams(). */
export default function TrackShipmentPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Track Shipment" />
          <TrackingSkeleton />
        </>
      }
    >
      <TrackingView />
    </Suspense>
  );
}
