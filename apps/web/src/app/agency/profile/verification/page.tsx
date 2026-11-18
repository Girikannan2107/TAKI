import type { Metadata } from "next";
import { VerificationView } from "@/features/account";
import { firstParam, type SearchParams } from "@/features/agency/format";

export const metadata: Metadata = { title: "Agency verification" };

/** Identity document + photo for verification (`?onboarding=1` straight after signup). Uses D1's shared VerificationView. */
export default async function AgencyVerificationPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return <VerificationView role="agency" onboarding={firstParam(sp.onboarding) === "1"} />;
}
