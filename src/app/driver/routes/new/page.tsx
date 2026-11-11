import type { Metadata } from "next";
import { AddRouteView } from "@/features/driver-routes/AddRouteView";

export const metadata: Metadata = {
  title: "Add New Route",
  description: "List a route with spare capacity: cities, stops, date, vehicle and capacity.",
};

/** Screen 12 — Add New Route (step 1 of 2; Set Pricing is step 2). */
export default function AddRoutePage() {
  return <AddRouteView />;
}
