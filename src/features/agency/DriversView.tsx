"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, IdCard, Mail, Trash2, UserPlus, X } from "lucide-react";
import { Avatar, Badge, Button, ButtonLink, Card, ConfirmDialog, EmptyState, FormField, Modal, Skeleton, Tabs, Textarea, useToast } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { agencyApi } from "@/lib/api/client/agency";
import type { AgencyDriverDTO, InviteDTO } from "@/lib/api/contracts/agency";
import { errorMessage } from "@/lib/api/http";
import { paths, type AgencyDriversTab } from "@/lib/config/routes";
import { formatPhone } from "@/lib/format";
import { when } from "./format";
import { VERIFICATION, plural } from "./labels";
import { LoadError } from "./states";
import { useApi } from "./useApi";

const PANEL_ID = "drivers-panel";

function parseTab(v: string | null | undefined): AgencyDriversTab {
  return v === "pending" ? "pending" : "active";
}

interface DriversData {
  active: AgencyDriverDTO[];
  pending: AgencyDriverDTO[];
  invites: InviteDTO[];
}

async function loadAll(): Promise<DriversData> {
  const [active, pending, invites] = await Promise.all([agencyApi.drivers("active"), agencyApi.drivers("pending"), agencyApi.invites()]);
  return { active: active.items, pending: pending.items, invites: invites.items.filter((i) => i.status === "pending") };
}

/** Drivers (`/agency/drivers?tab=active|pending`, P3 §4.4): approved drivers + invites, and self-registered requests to approve. */
export function DriversView({ tab: tabParam }: { tab?: string } = {}) {
  const router = useRouter();
  const { toast } = useToast();
  const tab = parseTab(tabParam);
  const { state, reload, setData } = useApi("drivers", loadAll);
  const [removing, setRemoving] = useState<AgencyDriverDTO | null>(null);
  const [rejecting, setRejecting] = useState<AgencyDriverDTO | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const header = (
    <PageHeader
      title="Drivers"
      actions={
        <ButtonLink href={paths.agency.newDriver} leadingIcon={<UserPlus aria-hidden="true" strokeWidth={2} />}>
          Add driver
        </ButtonLink>
      }
    />
  );

  if (state.status === "loading") {
    return (
      <>
        {header}
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Loading drivers…</span>
          <Skeleton className="h-11 w-72 rounded-full" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      </>
    );
  }
  if (state.status === "error") {
    return (
      <>
        {header}
        <LoadError message={state.message} onRetry={reload} title="We couldn't load your drivers" />
      </>
    );
  }
  const data = state.data;

  async function approve(d: AgencyDriverDTO) {
    setBusyId(d.id);
    try {
      const nd = await agencyApi.approveDriver(d.id);
      setData({ ...data, pending: data.pending.filter((x) => x.id !== d.id), active: [...data.active, nd] });
      toast({ title: `${d.fullName} approved`, description: "They can now be assigned to trips.", tone: "success" });
    } catch (e) {
      toast({ title: "Couldn't approve the driver", description: errorMessage(e), tone: "error" });
      reload();
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusyId(removing.id);
    try {
      await agencyApi.removeDriver(removing.id);
      setData({ ...data, active: data.active.filter((x) => x.id !== removing.id) });
      toast({ title: `${removing.fullName} removed`, tone: "success" });
      setRemoving(null);
    } catch (e) {
      toast({ title: "Couldn't remove the driver", description: errorMessage(e), tone: "error" });
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(inv: InviteDTO) {
    setBusyId(inv.id);
    try {
      await agencyApi.revokeInvite(inv.id);
      setData({ ...data, invites: data.invites.filter((x) => x.id !== inv.id) });
      toast({ title: "Invite cancelled", tone: "success" });
    } catch (e) {
      toast({ title: "Couldn't cancel the invite", description: errorMessage(e), tone: "error" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {header}
      <Tabs
        ariaLabel="Drivers"
        panelId={PANEL_ID}
        value={tab}
        onChange={(v) => router.replace(paths.agency.drivers(parseTab(v) === "pending" ? "pending" : undefined), { scroll: false })}
        items={[
          { value: "active", label: "Active", count: data.active.length },
          { value: "pending", label: "Pending requests", count: data.pending.length },
        ]}
        className="mb-5"
      />
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={`${PANEL_ID}-tab-${tab}`} className="flex flex-col gap-6">
        {tab === "active" ? (
          <>
            {data.active.length === 0 ? (
              <EmptyState
                icon={<IdCard strokeWidth={1.75} />}
                title="No drivers yet"
                description="Invite drivers by phone number, or approve drivers who choose your agency when they sign up."
                action={{ label: "Add driver", href: paths.agency.newDriver }}
              />
            ) : (
              <ul className="flex flex-col gap-3" data-testid="driver-list">
                {data.active.map((d) => (
                  <DriverRow key={d.id} d={d}>
                    <ButtonLink href={paths.agency.driver(d.id)} variant="outline" size="sm">
                      View<span className="sr-only"> {d.fullName}</span>
                    </ButtonLink>
                    <Button variant="ghost" size="sm" leadingIcon={<Trash2 aria-hidden="true" strokeWidth={2} />} onClick={() => setRemoving(d)} disabled={busyId === d.id}>
                      Remove<span className="sr-only"> {d.fullName}</span>
                    </Button>
                  </DriverRow>
                ))}
              </ul>
            )}
            {data.invites.length ? (
              <section aria-labelledby="invites-title">
                <h2 id="invites-title" className="type-h3 mb-3 text-ink">
                  Invites sent
                </h2>
                <ul className="flex flex-col gap-3" data-testid="invite-list">
                  {data.invites.map((i) => (
                    <Card as="li" key={i.id} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-mint-100 text-green-700">
                          <Mail strokeWidth={1.75} className="size-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">{i.fullName}</p>
                          <p className="text-sm text-ink-muted">
                            {formatPhone(i.phone)} · expires {when(i.expiresAt)}
                          </p>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" loading={busyId === i.id} onClick={() => void revoke(i)}>
                        Cancel invite<span className="sr-only"> for {i.fullName}</span>
                      </Button>
                    </Card>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : data.pending.length === 0 ? (
          <EmptyState icon={<IdCard strokeWidth={1.75} />} title="No pending requests" description="Drivers who sign up and choose your agency appear here for approval." />
        ) : (
          <ul className="flex flex-col gap-3" data-testid="driver-requests">
            {data.pending.map((d) => (
              <DriverRow key={d.id} d={d} pending>
                <Button size="sm" leadingIcon={<Check aria-hidden="true" strokeWidth={2} />} loading={busyId === d.id} onClick={() => void approve(d)}>
                  Approve<span className="sr-only"> {d.fullName}</span>
                </Button>
                <Button variant="outline" size="sm" leadingIcon={<X aria-hidden="true" strokeWidth={2} />} disabled={busyId === d.id} onClick={() => setRejecting(d)}>
                  Reject<span className="sr-only"> {d.fullName}</span>
                </Button>
              </DriverRow>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={removing !== null}
        title="Remove this driver?"
        description={removing ? `${removing.fullName} will be unlinked from your agency. Drivers on upcoming or active trips can't be removed; reassign those trips first.` : undefined}
        confirmLabel="Remove driver"
        tone="danger"
        loading={busyId === removing?.id}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
      <RejectDriverModal
        driver={rejecting}
        onClose={() => setRejecting(null)}
        onDone={() => {
          const id = rejecting?.id;
          setRejecting(null);
          setData({ ...data, pending: data.pending.filter((x) => x.id !== id) });
        }}
      />
    </>
  );
}

function DriverRow({ d, pending, children }: { d: AgencyDriverDTO; pending?: boolean; children: ReactNode }) {
  const v = VERIFICATION[d.verification];
  return (
    <Card as="li" padding="sm" className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between" data-testid="driver-row">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={d.fullName} src={d.photoUrl ?? undefined} />
        <div className="min-w-0">
          <p className="font-semibold text-ink">
            {pending ? (
              d.fullName
            ) : (
              <Link href={paths.agency.driver(d.id)} className="underline-offset-4 hover:underline">
                {d.fullName}
              </Link>
            )}
          </p>
          <p className="text-sm text-ink-muted">
            <a href={`tel:${d.phone}`} className="underline-offset-4 hover:underline">
              {formatPhone(d.phone)}
            </a>
            {d.license.numberMasked ? ` · DL ${d.license.numberMasked}` : ""}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <Badge tone={v.tone}>{d.verification === "verified" ? "Documents verified" : v.label}</Badge>
            {pending ? (
              <span>Requested {when(d.link.requestedAt)}</span>
            ) : d.availability === "unavailable" ? (
              <Badge tone="neutral">Unavailable</Badge>
            ) : d.nextAssignment ? (
              <span>
                Next trip {when(d.nextAssignment.from)} – {when(d.nextAssignment.to)}
              </span>
            ) : (
              <span>Free</span>
            )}
            {!pending && d.stats.delivered ? <span>· {plural(d.stats.delivered, "delivery", "deliveries")}</span> : null}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">{children}</div>
    </Card>
  );
}

function RejectDriverModal({ driver, onClose, onDone }: { driver: AgencyDriverDTO | null; onClose(): void; onDone(): void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!driver) return;
    setBusy(true);
    try {
      await agencyApi.rejectDriver(driver.id, reason.trim() || undefined);
      toast({ title: "Request rejected", description: `${driver.fullName} has been notified.`, tone: "success" });
      setReason("");
      onDone();
    } catch (e) {
      toast({ title: "Couldn't reject the request", description: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={driver !== null}
      onClose={onClose}
      title={driver ? `Reject ${driver.fullName}?` : "Reject request?"}
      description="The driver is notified and can request another agency."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={submit}>
            Reject
          </Button>
        </>
      }
    >
      <FormField label="Reason" htmlFor="driver-reject-reason" optionalLabel>
        <Textarea id="driver-reject-reason" maxLength={300} showCount value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
    </Modal>
  );
}
