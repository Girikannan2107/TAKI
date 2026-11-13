import type { Metadata } from "next";
import { AdminReviewView } from "@/features/admin/AdminReviewView";

export const metadata: Metadata = { title: "Driver review" };

/** The `[driverId]` segment is read in the client view with useParams(). */
export default function AdminDriverPage() {
  return <AdminReviewView kind="driver" />;
}
