import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { GuestOnly } from "@/components/layout/GuestOnly";
import { AuthSkeleton } from "@/features/auth/AuthBits";
import { AdminLoginView } from "@/features/admin/AdminLoginView";

export const metadata: Metadata = { title: "Sign in" };

export default function AdminLoginPage() {
  return (
    <GuestOnly>
      <AuthLayout>
        <Suspense fallback={<AuthSkeleton fields={2} />}>
          <AdminLoginView />
        </Suspense>
      </AuthLayout>
    </GuestOnly>
  );
}
