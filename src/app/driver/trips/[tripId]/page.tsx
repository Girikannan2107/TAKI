import type { Metadata } from "next";
import { TripRunView } from "@/features/driver-app/TripRunView";

export const metadata: Metadata = { title: "Trip" };

/** Trip run: record checkpoint arrive/depart in route order, then complete the trip. */
export default async function DriverTripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return <TripRunView tripId={decodeURIComponent(tripId)} />;
}
