"use client";

import { Banknote, Building2, FileWarning, IdCard } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, StatCard } from "@/components/ui";
import type { AdminOverviewDTO } from "@/lib/api/contracts/admin";
import { adminApi } from "@/lib/api/client/admin";
import { paths } from "@/lib/config/routes";
import { formatINR } from "@/lib/format";
import { ListSkeleton, LoadError, useLoad } from "./AdminBits";

/** /admin — review queue counts and settlements at a glance. */
export function AdminOverviewView() {
  const { state, reload } = useLoad<AdminOverviewDTO>(() => adminApi.overview(), "overview");

  return (
    <>
      <TopBar title="Admin overview" subtitle="Verify agencies and drivers, and record settlements." />
      {state.status === "loading" ? (
        <ListSkeleton rows={3} label="Loading overview" />
      ) : state.status === "error" ? (
        <LoadError message={state.message} onRetry={reload} />
      ) : (
        <div className="flex flex-col gap-6">
          <section aria-labelledby="queues-title">
            <h2 id="queues-title" className="type-h3 mb-3 text-ink">
              Review queues
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Agencies ready for review" value={state.data.agencies.awaitingReview} icon={<Building2 />} href={paths.admin.agencies("pending")} />
              <StatCard label="Drivers ready for review" value={state.data.drivers.awaitingReview} icon={<IdCard />} href={paths.admin.drivers("pending")} />
              <StatCard label="Agencies without documents" value={state.data.agencies.awaitingDocuments} icon={<FileWarning />} href={paths.admin.agencies("pending")} />
              <StatCard label="Drivers without documents" value={state.data.drivers.awaitingDocuments} icon={<FileWarning />} href={paths.admin.drivers("pending")} />
            </div>
          </section>
          <section aria-labelledby="settlements-title">
            <h2 id="settlements-title" className="type-h3 mb-3 text-ink">
              Settlements
            </h2>
            {state.data.settlements ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <StatCard label="Pending payouts" value={formatINR(state.data.settlements.pendingAmount)} icon={<Banknote />} href={paths.admin.settlements} />
                <StatCard label="Agencies with pending earnings" value={state.data.settlements.agencies} icon={<Building2 />} href={paths.admin.settlements} />
              </div>
            ) : (
              <Card tone="muted" padding="sm">
                <p className="text-sm text-ink-muted">Settlement totals aren&apos;t available yet.</p>
              </Card>
            )}
          </section>
        </div>
      )}
    </>
  );
}
