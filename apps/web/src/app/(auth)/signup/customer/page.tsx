import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthSkeleton } from "@/features/auth/AuthBits";
import { CustomerDetailsView } from "@/features/auth/CustomerDetailsView";

export const metadata: Metadata = { title: "Create a customer account" };

export default function Page() {
  return (
    <Suspense fallback={<AuthSkeleton fields={3} />}>
      <CustomerDetailsView />
    </Suspense>
  );
}
