"use client";

import { useCallback, type ReactNode } from "react";
import { StoreHydrator } from "@/lib/store/StoreHydrator";
import { ToastProvider } from "@/components/ui/Toast";
import { useToast } from "@/components/ui/useToast";

function Hydration() {
  const { toast } = useToast();
  const onDemoRefreshed = useCallback(() => {
    toast({ title: "Demo data refreshed for today — demo bookings were reset", tone: "info" });
  }, [toast]);
  return <StoreHydrator onDemoRefreshed={onDemoRefreshed} />;
}

/** App-wide client providers: toasts + one-time persisted-store hydration. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <Hydration />
      {children}
    </ToastProvider>
  );
}
