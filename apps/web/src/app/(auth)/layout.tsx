import { AuthLayout } from "@/components/layout/AuthLayout";
import { GuestOnly } from "@/components/layout/GuestOnly";

/** Auth frame: signed-in users are redirected away; pages render <AuthCardHeader> + their form. */
export default function AuthGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <GuestOnly>
      <AuthLayout>{children}</AuthLayout>
    </GuestOnly>
  );
}
