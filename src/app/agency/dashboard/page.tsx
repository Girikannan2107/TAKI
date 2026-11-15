import type { Metadata } from "next";
import { AgencyDashboardView } from "@/features/driver-dashboard/DriverDashboardView";

export const metadata: Metadata = { title: "Dashboard", description: "Your fleet, trips, bookings and revenue at a glance." };

export default function AgencyDashboardPage() {
  return <AgencyDashboardView />;
}
