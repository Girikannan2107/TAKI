"use client";

import { createContext } from "react";

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Auto-dismiss delay. Default 4000 (errors 6000). */
  durationMs?: number;
}

export interface ToastApi {
  toast(opts: ToastOptions): string;
  dismiss(id: string): void;
}

export const ToastContext = createContext<ToastApi | null>(null);
