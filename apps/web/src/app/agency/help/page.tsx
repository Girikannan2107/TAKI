import type { Metadata } from "next";
import { HelpView } from "@/features/help/HelpView";

export const metadata: Metadata = { title: "Help" };

export default function AgencyHelpPage() {
  return <HelpView />;
}
