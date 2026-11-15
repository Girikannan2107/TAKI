import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/features/admin/AdminBits";
import { AdminQueueView } from "@/features/admin/AdminQueueView";

export const metadata: Metadata = { title: "Drivers" };

export default function AdminDriversPage() {
  return (
    <Suspense fallback={<ListSkeleton label="Loading drivers" />}>
      <AdminQueueView kind="driver" />
    </Suspense>
  );
}
