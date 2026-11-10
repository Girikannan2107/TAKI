import { DashboardShell } from "@/components/layout/DashboardShell";
import { RequireRole } from "@/components/layout/RequireRole";

/** Customer shell. The sidebar renders immediately; page content waits for the role guard. */
export default function CustomerLayout({ children }: LayoutProps<"/customer">) {
  return (
    <DashboardShell role="customer">
      <RequireRole role="customer">{children}</RequireRole>
    </DashboardShell>
  );
}
