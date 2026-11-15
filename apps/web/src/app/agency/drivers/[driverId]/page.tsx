import type { Metadata } from "next";
import { DriverDetailView } from "@/features/agency/DriverDetailView";

export const metadata: Metadata = { title: "Driver" };

export default async function DriverPage({ params }: { params: Promise<{ driverId: string }> }) {
  const { driverId } = await params;
  return <DriverDetailView driverId={driverId} />;
}
