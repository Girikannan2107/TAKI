import type { ReactNode } from "react";

/**
 * Wraps a route segment's pages from a `template.tsx` (which Next remounts per navigation), so each
 * section change gets one short fade-in. CSS only — no motion library; reduced motion makes it instant.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return <div className="animate-page">{children}</div>;
}
