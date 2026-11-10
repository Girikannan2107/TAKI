"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ToastContext, type ToastApi, type ToastOptions, type ToastTone } from "./toast-context";

export type { ToastOptions, ToastTone } from "./toast-context";

interface ToastRecord extends Required<Pick<ToastOptions, "title" | "tone" | "durationMs">> {
  id: string;
  description?: string;
}

const MAX_VISIBLE = 4;
let counter = 0;

const toneStyles: Record<ToastTone, { icon: ReactNode; accent: string }> = {
  success: { icon: <CircleCheck strokeWidth={2} />, accent: "text-green-600" },
  error: { icon: <CircleAlert strokeWidth={2} />, accent: "text-error" },
  info: { icon: <Info strokeWidth={2} />, accent: "text-info-700" },
};

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss(id: string): void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.durationMs);
  const startedAt = useRef(0);

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(800, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, onDismiss, toast.id]);

  const style = toneStyles[toast.tone];
  return (
    <li
      role={toast.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border bg-surface p-4 pr-2 shadow-raised motion-safe:animate-toast-in"
    >
      <span aria-hidden="true" className={cn("mt-0.5 flex [&_svg]:size-5", style.accent)}>
        {style.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-heading text-[15px] font-semibold leading-5 text-ink">{toast.title}</p>
        {toast.description ? <p className="mt-0.5 text-sm text-ink-muted">{toast.description}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-my-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-ink/6 hover:text-ink pointer-coarse:size-11"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </li>
  );
}

/** Mount once (app/providers.tsx). Renders a polite live region: top on mobile, bottom-right on desktop. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((opts: ToastOptions) => {
    counter += 1;
    const id = `toast-${counter}`;
    const tone = opts.tone ?? "info";
    const record: ToastRecord = {
      id,
      title: opts.title,
      description: opts.description,
      tone,
      durationMs: opts.durationMs ?? (tone === "error" ? 6000 : 4000),
    };
    setToasts((list) => {
      // De-duplicate identical messages fired twice in quick succession (e.g. StrictMode effects).
      const filtered = list.filter((t) => !(t.title === record.title && t.description === record.description));
      return [...filtered, record].slice(-MAX_VISIBLE);
    });
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        aria-label="Status messages"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center p-4 sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-auto sm:justify-end sm:p-6"
      >
        <ol className="flex w-full max-w-sm flex-col gap-2">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </ol>
      </section>
    </ToastContext.Provider>
  );
}
