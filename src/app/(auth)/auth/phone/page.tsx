import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthSkeleton } from "@/features/auth/AuthBits";
import { PhoneView } from "@/features/auth/PhoneView";

export const metadata: Metadata = { title: "Enter your mobile number" };

export default function Page() {
  return (
    <Suspense fallback={<AuthSkeleton fields={1} />}>
      <PhoneView />
    </Suspense>
  );
}
