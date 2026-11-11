import type { Metadata } from "next";
import { Suspense } from "react";
import { VehiclesView } from "@/features/customer-search/VehiclesView";

export const metadata: Metadata = {
  title: "Available Vehicles",
  description: "Compare vehicles travelling your route, with prices that include the TAKI service fee.",
};

export default function AvailableVehiclesPage() {
  return (
    <Suspense fallback={null}>
      <VehiclesView />
    </Suspense>
  );
}
