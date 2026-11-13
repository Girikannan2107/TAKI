import { Ban, Check, ChevronDown, X } from "lucide-react";
import type { TrackingStageDTO } from "@/lib/api/contracts/customer";
import { formatDateTime, formatInstantTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

type StepState = TrackingStageDTO["state"];

const STATE_TEXT: Record<StepState, string> = { done: "Completed", current: "Current step", upcoming: "Upcoming", skipped: "Skipped" };

/** One line under the step label. Upcoming steps show only the schedule; nothing is ever shown as done early. */
function detailOf(s: TrackingStageDTO): string | null {
  if (s.key === "checkpoint") {
    if (s.state === "done" && s.at) return `Arrived ${formatInstantTime(s.at)}${s.departedAt ? ` · Departed ${formatInstantTime(s.departedAt)}` : ""}`;
    return s.expectedAt ? `Scheduled ${formatDateTime(s.expectedAt)}` : null;
  }
  const parts: string[] = [];
  if (s.state === "done" && s.at) parts.push(formatDateTime(s.at));
  else if ((s.state === "upcoming" || s.state === "current") && s.expectedAt) parts.push(`${s.key === "confirmation" ? "By" : "Scheduled"} ${formatDateTime(s.expectedAt)}`);
  if (s.placeName) parts.push(s.placeName);
  if (s.note) parts.push(s.note);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Vertical tracking timeline built from server stages (real events only): booking →
 * confirmation → pickup → in transit → checkpoint sub-steps → out for delivery → delivered.
 * Terminal rejected/cancelled stages end the list with the reason.
 */
export function StatusTimeline({ stages, className }: { stages: readonly TrackingStageDTO[]; className?: string }) {
  const visible = stages.filter((s) => s.state !== "skipped" || s.key === "rejected" || s.key === "cancelled");
  const lastReached = visible.reduce((acc, s, i) => (s.state === "done" || s.state === "current" ? i : acc), -1);
  return (
    <ol aria-label="Shipment progress" className={cn("relative", className)}>
      {visible.map((step, i) => {
        const isLast = i === visible.length - 1;
        const terminal = step.key === "rejected" || step.key === "cancelled";
        const reached = step.state === "done" || step.state === "current" || terminal;
        const sub = step.key === "checkpoint";
        const detail = detailOf(step);
        return (
          <li
            key={`${step.key}-${step.checkpointIndex ?? i}`}
            data-testid="timeline-step"
            data-state={step.state}
            data-key={step.key}
            aria-current={step.state === "current" ? "step" : undefined}
            className="relative flex gap-4 pb-6 last:pb-0"
          >
            {!isLast ? (
              <span
                aria-hidden="true"
                className={cn("absolute left-[15px] top-8 -bottom-0 w-0.5 rounded-full", i < lastReached ? "bg-green-600" : "bg-border-strong/60")}
              />
            ) : null}
            <span aria-hidden="true" className="relative z-[1] flex size-8 shrink-0 items-center justify-center">
              <span
                className={cn(
                  "flex items-center justify-center rounded-full",
                  sub ? "size-5" : "size-8",
                  terminal
                    ? "bg-danger-100 text-error"
                    : step.state === "done"
                      ? "bg-green-600 text-white"
                      : step.state === "current"
                        ? "bg-surface text-green-700 ring-4 ring-green-600/20 border-2 border-green-600"
                        : "border-2 border-border-strong bg-surface text-ink-subtle",
                )}
              >
                {terminal ? (
                  step.key === "rejected" ? (
                    <X strokeWidth={3} className="size-4" />
                  ) : (
                    <Ban strokeWidth={2.5} className="size-4" />
                  )
                ) : step.state === "done" ? (
                  <Check strokeWidth={3} className={sub ? "size-3" : "size-4"} />
                ) : sub ? null : (
                  <ChevronDown strokeWidth={2.25} className="size-3.5" />
                )}
              </span>
            </span>
            <div className="min-w-0 pt-1">
              <p
                className={cn(
                  "font-heading leading-6",
                  sub && "text-sm",
                  step.state === "current" ? "text-base font-bold text-ink sm:text-lg" : reached ? "font-semibold text-ink" : "font-medium text-ink-muted",
                )}
              >
                <span className="sr-only">{terminal ? "" : `${STATE_TEXT[step.state]}: `}</span>
                {sub ? `Checkpoint · ${step.label}` : step.label}
              </p>
              {detail ? <p className={cn("mt-0.5 text-sm", step.state === "upcoming" ? "text-ink-subtle" : terminal ? "text-error" : "text-ink-muted")}>{detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
