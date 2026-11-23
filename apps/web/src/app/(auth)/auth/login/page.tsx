import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthSkeleton } from "@/features/auth/AuthBits";
import { LoginView } from "@/features/auth/LoginView";

export const metadata: Metadata = { title: "Log in" };

export default function Page() {
  return (
    <Suspense fallback={<AuthSkeleton fields={2} />}>
      <LoginView />
    </Suspense>
  );
}
