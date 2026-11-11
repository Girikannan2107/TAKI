import type { Metadata } from "next";
import { SetPricingView } from "@/features/pricing/SetPricingView";

export const metadata: Metadata = { title: "Set Pricing" };

/** Screen 13 — reads the Add Route draft from the demo store; redirects to Add Route if it is missing. */
export default function SetPricingPage() {
  return <SetPricingView />;
}
