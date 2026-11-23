import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPaymentsView } from "@/features/admin/AdminPaymentsView";
import { ListSkeleton } from "@/features/admin/AdminBits";

export const metadata: Metadata = { title: "Payments" };

export default function AdminPaymentsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={4} label="Loading payments" />}>
      <AdminPaymentsView />
    </Suspense>
  );
}
