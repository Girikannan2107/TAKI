import type { Metadata } from "next";
import { BookingRequestsView } from "@/features/driver-requests/BookingRequestsView";
import { firstParam, type SearchParams } from "@/features/agency/format";

export const metadata: Metadata = { title: "Bookings" };

/** `?tab=pending|accepted|confirmed|rejected|cancelled` (unknown values fall back to pending). */
export default async function AgencyBookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return <BookingRequestsView tab={firstParam(sp.tab)} />;
}
