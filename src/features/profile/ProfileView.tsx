"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ChevronRight, LogOut, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useLogout } from "@/components/layout/useLogout";
import { Button, Card, FormField, Input, Skeleton, useToast } from "@/components/ui";
import { accountApi } from "@/lib/api/client/auth";
import type { CustomerProfileDTO } from "@/lib/api/contracts/auth";
import { CustomerProfilePatch } from "@/lib/api/contracts/auth";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { formatDate } from "@/lib/format";
import { AccountPhotoCard, ChangePasswordCard, ChangePhoneCard, useProfile } from "@/features/account";
import { refreshSession } from "@/features/auth/session";
import { LoadError } from "@/features/customer-shipment/LoadError";

/** `/customer/profile` (P3 §4.3): photo, personal details, mobile, password, payment history, log out. */
export function ProfileView({ role }: { role: "customer" }) {
  const { state, reload, replace } = useProfile<CustomerProfileDTO>();
  const header = <PageHeader title="Profile" subtitle="Manage your account details." />;

  if (state.status === "loading") {
    return (
      <div className="mx-auto w-full max-w-[720px]" aria-busy="true">
        {header}
        <span className="sr-only">Loading profile…</span>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-28 w-full" rounded="md" />
          <Skeleton className="h-56 w-full" rounded="md" />
          <Skeleton className="h-40 w-full" rounded="md" />
        </div>
      </div>
    );
  }
  if (state.status === "error" || state.profile.role !== role) {
    return (
      <div className="mx-auto w-full max-w-[720px]">
        {header}
        <LoadError error={new Error(state.status === "error" ? state.message : "This page is for customer accounts.")} title="We couldn't load your profile" onRetry={reload} />
      </div>
    );
  }
  const p = state.profile;
  return (
    <div className="mx-auto w-full max-w-[720px]">
      {header}
      <div className="flex flex-col gap-6">
        <AccountPhotoCard name={p.fullName} photoUrl={p.photoUrl} onChanged={(photoUrl) => replace({ ...p, photoUrl })} />
        <PersonalDetails key={p.id} profile={p} onSaved={replace} />
        <ChangePhoneCard phoneMasked={p.phoneMasked} onChanged={() => reload()} />
        <ChangePasswordCard />
        <Card as="section" padding="none">
          <Link href={paths.customer.payments} className="flex min-h-14 items-center gap-3 rounded-lg px-5 py-4 hover:bg-surface-muted">
            <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-mint-100 text-green-700">
              <Wallet strokeWidth={1.75} className="size-5" />
            </span>
            <span className="flex-1">
              <span className="block font-semibold text-ink">Payment history</span>
              <span className="block text-sm text-ink-muted">Payments, refunds and receipts</span>
            </span>
            <ChevronRight aria-hidden="true" strokeWidth={1.75} className="size-5 text-ink-subtle" />
          </Link>
        </Card>
        <LogoutCard />
      </div>
    </div>
  );
}

function PersonalDetails({ profile, onSaved }: { profile: CustomerProfileDTO; onSaved(p: CustomerProfileDTO): void }) {
  const { toast } = useToast();
  const [name, setName] = useState(profile.fullName);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== profile.fullName;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = CustomerProfilePatch.safeParse({ fullName: name });
    if (!r.success) {
      setError(r.error.issues[0]?.message);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const next = (await accountApi.updateProfile(r.data)) as CustomerProfileDTO;
      onSaved(next);
      void refreshSession();
      toast({ title: "Profile updated", tone: "success" });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="personal-heading" padding="lg">
      <h2 id="personal-heading" className="type-h3 text-ink">
        Personal details
      </h2>
      <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-5">
        <FormField label="Full name" htmlFor="profile-name" error={error} required>
          <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </FormField>
        <FormField label="Date of birth" htmlFor="profile-dob" hint="Set at sign-up. Contact support to correct it.">
          <Input value={formatDate(profile.dob)} readOnly />
        </FormField>
        <Button type="submit" className="self-start" disabled={!dirty} loading={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </Card>
  );
}

function LogoutCard() {
  const logout = useLogout();
  return (
    <Card as="section" padding="md" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-ink-muted">Signed in on this device.</p>
      <Button variant="outline" onClick={() => void logout()} leadingIcon={<LogOut strokeWidth={1.75} />}>
        Log out
      </Button>
    </Card>
  );
}
