import type { Metadata } from "next";
import { Suspense } from "react";
import { NewShipmentView } from "@/features/customer-search/NewShipmentView";

export const metadata: Metadata = {
  title: "New Shipment",
  description: "Enter pickup, delivery, receiver and package details to find vehicles travelling your way.",
};

/** Reads `?from&to&weight&date&cargo&handling` (prefill), `?edit=<shipmentId>` and `?trip=<tripId>` in the client view. */
export default function NewShipmentPage() {
  return (
    <Suspense fallback={null}>
      <NewShipmentView />
    </Suspense>
  );
}
