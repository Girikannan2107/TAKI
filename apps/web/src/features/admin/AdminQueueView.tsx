"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Inbox } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, EmptyState, Tabs } from "@/components/ui";
import { AdminReviewStatusSchema, type AdminAgencyListItemDTO, type AdminDriverListItemDTO, type AdminReviewStatus } from "@/lib/api/contracts/admin";
import { adminApi } from "@/lib/api/client/admin";
import { paths } from "@/lib/config/routes";
import { STATE_NAMES } from "@/lib/domain/model";
import { formatInstantDate } from "@/lib/format";
import { ListSkeleton, LoadError, ReviewBadge, useLoad } from "./AdminBits";

const TABS: Array<{ value: AdminReviewStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
];

const LINK_LABEL = { pending: "awaiting agency approval", active: "active", rejected: "rejected by agency", removed: "removed" } as const;

type Row = { kind: "agency"; item: AdminAgencyListItemDTO } | { kind: "driver"; item: AdminDriverListItemDTO };

/** /admin/agencies and /admin/drivers — review queue with status tabs synced to ?status. */
export function AdminQueueView({ kind }: { kind: "agency" | "driver" }) {
  const router = useRouter();
  const parsed = AdminReviewStatusSchema.safeParse(useSearchParams().get("status"));
  const status: AdminReviewStatus = parsed.success ? parsed.data : "pending";
  const { state, reload } = useLoad<Row[]>(
    async () =>
      kind === "agency"
        ? (await adminApi.agencies(status)).items.map((item) => ({ kind: "agency" as const, item }))
        : (await adminApi.drivers(status)).items.map((item) => ({ kind: "driver" as const, item })),
    `${kind}:${status}`,
  );
  const title = kind === "agency" ? "Agencies" : "Drivers";
  const panelId = "admin-queue-panel";

  return (
    <>
      <PageHeader title={title} subtitle={kind === "agency" ? "Travel agencies awaiting or past verification." : "Driver licence and Aadhaar checks."} />
      <Tabs
        ariaLabel={`${title} by status`}
        items={TABS}
        value={status}
        panelId={panelId}
        onChange={(v) => router.replace(kind === "agency" ? paths.admin.agencies(v as AdminReviewStatus) : paths.admin.drivers(v as AdminReviewStatus), { scroll: false })}
        className="mb-5"
      />
      <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-tab-${status}`}>
        {state.status === "loading" ? (
          <ListSkeleton label={`Loading ${title.toLowerCase()}`} />
        ) : state.status === "error" ? (
          <LoadError message={state.message} onRetry={reload} />
        ) : state.data.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-6" />}
            title={status === "pending" ? "Nothing to review" : `No ${status} ${title.toLowerCase()}`}
            description={status === "pending" ? "New sign-ups appear here once they register." : undefined}
          />
        ) : (
          <ul className="flex flex-col gap-3" aria-label={`${title}, ${status}`}>
            {state.data.map((row) => (
              <li key={row.item.id}>
                <QueueRow row={row} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function QueueRow({ row }: { row: Row }) {
  const href = row.kind === "agency" ? paths.admin.agency(row.item.id) : paths.admin.driver(row.item.id);
  const name = row.kind === "agency" ? row.item.agencyName : row.item.fullName;
  const sub =
    row.kind === "agency"
      ? `${row.item.ownerName} · ${row.item.districtName}, ${STATE_NAMES[row.item.state] ?? row.item.state}`
      : row.item.agencyName
        ? `${row.item.agencyName}${row.item.linkStatus ? ` (${LINK_LABEL[row.item.linkStatus]})` : ""}`
        : "No agency";
  const when = row.item.verification.submittedAt
    ? `Submitted ${formatInstantDate(row.item.verification.submittedAt)}`
    : `Signed up ${formatInstantDate(row.item.createdAt)}`;

  return (
    <Card interactive padding="sm" className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink">
          <Link href={href} className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-green-700">
            {name}
          </Link>
        </p>
        <p className="truncate text-sm text-ink-muted">{sub}</p>
        <p className="text-caption text-ink-subtle">{when}</p>
        <div className="mt-1.5 sm:hidden">
          <ReviewBadge verification={row.item.verification} complete={row.item.documentsComplete} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden sm:inline-flex">
          <ReviewBadge verification={row.item.verification} complete={row.item.documentsComplete} />
        </span>
        <ChevronRight aria-hidden="true" className="size-5 text-ink-subtle" />
      </div>
    </Card>
  );
}
