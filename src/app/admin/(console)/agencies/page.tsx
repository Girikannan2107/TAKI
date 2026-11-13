import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/features/admin/AdminBits";
import { AdminQueueView } from "@/features/admin/AdminQueueView";

export const metadata: Metadata = { title: "Agencies" };

export default function AdminAgenciesPage() {
  return (
    <Suspense fallback={<ListSkeleton label="Loading agencies" />}>
      <AdminQueueView kind="agency" />
    </Suspense>
  );
}
