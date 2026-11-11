"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { IconButton, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

/** "Booking ID: TAKI874523" + copy button (toast + polite live-region announcement). */
export function BookingIdCopy({ bookingId, className }: { bookingId: string; className?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(bookingId);
      setCopied(true);
      toast({ title: "Booking ID copied", tone: "success" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      toast({ title: "Couldn't copy the booking ID", description: `Your booking ID is ${bookingId}.`, tone: "error" });
    }
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <p className="min-w-0 font-heading text-base font-semibold text-ink sm:text-lg">
        Booking ID:{" "}
        <span data-testid="booking-id" className="tabular-nums tracking-wide">
          {bookingId}
        </span>
      </p>
      <IconButton
        label={copied ? "Booking ID copied" : "Copy booking ID"}
        icon={copied ? <Check strokeWidth={2} className="text-green-600" /> : <Copy strokeWidth={1.75} />}
        size="sm"
        onClick={copy}
        className="text-ink-muted"
      />
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </div>
  );
}
