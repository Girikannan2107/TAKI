import type { Metadata } from "next";
import { DriverDashboardView } from "@/features/driver-dashboard/DriverDashboardView";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your earnings, routes and booking requests at a glance.",
};

/** Screen 11 — Driver Dashboard. */
export default function DriverDashboardPage() {
  return <DriverDashboardView />;
}
