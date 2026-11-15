import type { Metadata } from "next";
import { Suspense } from "react";
import { AgencyDetailsView } from "@/features/auth/AgencyDetailsView";
import { AuthSkeleton } from "@/features/auth/AuthBits";

export const metadata: Metadata = { title: "Register your travel agency" };

export default function Page() {
  return (
    <Suspense fallback={<AuthSkeleton fields={5} />}>
      <AgencyDetailsView />
    </Suspense>
  );
}
