import type { Metadata } from "next";
import { EarningsView } from "@/features/earnings/EarningsView";

export const metadata: Metadata = { title: "Earnings" };

/** Screen 15 — balances, settlements and demo payouts derived from the demo store. */
export default function EarningsPage() {
  return <EarningsView />;
}
