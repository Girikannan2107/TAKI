import type { Metadata } from "next";
import { RouteBookingView } from "@/features/booking/RouteBookingView";

export const metadata: Metadata = { title: "Route & Booking Details" };

/** Screen 08. The `[vehicleId]` segment carries the offer's route id (e.g. `rte_r1`), read in the client view. */
export default function RouteBookingPage() {
  return <RouteBookingView />;
}
