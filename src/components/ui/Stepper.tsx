import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface StepperProps {
  steps: readonly string[];
  /** Zero-based index of the current step. */
  current: number;
  /** Accessible name of the list. Default "Progress". */
  label?: string;
  className?: string;
}

/**
 * Step indicator. < sm: compact text "Step 2 of 4 · Verify phone". ≥ sm: dots + labels.
 * Current dot = coral (decorative; aria-current carries the meaning), done = green-700 with a check.
 */
export function Stepper({ steps, current, label = "Progress", className }: StepperProps) {
  const total = steps.length;
  const idx = Math.min(Math.max(current, 0), total - 1);
  return (
    <nav aria-label={label} className={cn("min-w-0", className)}>
      <p className="text-sm font-medium text-ink-muted sm:hidden">
        <span className="font-semibold text-ink">
          Step {idx + 1} of {total}
        </span>{" "}
        · {steps[idx]}
      </p>
      <ol className="hidden items-start sm:flex">
        {steps.map((step, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <li
              key={step}
              aria-current={active ? "step" : undefined}
              className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center"
            >
              {i > 0 ? (
                <span
                  aria-hidden="true"
                  className={cn("absolute right-1/2 top-3 h-0.5 w-full -translate-y-1/2", i <= idx ? "bg-green-700" : "bg-border-strong")}
                />
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-10 flex size-6 items-center justify-center rounded-full text-caption font-bold",
                  done && "bg-green-700 text-white",
                  active && "bg-coral-400 text-green-950 ring-4 ring-coral-100",
                  !done && !active && "border-2 border-border-strong bg-surface text-ink-subtle",
                )}
              >
                {done ? <Check strokeWidth={3} className="size-3.5" /> : i + 1}
              </span>
              <span className={cn("max-w-full truncate px-1 text-caption", active ? "font-semibold text-ink" : "text-ink-muted")}>
                <span className="sr-only">{done ? "Completed: " : active ? "Current: " : "Upcoming: "}</span>
                {step}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
