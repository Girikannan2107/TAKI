"use client";

import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { AuthProvider } from "@/lib/auth/AuthProvider";

/** App-wide client providers: toasts and the Firebase-backed session (all data comes from the API). */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}
