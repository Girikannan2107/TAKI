"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Lock, LogOut, RotateCcw, UserRound } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useLogout } from "@/components/layout/useLogout";
import { Avatar, Badge, Button, Card, ConfirmDialog, FormField, Input, Skeleton, useToast } from "@/components/ui";
import type { Customer, Driver, Role } from "@/lib/domain/types";
import { formatPhone } from "@/lib/format";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { profileFormSchema, type ProfileFormValues } from "@/lib/schemas/profile.schema";
import { errorMessage, marketplace } from "@/lib/services/marketplace";
import { useTakiStore } from "@/lib/store";
import { useCurrentCustomer, useCurrentDriver } from "@/lib/store/selectors";
import { VehicleList } from "./VehicleList";

const ROLE_LABEL: Record<Role, string> = { customer: "Customer", driver: "Lorry Driver" };

/** /customer/profile and /driver/profile (inside the dashboard shells, which already guard the role). */
export function ProfileView({ role }: { role: Role }) {
  const hydrated = useHydrated();
  const customer = useCurrentCustomer();
  const driver = useCurrentDriver();
  const profile = role === "customer" ? customer : driver;

  if (!hydrated || !profile) return <ProfileSkeleton />;

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <PageHeader title="Profile" subtitle="Manage your details and demo account" />
      <div className="flex flex-col gap-6">
        <SummaryCard role={role} profile={profile} />
        <PersonalDetails key={profile.id} role={role} profile={profile} />
        {role === "driver" && driver ? <VehicleList driverId={driver.id} /> : null}
        {role === "driver" ? <PayoutPlaceholder /> : null}
        <AccountActions />
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-[720px] flex-col gap-6">
      <span className="sr-only">Loading profile…</span>
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-28 w-full" rounded="md" />
      <Skeleton className="h-64 w-full" rounded="md" />
    </div>
  );
}

function SummaryCard({ role, profile }: { role: Role; profile: Customer | Driver }) {
  const business = role === "driver" ? (profile as Driver).businessName : null;
  return (
    <Card as="section" aria-label="Account summary" className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <Avatar name={profile.fullName} size="lg" decorative />
      <div className="min-w-0 flex-1">
        <p className="truncate font-heading text-xl font-bold text-ink">{profile.fullName}</p>
        {business ? <p className="truncate text-sm text-ink-muted">{business}</p> : null}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
          <span className="font-medium tabular-nums text-ink">{formatPhone(profile.mobile)}</span>
          <span className="inline-flex items-center gap-1 text-caption text-ink-subtle">
            <Lock aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
            Verified via OTP
          </span>
        </p>
      </div>
      <Badge tone={role === "customer" ? "info" : "success"} size="md" className="self-start sm:self-center">
        {ROLE_LABEL[role]}
      </Badge>
    </Card>
  );
}

function PersonalDetails({ role, profile }: { role: Role; profile: Customer | Driver }) {
  const { toast } = useToast();
  const isDriver = role === "driver";
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema(role)),
    defaultValues: { fullName: profile.fullName, businessName: isDriver ? (profile as Driver).businessName : "" },
  });

  async function onSubmit(values: ProfileFormValues) {
    try {
      const fullName = values.fullName.trim().replace(/\s+/g, " ");
      if (isDriver) {
        const businessName = values.businessName.trim();
        await marketplace.updateDriverProfile({ fullName, businessName });
        reset({ fullName, businessName });
      } else {
        await marketplace.updateCustomerProfile({ fullName });
        reset({ fullName, businessName: "" });
      }
      toast({ tone: "success", title: "Profile updated" });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save your profile", description: errorMessage(e) });
    }
  }

  return (
    <Card as="section" aria-labelledby="personal-details-heading">
      <h2 id="personal-details-heading" className="type-h3 mb-4 text-ink">
        Personal details
      </h2>
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField label="Full name" htmlFor="profile-fullName" error={errors.fullName?.message} required>
          <Input leadingIcon={<UserRound strokeWidth={1.75} />} autoComplete="name" {...register("fullName")} />
        </FormField>
        {isDriver ? (
          <FormField label="Business name" htmlFor="profile-businessName" error={errors.businessName?.message} required>
            <Input leadingIcon={<Building2 strokeWidth={1.75} />} autoComplete="organization" {...register("businessName")} />
          </FormField>
        ) : null}
        <FormField label="Mobile number" htmlFor="profile-mobile" hint="Verified via OTP. Your mobile number can't be changed.">
          <Input
            leadingIcon={<Lock strokeWidth={1.75} />}
            value={formatPhone(profile.mobile)}
            readOnly
            className="tabular-nums text-ink-muted"
          />
        </FormField>
        <FormField label="Account type" htmlFor="profile-role">
          <Input value={ROLE_LABEL[role]} readOnly className="text-ink-muted" />
        </FormField>
        <div className="flex justify-end">
          <Button type="submit" loading={isSubmitting} disabled={!isDirty || isSubmitting} className="w-full sm:w-auto">
            {isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PayoutPlaceholder() {
  return (
    <Card as="section" tone="muted" aria-labelledby="payout-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="payout-heading" className="type-h3 text-ink">
          Payout account
        </h2>
        <Badge tone="neutral">Coming soon</Badge>
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        Bank details aren&apos;t collected in this demo. Payouts on the Earnings page are simulated.
      </p>
    </Card>
  );
}

function AccountActions() {
  const logout = useLogout();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function resetDemo() {
    setConfirmOpen(false);
    // useLogout marks a deliberate sign-out (so the role guard doesn't bounce to login) and goes home.
    logout({ toast: false });
    useTakiStore.getState().resetDemo();
    toast({ tone: "success", title: "Demo data reset", description: "All demo accounts and bookings are back to the start." });
  }

  return (
    <Card as="section" aria-labelledby="account-heading">
      <h2 id="account-heading" className="type-h3 mb-1 text-ink">
        Account
      </h2>
      <p className="mb-4 text-sm text-ink-muted">
        Resetting removes every account, booking and route created in this browser and restores the demo data.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button variant="outline" leadingIcon={<LogOut strokeWidth={1.75} />} onClick={logout} className="sm:flex-1">
          Log out
        </Button>
        <Button variant="danger" leadingIcon={<RotateCcw strokeWidth={1.75} />} onClick={() => setConfirmOpen(true)} className="sm:flex-1">
          Reset demo data
        </Button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Reset demo data?"
        description="This signs you out and deletes all accounts, bookings, routes and payments created in this browser. The original demo data is restored."
        confirmLabel="Reset demo data"
        cancelLabel="Cancel"
        tone="danger"
        onConfirm={resetDemo}
        onCancel={() => setConfirmOpen(false)}
      />
    </Card>
  );
}
