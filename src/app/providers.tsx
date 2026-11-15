"use client";

import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";

/** App-wide client providers. All data comes from the API (no client-side store to hydrate). */
export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
