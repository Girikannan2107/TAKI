"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { Button, Card, FormField, Input, PhoneInput, useToast } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { agencyApi } from "@/lib/api/client/agency";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { fieldErrorsOf } from "./format";

/** Add driver (`/agency/drivers/new`): invite by phone. The driver signs up with that number and is linked to this agency. */
export function DriverInviteView() {
  const router = useRouter();
  const { toast } = useToast();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<{ fullName?: string; phone?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: typeof errors = {};
    if (fullName.trim().length < 2) local.fullName = "Enter the driver's name";
    if (!/^[6-9]\d{9}$/.test(phone.trim())) local.phone = "Enter a valid 10-digit mobile number";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await agencyApi.invite({ fullName: fullName.trim(), phone: phone.trim() });
      toast({ title: "Invite sent", description: `${fullName.trim()} can now sign up as a driver with this number.`, tone: "success" });
      router.push(paths.agency.drivers());
    } catch (err) {
      const f = fieldErrorsOf(err);
      setErrors({ fullName: f.fullName, phone: f.phone ?? (Object.keys(f).length ? undefined : errorMessage(err)) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <PageHeader title="Add driver" backHref={paths.agency.drivers()} backLabel="Back to drivers" />
      <Card as="section" aria-label="Invite a driver" padding="lg">
        <form noValidate onSubmit={submit} className="flex flex-col gap-5">
          <FormField label="Driver's name" htmlFor="invite-name" error={errors.fullName} required>
            <Input id="invite-name" value={fullName} maxLength={60} autoComplete="off" invalid={!!errors.fullName} onChange={(e) => setFullName(e.target.value)} />
          </FormField>
          <FormField label="Mobile number" htmlFor="invite-phone" error={errors.phone} required>
            <PhoneInput id="invite-phone" value={phone} invalid={!!errors.phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} />
          </FormField>
          <p className="flex items-start gap-2 rounded-md bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
            <Info aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-green-700" />
            The driver signs in with this phone number; we&apos;ll ask them to verify it with an OTP, set a password and upload their driving licence,
            Aadhaar and photo. The invite is valid for 14 days.
          </p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.push(paths.agency.drivers())} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Send invite
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
