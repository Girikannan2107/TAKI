import type { Metadata } from "next";
import { MyRoutesView } from "@/features/driver-routes/MyRoutesView";
import { firstParam, type SearchParams } from "@/features/agency/format";

export const metadata: Metadata = { title: "Trips", description: "Your upcoming, active, completed and cancelled trips, and drafts." };

/** `?tab=upcoming|active|completed|cancelled|drafts`, `?published=<tripId>` after publishing. */
export default async function AgencyTripsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return <MyRoutesView tab={firstParam(sp.tab)} published={firstParam(sp.published)} />;
}
