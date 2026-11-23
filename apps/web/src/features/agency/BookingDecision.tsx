"use client";

import { useState } from "react";
import { Button, ConfirmDialog, FormField, Modal, Select, Textarea, useToast } from "@/components/ui";
import { agencyApi } from "@/lib/api/client/agency";
import { REJECT_REASONS, type AgencyBookingDTO, type AgencyBookingListItem } from "@/lib/api/contracts/agency";
import { errorMessage, isApiError } from "@/lib/api/http";
import { formatKg } from "@/lib/format";

type Target = Pick<AgencyBookingListItem, "id" | "weightKg" | "vehicleReg" | "customerName">;

/** Accept confirmation: "Reserve 300 kg on TN 37 XX 4587?" → POST accept (core reserves capacity atomically). */
export function AcceptBookingDialog({ booking, onClose, onDone, onStale }: { booking: Target | null; onClose(): void; onDone(b: AgencyBookingDTO): void; onStale?(): void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function accept() {
    if (!booking) return;
    setBusy(true);
    try {
      const b = await agencyApi.acceptBooking(booking.id);
      toast({ title: "Booking accepted", description: `${formatKg(booking.weightKg)} reserved. ${booking.customerName} has been asked to pay.`, tone: "success" });
      onDone(b);
    } catch (e) {
      const capacity = isApiError(e) && e.code === "insufficient_capacity";
      toast({ title: capacity ? "Not enough space left — capacity changed" : "Couldn't accept the booking", description: errorMessage(e), tone: "error" });
      onClose();
      onStale?.();
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmDialog
      open={booking !== null}
      title={booking ? `Reserve ${formatKg(booking.weightKg)} on ${booking.vehicleReg}?` : "Accept booking?"}
      description="The customer is notified and gets a limited time to pay. Driver and vehicle details are shared once they pay."
      confirmLabel="Accept booking"
      loading={busy}
      onConfirm={accept}
      onCancel={onClose}
    />
  );
}

/** Reject with a reason (No space / Goods not accepted / Schedule change / Other + note). The customer is notified. */
export function RejectBookingModal({ booking, onClose, onDone }: { booking: Target | null; onClose(): void; onDone(b: AgencyBookingDTO): void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<{ reason?: string; note?: string }>({});
  const [busy, setBusy] = useState(false);

  function close() {
    setReason("");
    setNote("");
    setError({});
    onClose();
  }

  async function submit() {
    if (!booking) return;
    if (!reason) return setError({ reason: "Select why you're rejecting this request" });
    if (reason === "Other" && note.trim().length < 3) return setError({ note: "Tell the customer why (at least 3 characters)" });
    const text = reason === "Other" ? note.trim() : note.trim() ? `${reason}: ${note.trim()}` : reason;
    setBusy(true);
    setError({});
    try {
      const b = await agencyApi.rejectBooking(booking.id, text.slice(0, 300));
      toast({ title: "Booking rejected", description: "The customer has been notified.", tone: "success" });
      setReason("");
      setNote("");
      onDone(b);
    } catch (e) {
      setError({ note: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={booking !== null}
      onClose={close}
      title="Reject this request?"
      description={booking ? `${booking.id} · ${formatKg(booking.weightKg)}. The customer is notified with your reason.` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={submit}>
            Reject request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="Reason" htmlFor="reject-reason" error={error.reason} required>
          <Select
            id="reject-reason"
            placeholder="Choose a reason"
            value={reason}
            invalid={!!error.reason}
            options={REJECT_REASONS.map((r) => ({ value: r, label: r }))}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
        <FormField label="Note for the customer" htmlFor="reject-note" error={error.note} required={reason === "Other"} optionalLabel={reason !== "Other"}>
          <Textarea id="reject-note" maxLength={250} showCount value={note} invalid={!!error.note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}
