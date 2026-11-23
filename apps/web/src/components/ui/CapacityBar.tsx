import { cn } from "@/lib/utils/cn";

export interface CapacityBarProps {
  totalKg: number;
  bookedKg: number;
  /** Held but not yet paid (awaiting payment). Shown lighter. */
  reservedKg?: number;
  /** Hide the text line (keep the meter). */
  hideLabel?: boolean;
  /** Dark card variant (brand / sage surfaces). */
  surface?: "light" | "dark";
  className?: string;
}

const kg = (n: number) => `${Math.round(n).toLocaleString("en-IN")} kg`;

/**
 * Capacity meter: booked (green-700) + reserved (green-300) + free (track).
 * role="meter" with a text label "1,200 of 3,000 kg booked · 1,800 kg left".
 */
export function CapacityBar({ totalKg, bookedKg, reservedKg = 0, hideLabel, surface = "light", className }: CapacityBarProps) {
  const total = Math.max(0, totalKg);
  const booked = Math.min(Math.max(0, bookedKg), total);
  const reserved = Math.min(Math.max(0, reservedKg), total - booked);
  const left = Math.max(0, total - booked - reserved);
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const text = `${Math.round(booked).toLocaleString("en-IN")} of ${kg(total)} booked${reserved > 0 ? ` · ${kg(reserved)} reserved` : ""} · ${kg(left)} left`;
  const dark = surface === "dark";

  return (
    <div className={cn("min-w-0", className)}>
      <div
        role="meter"
        aria-label="Capacity booked"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={booked + reserved}
        aria-valuetext={text}
        className={cn("flex h-2.5 w-full overflow-hidden rounded-full", dark ? "bg-white/20" : "bg-border")}
      >
        <span className={cn("h-full", dark ? "bg-lime-300" : "bg-green-700")} style={{ width: `${pct(booked)}%` }} />
        <span className={cn("h-full", dark ? "bg-lime-100/60" : "bg-green-300")} style={{ width: `${pct(reserved)}%` }} />
      </div>
      {hideLabel ? null : (
        <p aria-hidden="true" className={cn("mt-1.5 text-[13px] tabular-nums", dark ? "text-white/90" : "text-ink-muted")}>
          <span className={cn("font-semibold", dark ? "text-white" : "text-ink")}>{Math.round(booked).toLocaleString("en-IN")}</span> of {kg(total)} booked
          {reserved > 0 ? <> · {kg(reserved)} reserved</> : null} · <span className={cn("font-semibold", dark ? "text-white" : "text-ink")}>{kg(left)}</span> left
        </p>
      )}
    </div>
  );
}
