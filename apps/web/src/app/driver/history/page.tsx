import type { Metadata } from "next";
import { Suspense } from "react";
import { DriverHistoryView } from "@/features/driver-app/DriverHistoryView";
import { ListSkeleton } from "@/features/driver-app/parts";

export const metadata: Metadata = { title: "History" };

/** `?q=` and `?month=` are read with useSearchParams, so the view renders inside Suspense. */
export default function DriverHistoryPage() {
  return (
    <Suspense fallback={<ListSkeleton label="Loading history…" />}>
      <DriverHistoryView />
    </Suspense>
  );
}
