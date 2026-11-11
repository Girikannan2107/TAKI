import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthSkeleton } from "@/features/auth/AuthBits";
import { RoleSelectView } from "@/features/auth/RoleSelectView";

export const metadata: Metadata = { title: "Join TAKI Travel" };

export default function Page() {
  return (
    <Suspense fallback={<AuthSkeleton fields={2} />}>
      <RoleSelectView />
    </Suspense>
  );
}
