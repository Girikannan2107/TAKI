import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthSkeleton } from "@/features/auth/AuthBits";
import { VerifyOtpView } from "@/features/auth/VerifyOtpView";

export const metadata: Metadata = { title: "Verify OTP" };

export default function Page() {
  return (
    <Suspense fallback={<AuthSkeleton fields={2} />}>
      <VerifyOtpView />
    </Suspense>
  );
}
