import type { Metadata } from "next";
import { AdminSettlementsView } from "@/features/admin/AdminSettlementsView";

export const metadata: Metadata = { title: "Settlements" };

export default function AdminSettlementsPage() {
  return <AdminSettlementsView />;
}
