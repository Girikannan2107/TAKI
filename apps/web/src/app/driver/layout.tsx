import { DashboardShell } from "@/components/layout/DashboardShell";
import { RequireRole } from "@/components/layout/RequireRole";

/** Driver app shell: sidebar ≥lg, bottom tab bar <lg (hidden on action screens). Content waits for the role guard. */
export default function DriverLayout({ children }: LayoutProps<"/driver">) {
  return (
    <DashboardShell role="driver">
      <RequireRole role="driver">{children}</RequireRole>
    </DashboardShell>
  );
}
