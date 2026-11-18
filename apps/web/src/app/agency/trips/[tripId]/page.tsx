import type { Metadata } from "next";
import { TripDetailsView } from "@/features/agency/TripDetailsView";

export const metadata: Metadata = { title: "Trip" };

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return <TripDetailsView tripId={tripId} />;
}
