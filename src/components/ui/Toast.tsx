"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
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
      data-toast=""
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

const within = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/**
 * While a modal <dialog> is open the toast popover is inert, so pointer clicks on a toast fall through to the
 * dialog's ::backdrop. useDialog calls this first: if (x, y) lands on a toast card it returns true (the
 * dialog must stay open) and, when the point is on one of the card's buttons (the × dismiss), clicks it
 * programmatically so dismiss still works above a modal. Clicks on the region's empty padding return false.
 */
export function routeClickToToast(x: number, y: number): boolean {
  if (typeof document === "undefined") return false;
  const cards = document.querySelectorAll<HTMLElement>("[data-toast-region] [data-toast]");
  for (const card of Array.from(cards)) {
    if (!within(card.getBoundingClientRect(), x, y)) continue;
    const button = Array.from(card.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      within(b.getBoundingClientRect(), x, y),
    );
    button?.click();
    return true;
  }
  return false;
}

/**
 * Keeps the toast region in the browser's top layer (popover="manual") and re-promotes it above any
 * modal <dialog> that opens later, so toasts are not hidden behind Modal/Drawer backdrops.
 * Without Popover API support the region stays a plain fixed, z-100 element.
 */
function useTopLayer(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== "function") return;
    const promote = () => {
      try {
        if (el.matches(":popover-open")) el.hidePopover();
        el.showPopover();
      } catch {
        // Disconnected or unsupported: leave it as a normal fixed element.
      }
    };
    promote();
    // showModal() sets [open]; the most recently shown top-layer element paints on top, so re-show ours after it.
    const mo = new MutationObserver((records) => {
      if (records.some((r) => r.target instanceof HTMLDialogElement && r.target.open && r.target.matches(":modal"))) promote();
    });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => {
      mo.disconnect();
      try {
        if (el.matches(":popover-open")) el.hidePopover();
      } catch {
        /* ignore */
      }
    };
  }, [ref]);
}

/** Mount once (app/providers.tsx). Renders a polite live region: top on mobile, bottom-right on desktop. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const regionRef = useRef<HTMLElement>(null);
  useTopLayer(regionRef);

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
        ref={regionRef}
        popover="manual"
        data-toast-region=""
        aria-label="Status messages"
        aria-live="polite"
        // popover UA styles (inset:0, margin:auto, border, padding, Canvas bg, fit-content size) are reset here.
        // Before showPopover() runs the UA hides it; there are no toasts before mount anyway.
        className="pointer-events-none fixed inset-x-0 top-0 bottom-auto z-[100] m-0 flex h-auto w-auto justify-center overflow-visible border-0 bg-transparent p-4 text-inherit sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-auto sm:justify-end sm:p-6"
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
