import type { Metadata } from "next";
import { ShipmentActionView } from "@/features/driver-app/ShipmentActionView";

export const metadata: Metadata = { title: "Shipment" };

/** Shipment action screen: pickup (OTP), transit, out for delivery, delivery (OTP + photo proof). */
export default async function DriverShipmentPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  return <ShipmentActionView bookingId={decodeURIComponent(bookingId)} />;
}
