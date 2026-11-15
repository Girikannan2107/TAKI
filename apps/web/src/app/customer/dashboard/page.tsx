import type { Metadata } from "next";
import { DashboardView } from "@/features/customer-search/DashboardView";

export const metadata: Metadata = {
  title: "Home",
  description: "Start a new shipment and find vehicles already travelling your way.",
};

export default function CustomerDashboardPage() {
  return <DashboardView />;
}
