import type { Metadata } from "next";
import { Suspense } from "react";
import { DriverShipmentsView } from "@/features/driver-app/DriverShipmentsView";
import { ListSkeleton } from "@/features/driver-app/parts";

export const metadata: Metadata = { title: "Assigned shipments" };

/** `?tab=pickup|transit|delivered` is read with useSearchParams, so the view renders inside Suspense. */
export default function DriverShipmentsPage() {
  return (
    <Suspense fallback={<ListSkeleton label="Loading shipments…" />}>
      <DriverShipmentsView />
    </Suspense>
  );
}
