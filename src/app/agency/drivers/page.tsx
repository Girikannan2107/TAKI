import type { Metadata } from "next";
import { DriversView } from "@/features/agency/DriversView";
import { firstParam, type SearchParams } from "@/features/agency/format";

export const metadata: Metadata = { title: "Drivers" };

/** `?tab=active|pending`. */
export default async function AgencyDriversPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return <DriversView tab={firstParam(sp.tab)} />;
}
