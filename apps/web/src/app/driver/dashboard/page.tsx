import type { Metadata } from "next";
import { DriverDashboardView } from "@/features/driver-app/DriverDashboardView";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your current trip, pickups and deliveries at a glance.",
};

/** Driver app dashboard (P3 §4.5). */
export default function DriverDashboardPage() {
  return <DriverDashboardView />;
}
