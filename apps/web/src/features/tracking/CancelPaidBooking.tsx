"use client";

import { useState } from "react";
import { XCircle } from "lucide-react";
import { Button, ConfirmDialog, useToast } from "@/components/ui";
import { customerApi } from "@/lib/api/client/customer";
import type { CustomerBookingDTO } from "@/lib/api/contracts/customer";
import { errorMessage } from "@/lib/api/http";
import { cn } from "@/lib/utils/cn";

const PAID: ReadonlyArray<CustomerBookingDTO["status"]> = ["confirmed"];

/**
 * "Cancel booking" + ConfirmDialog. Allowed only before pickup (server decides via `canCancel`).
 * A paid booking is refunded through the gateway; the server returns the updated booking.
 */
export function CancelPaidBooking({ booking, onCancelled, className }: { booking: CustomerBookingDTO; onCancelled(b: CustomerBookingDTO): void; className?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!booking.canCancel) return null;
  const paid = PAID.includes(booking.status);

  async function cancel() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await customerApi.cancelBooking(booking.id);
      toast({ title: paid ? "Booking cancelled. Your refund has started." : "Booking cancelled", tone: "success" });
      setOpen(false);
      onCancelled(updated);
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
        {booking.status === "awaiting_agency" ? "Cancel request" : "Cancel booking"}
      </Button>
      <div role="alert" aria-live="assertive" className="empty:hidden">
        {error ? <p className="mt-2 text-center text-sm text-error">{error}</p> : null}
      </div>
      <ConfirmDialog
        open={open}
        title="Cancel this booking?"
        description={
          paid
            ? "Your payment will be refunded to the original method. The reserved space will be released."
            : booking.status === "awaiting_agency"
              ? "Your request will be withdrawn. No payment has been taken."
              : "The space held for you will be released. No payment has been taken."
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
