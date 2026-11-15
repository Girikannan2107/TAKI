import type { ReactNode } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { RequireRole } from "@/components/layout/RequireRole";

/** Travel agency shell (P3 §2.4). The sidebar renders immediately; page content waits for the role guard. */
export default function AgencyLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardShell role="agency">
      <RequireRole role="agency">{children}</RequireRole>
    </DashboardShell>
  );
}
