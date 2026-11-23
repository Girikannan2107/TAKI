import type { Metadata } from "next";
import { AddRouteView } from "@/features/driver-routes/AddRouteView";
import { firstParam, type SearchParams } from "@/features/agency/format";

export const metadata: Metadata = { title: "Add Trip", description: "Vehicle, driver, route with checkpoints, capacity and goods." };

/** Add Trip step 1 (`?draft=<tripId>` continues a saved draft). */
export default async function AddTripPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return <AddRouteView draft={firstParam(sp.draft)} />;
}
