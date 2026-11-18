import type { Metadata } from "next";
import { HistoryView } from "@/features/agency/HistoryView";
import { firstParam, type SearchParams } from "@/features/agency/format";

export const metadata: Metadata = { title: "History" };

/** `?q=&type=&from=&to=`. */
export default async function AgencyHistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return <HistoryView q={firstParam(sp.q)} type={firstParam(sp.type)} from={firstParam(sp.from)} to={firstParam(sp.to)} />;
}
