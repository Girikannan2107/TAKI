import { Check, ChevronDown } from "lucide-react";
import { reachedAt } from "@/lib/domain/booking-machine";
import { cityName } from "@/lib/domain/cities";
import { TIMELINE_STEPS } from "@/lib/domain/labels";
import type { Booking } from "@/lib/domain/types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

type StepState = "done" | "current" | "upcoming";

interface Step {
  key: string;
  label: string;
  state: StepState;
  detail?: string;
}

/** Builds the customer timeline from the booking's append-only status history. */
export function timelineSteps(booking: Booking, providerName: string): Step[] {
  const steps: Step[] = [];
  const awaiting = booking.status === "awaiting_driver";
  if (awaiting) {
    const at = reachedAt(booking, "awaiting_driver");
    steps.push({
      key: "awaiting_driver",
      label: "Payment received · awaiting driver confirmation",
      state: "current",
      detail: at ? `${formatDateTime(at)} · Waiting for ${providerName} to accept` : `Waiting for ${providerName} to accept`,
    });
  }
  const currentIdx = TIMELINE_STEPS.findIndex((s) => s.status === booking.status);
  TIMELINE_STEPS.forEach((s, i) => {
    const state: StepState = currentIdx < 0 || i > currentIdx ? "upcoming" : i === currentIdx ? "current" : "done";
    const at = reachedAt(booking, s.status);
    let detail: string | undefined;
    if (s.status === "in_transit" && state === "current") detail = `On the way to ${cityName(booking.shipment.destinationCityId)}`;
    else if (state !== "upcoming" && at) detail = formatDateTime(at);
    else if (s.status === "out_for_delivery" && state === "upcoming" && booking.expectedOutForDeliveryAt)
      detail = `Expected: ${formatDateTime(booking.expectedOutForDeliveryAt)}`;
    steps.push({ key: s.status, label: s.label, state, detail });
  });
  // The final step is complete, not "in progress".
  if (booking.status === "delivered") steps[steps.length - 1]!.state = "done";
  return steps;
}

const STATE_TEXT: Record<StepState, string> = { done: "Completed", current: "Current step", upcoming: "Upcoming" };

/** Vertical status timeline (screen 10). Ordered list; each step states its status in text. */
export function StatusTimeline({ booking, providerName, className }: { booking: Booking; providerName: string; className?: string }) {
  const steps = timelineSteps(booking, providerName);
  const lastReached = booking.status === "delivered" ? steps.length - 1 : steps.findIndex((s) => s.state === "current");
  return (
    <ol aria-label="Shipment progress" className={cn("relative", className)}>
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const reached = step.state !== "upcoming";
        const isCurrentStep = step.state === "current" || (booking.status === "delivered" && isLast);
        return (
          <li
            key={step.key}
            data-testid="timeline-step"
            data-state={step.state}
            aria-current={isCurrentStep ? "step" : undefined}
            className="relative flex gap-4 pb-6 last:pb-0"
          >
            {!isLast ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-[15px] top-8 -bottom-0 w-0.5 rounded-full",
                  i < lastReached ? "bg-green-600" : "bg-border-strong/60",
                )}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full",
                reached ? "bg-green-600 text-white" : "border-2 border-border-strong bg-surface text-ink-subtle",
                step.state === "current" && "ring-4 ring-green-600/20",
              )}
            >
              {reached ? <Check strokeWidth={3} className="size-4" /> : <ChevronDown strokeWidth={2.25} className="size-3.5" />}
            </span>
            <div className="min-w-0 pt-1">
              <p
                className={cn(
                  "font-heading leading-6",
                  step.state === "current" ? "text-base font-bold text-ink sm:text-lg" : reached ? "font-semibold text-ink" : "font-medium text-ink-muted",
                )}
              >
                <span className="sr-only">{STATE_TEXT[step.state]}: </span>
                {step.label}
              </p>
              {step.detail ? (
                <p className={cn("mt-0.5 text-sm", step.state === "upcoming" ? "text-ink-subtle" : "text-ink-muted")}>{step.detail}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
