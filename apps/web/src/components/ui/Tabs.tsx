"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
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

/** Edge fades for the scrollable list: a side fades out only while more tabs are hidden past it. */
const FADE = "32px";
function maskFor(start: boolean, end: boolean): string | undefined {
  if (!start && !end) return undefined;
  return `linear-gradient(to right, ${start ? "transparent" : "#000"}, #000 ${start ? FADE : "0px"}, #000 calc(100% - ${end ? FADE : "0px"}), ${end ? "transparent" : "#000"})`;
}

/**
 * Segmented tablist (role="tablist"). Left/Right/Home/End move and activate.
 * On narrow screens the list scrolls horizontally (scrollbar hidden) with a fade on whichever edge hides
 * more tabs, and the selected tab is kept scrolled into view.
 * Render the panel yourself: <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-tab-${value}`}>.
 */
export function Tabs({ items, value, onChange, ariaLabel, panelId, className }: TabsProps) {
  const baseId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  // Track whether tabs are hidden past either edge (on scroll and on resize of the list or its content).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      const max = list.scrollWidth - list.clientWidth;
      const start = max > 1 && list.scrollLeft > 1;
      const end = max > 1 && list.scrollLeft < max - 1;
      setOverflow((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    list.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(list);
    for (const child of Array.from(list.children)) ro?.observe(child);
    return () => {
      list.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [items.length]);

  // Keep the selected tab fully visible inside the scroller (horizontal only; never scrolls the page).
  useEffect(() => {
    const list = listRef.current;
    const tab = refs.current[items.findIndex((i) => i.value === value)];
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    const pad = 32;
    const left = tab.offsetLeft; // list is position:relative, so this is in scroll-content coordinates
    const right = left + tab.offsetWidth;
    if (left - pad < list.scrollLeft) list.scrollTo({ left: Math.max(0, left - pad), behavior: "smooth" });
    else if (right + pad > list.scrollLeft + list.clientWidth)
      list.scrollTo({ left: right + pad - list.clientWidth, behavior: "smooth" });
  }, [value, items]);

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
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      style={{ maskImage: maskFor(overflow.start, overflow.end), WebkitMaskImage: maskFor(overflow.start, overflow.end) }}
      className={cn(
        "relative inline-flex max-w-full self-start items-center gap-1 overflow-x-auto overscroll-x-contain rounded-full border border-border bg-surface-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
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
