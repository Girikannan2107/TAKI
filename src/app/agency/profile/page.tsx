import type { Metadata } from "next";
import { AgencyProfileView } from "@/features/agency/AgencyProfileView";

export const metadata: Metadata = { title: "Profile" };

export default function AgencyProfilePage() {
  return <AgencyProfileView />;
}
