import { DashboardShell } from "@/components/layout/DashboardShell";
import { RequireRole } from "@/components/layout/RequireRole";

/** Search → compare → vehicle details are public; requesting a booking (and everything after) needs a customer login. */
const GUEST_PATHS = ["/customer/dashboard", "/customer/vehicles", "/customer/booking/"] as const;

/** Customer shell. The sidebar renders immediately; page content waits for the role guard. */
export default function CustomerLayout({ children }: LayoutProps<"/customer">) {
  return (
    <DashboardShell role="customer">
      <RequireRole role="customer" guestPaths={GUEST_PATHS}>
        {children}
      </RequireRole>
    </DashboardShell>
  );
}
