"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Landmark } from "lucide-react";
import { Button, FormField, Input, Modal, useToast } from "@/components/ui";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { paths } from "@/lib/config/routes";
import { LIMITS } from "@/lib/domain/constants";
import { formatINR } from "@/lib/format";
import { errorMessage, marketplace } from "@/lib/services/marketplace";
import { withdrawAmountSchema } from "./withdraw.schema";

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `pyo-${crypto.randomUUID()}`
    : `pyo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface WithdrawModalProps {
  open: boolean;
  onClose(): void;
  available: number;
  /** "HDFC Bank ••••4321", or null when the driver has no payout account. */
  destination: string | null;
}

/**
 * DEMO payout dialog. Mount it with a fresh `key` per open so the amount and the
 * idempotency key reset each time (one key per modal open → one Payout).
 */
export function WithdrawModal({ open, onClose, available, destination }: WithdrawModalProps) {
  const { toast } = useToast();
  const [idempotencyKey] = useState(newKey);
  const [amount, setAmount] = useState(String(available));
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const parsed = withdrawAmountSchema(available).safeParse(amount);
  const fieldError = touched && !parsed.success ? parsed.error.issues[0]?.message : undefined;

  function close() {
    if (!submitting) onClose();
  }

  async function confirm(e?: FormEvent) {
    e?.preventDefault();
    setTouched(true);
    if (!parsed.success || !destination || submitting) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await marketplace.requestPayout(parsed.data, idempotencyKey);
      toast({
        title: "Demo payout simulated — no money moved",
        description: `${formatINR(parsed.data)} to ${destination}`,
        tone: "success",
      });
      onClose();
    } catch (err) {
      setServerError(errorMessage(err, "We couldn't simulate this payout. Please try again."));
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Withdraw earnings"
      description={`Available for payout: ${formatINR(available)}`}
      hideClose={submitting}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={submitting} fullWidth className="sm:w-auto">
            Cancel
          </Button>
          <Button
            type="submit"
            form="withdraw-form"
            loading={submitting}
            disabled={!destination}
            fullWidth
            className="sm:w-auto"
          >
            {submitting ? "Processing…" : "Confirm withdrawal"}
          </Button>
        </>
      }
    >
      <form id="withdraw-form" noValidate onSubmit={confirm} className="flex flex-col gap-4">
        <DemoBanner kind="payout">This simulates a payout to show the flow. Nothing is sent to your bank.</DemoBanner>
        <FormField
          label="Amount"
          htmlFor="withdraw-amount"
          hint={`Whole rupees, from ${formatINR(LIMITS.minWithdrawal)} up to ${formatINR(available)}`}
          error={fieldError}
          required
        >
          <Input
            inputMode="numeric"
            autoComplete="off"
            prefix="₹"
            value={amount}
            disabled={submitting}
            onChange={(ev) => {
              setAmount(ev.target.value);
              setServerError(null);
            }}
            onBlur={() => setTouched(true)}
          />
        </FormField>
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface-muted px-4 py-3">
          <Landmark aria-hidden="true" strokeWidth={1.75} className="size-5 shrink-0 text-green-700" />
          {destination ? (
            <p className="min-w-0 text-sm">
              <span className="text-ink-muted">To </span>
              <span className="font-semibold text-ink" data-testid="payout-destination">
                {destination}
              </span>
            </p>
          ) : (
            <p className="min-w-0 text-sm text-ink">
              No payout account yet.{" "}
              <Link href={paths.driver.profile} className="font-semibold text-green-700 underline underline-offset-4">
                Add bank details in Profile
              </Link>
            </p>
          )}
        </div>
        {serverError ? (
          <p role="alert" className="rounded-md bg-danger-100 px-4 py-3 text-sm font-medium text-error">
            {serverError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
