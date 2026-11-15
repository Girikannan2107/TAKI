import { DashboardShell } from "@/components/layout/DashboardShell";
import { RequireRole } from "@/components/layout/RequireRole";

/** Admin console shell. proxy.ts gates /admin/* optimistically; every /api/admin handler re-checks the role. */
export default function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell role="admin">
      <RequireRole role="admin">{children}</RequireRole>
    </DashboardShell>
  );
}
