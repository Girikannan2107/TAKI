import type { Metadata } from "next";
import { EarningsView } from "@/features/earnings/EarningsView";
import { firstParam, type SearchParams } from "@/features/agency/format";

export const metadata: Metadata = { title: "Earnings" };

/** `?tab=trips|bookings|payments|settlements`. Read-only (no withdraw). */
export default async function AgencyEarningsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return <EarningsView tab={firstParam(sp.tab)} />;
}
