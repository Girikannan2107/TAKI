import type { Metadata } from "next";
import { VerificationView } from "@/features/account";

export const metadata: Metadata = { title: "Your documents" };

/** Licence + Aadhaar + photo. `?onboarding=1` when arriving straight from signup (step 4 of 4). */
export default async function DriverDocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { onboarding } = await searchParams;
  return <VerificationView role="driver" onboarding={onboarding === "1"} />;
}
