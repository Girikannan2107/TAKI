"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils/cn";

export interface TabItem {
  value: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  /** Called on click and on arrow-key navigation (automatic activation). Typically updates a URL param. */
  onChange(value: string): void;
  ariaLabel: string;
  /** id of the element you render as role="tabpanel"; wired to aria-controls. */
  panelId?: string;
  className?: string;
}

/**
 * Segmented tablist (role="tablist"). Left/Right/Home/End move and activate.
 * Render the panel yourself: <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-tab-${value}`}>.
 */
export function Tabs({ items, value, onChange, ariaLabel, panelId, className }: TabsProps) {
  const baseId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next].value);
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border bg-surface-muted p-1",
        className,
      )}
    >
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${panelId ?? baseId}-tab-${item.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 font-heading text-sm font-semibold transition-colors duration-150 pointer-coarse:h-11",
              selected ? "bg-surface text-green-800 shadow-card" : "text-ink-muted hover:text-ink",
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-center text-caption tabular-nums",
                  selected ? "bg-mint-100 text-green-800" : "bg-border text-ink-muted",
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
