import type { Metadata } from "next";
import { AdminReviewView } from "@/features/admin/AdminReviewView";

export const metadata: Metadata = { title: "Agency review" };

/** The `[agencyId]` segment is read in the client view with useParams(). */
export default function AdminAgencyPage() {
  return <AdminReviewView kind="agency" />;
}
