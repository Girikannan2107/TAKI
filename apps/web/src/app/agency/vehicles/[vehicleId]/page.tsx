import type { Metadata } from "next";
import { VehicleFormView } from "@/features/agency/VehicleFormView";

export const metadata: Metadata = { title: "Vehicle" };

export default async function VehiclePage({ params }: { params: Promise<{ vehicleId: string }> }) {
  const { vehicleId } = await params;
  return <VehicleFormView vehicleId={vehicleId} />;
}
