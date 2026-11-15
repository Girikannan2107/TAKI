import type { Metadata } from "next";
import { ShipmentActionView } from "@/features/driver-app/ShipmentActionView";

export const metadata: Metadata = { title: "Delivery record" };

/** Read-only delivery record (same layout as the action screen, no actions). */
export default async function DriverHistoryRecordPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  return <ShipmentActionView bookingId={decodeURIComponent(bookingId)} readOnly />;
}
