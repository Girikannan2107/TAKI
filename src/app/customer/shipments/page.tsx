import type { Metadata } from "next";
import { Suspense } from "react";
import { ShipmentsView } from "@/features/shipments/ShipmentsView";

export const metadata: Metadata = {
  title: "My Shipments",
  description: "Track your shipments and complete pending payments.",
};

export default function MyShipmentsPage() {
  return (
    <Suspense fallback={null}>
      <ShipmentsView />
    </Suspense>
  );
}
