import type { Metadata } from "next";
import { AdminBookingView } from "@/features/admin/AdminBookingView";

export const metadata: Metadata = { title: "Booking lookup" };

/** The `[bookingId]` segment is read in the client view with useParams(). */
export default function AdminBookingPage() {
  return <AdminBookingView />;
}
