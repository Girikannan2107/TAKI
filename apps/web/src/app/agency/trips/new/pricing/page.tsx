import type { Metadata } from "next";
import { SetPricingView } from "@/features/pricing/SetPricingView";
import { firstParam, type SearchParams } from "@/features/agency/format";

export const metadata: Metadata = { title: "Set Pricing" };

/** Add Trip step 2 (`?draft=<tripId>`). */
export default async function TripPricingPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return <SetPricingView draft={firstParam(sp.draft)} />;
}
