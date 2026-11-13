import type { Metadata } from "next";
import { VehiclesView } from "@/features/agency/VehiclesView";

export const metadata: Metadata = { title: "Vehicles" };

export default function AgencyVehiclesPage() {
  return <VehiclesView />;
}
