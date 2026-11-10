import { DashboardShell } from "@/components/layout/DashboardShell";
import { RequireRole } from "@/components/layout/RequireRole";

/** Driver shell. The sidebar renders immediately; page content waits for the role guard. */
export default function DriverLayout({ children }: LayoutProps<"/driver">) {
  return (
    <DashboardShell role="driver">
      <RequireRole role="driver">{children}</RequireRole>
    </DashboardShell>
  );
}
