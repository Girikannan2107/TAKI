"use client";

import { useState } from "react";
import { XCircle } from "lucide-react";
import { Button, ConfirmDialog, useToast } from "@/components/ui";
import { hasDeparted } from "@/lib/domain/search";
import type { Booking, Route } from "@/lib/domain/types";
import { errorMessage, marketplace } from "@/lib/services/marketplace";
import { getNow } from "@/lib/utils/clock";
import { cn } from "@/lib/utils/cn";

/** A paid booking can be cancelled while awaiting the driver, or once confirmed until the vehicle departs. */
export function canCancelPaidBooking(booking: Booking, route: Route | undefined): boolean {
  if (booking.status === "awaiting_driver") return true;
  if (booking.status === "confirmed") return Boolean(route) && !hasDeparted(route!, getNow());
  return false;
}

/**
 * "Cancel booking" (secondary, danger tone) + ConfirmDialog for a PAID booking.
 * Renders nothing in any other status. After cancelling, the store update makes the
 * parent view show its cancelled / refund state.
 */
export function CancelPaidBooking({ booking, route, className }: { booking: Booking; route: Route | undefined; className?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canCancelPaidBooking(booking, route)) return null;
  const confirmed = booking.status === "confirmed";

  async function cancel() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await marketplace.cancelBooking(booking.id);
      toast({ title: "Booking cancelled — refund issued (demo)", tone: "success" });
      setOpen(false);
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      toast({ title: "Couldn't cancel the booking", description: msg, tone: "error" });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <Button
        variant="outline"
        fullWidth
        onClick={() => setOpen(true)}
        leadingIcon={<XCircle aria-hidden="true" strokeWidth={1.75} />}
        className="border-error/40 text-error hover:bg-danger-100"
      >
        Cancel booking
      </Button>
      <div role="alert" aria-live="assertive" className="empty:hidden">
        {error ? <p className="mt-2 text-center text-sm text-error">{error}</p> : null}
      </div>
      <ConfirmDialog
        open={open}
        title="Cancel this booking?"
        description={
          confirmed
            ? "You'll be refunded (demo — no money moves). The reserved space will be released."
            : "You'll be refunded (demo — no money moves)."
        }
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        tone="danger"
        loading={busy}
        onConfirm={cancel}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
