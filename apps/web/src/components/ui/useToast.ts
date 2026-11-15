"use client";

import { useContext } from "react";
import { ToastContext, type ToastApi } from "./toast-context";

const noop: ToastApi = {
  toast: () => {
    if (process.env.NODE_ENV !== "production") console.warn("useToast() called outside <ToastProvider>; toast ignored.");
    return "";
  },
  dismiss: () => {},
};

/** `const { toast } = useToast(); toast({ title: "Booking ID copied", tone: "success" })` */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? noop;
}
