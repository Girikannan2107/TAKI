import type { ReactNode } from "react";
import { PageTransition } from "@/components/layout/PageTransition";

/** Remounted by Next on each section change: one short fade-in (see PageTransition). */
export default function Template({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
