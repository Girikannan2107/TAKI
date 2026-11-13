import type { Metadata } from "next";
import { BookingDetailsView } from "@/features/agency/BookingDetailsView";

export const metadata: Metadata = { title: "Booking" };

export default async function BookingPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  return <BookingDetailsView bookingId={bookingId} />;
}
