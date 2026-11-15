import type { Metadata } from "next";
import { VehicleFormView } from "@/features/agency/VehicleFormView";

export const metadata: Metadata = { title: "Add vehicle" };

export default function NewVehiclePage() {
  return <VehicleFormView />;
}
