import { Suspense } from "react";
import type { Metadata } from "next";
import { MyRoutesView, MyRoutesSkeleton } from "@/features/driver-routes/MyRoutesView";

export const metadata: Metadata = {
  title: "My Routes",
  description: "Routes you've listed, their remaining capacity and booking requests.",
};

/** My Routes — `?status=active|completed|all`, `?published=<routeId>` after publishing. */
export default function DriverRoutesPage() {
  return (
    <Suspense fallback={<MyRoutesSkeleton />}>
      <MyRoutesView />
    </Suspense>
  );
}
