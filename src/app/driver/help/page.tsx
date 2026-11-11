import type { Metadata } from "next";
import { HelpView } from "@/features/help/HelpView";

export const metadata: Metadata = {
  title: "Help",
  description: "How pricing, capacity, booking requests and payouts work for TAKI drivers.",
};

export default function DriverHelpPage() {
  return <HelpView />;
}
