import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthSkeleton } from "@/features/auth/AuthBits";
import { CreatePasswordView } from "@/features/auth/CreatePasswordView";

export const metadata: Metadata = { title: "Create a Password" };

export default function Page() {
  return (
    <Suspense fallback={<AuthSkeleton fields={3} />}>
      <CreatePasswordView />
    </Suspense>
  );
}
