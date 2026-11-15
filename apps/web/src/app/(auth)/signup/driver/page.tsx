import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthSkeleton } from "@/features/auth/AuthBits";
import { DriverDetailsView } from "@/features/auth/DriverDetailsView";

export const metadata: Metadata = { title: "Sign up as a driver" };

export default function Page() {
  return (
    <Suspense fallback={<AuthSkeleton fields={3} />}>
      <DriverDetailsView />
    </Suspense>
  );
}
