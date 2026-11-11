"use client";

import { useState } from "react";
import { ReceiptText, Wallet } from "lucide-react";
import { Badge, Button, Card, MiniAreaChart, Skeleton, type BadgeTone } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { paths } from "@/lib/config/routes";
import { cityName } from "@/lib/domain/cities";
import { LIMITS } from "@/lib/domain/constants";
import { PAYOUT_STATUS_LABEL } from "@/lib/domain/labels";
import type { PayoutStatus } from "@/lib/domain/types";
import { formatINR, formatInstantDate, formatMonth, formatMonthShort } from "@/lib/format";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { useCurrentDriver, useEarnings } from "@/lib/store/selectors";
import { WithdrawModal } from "./WithdrawModal";

const SETTLEMENTS_PREVIEW = 5;
const PAYOUT_TONE: Record<PayoutStatus, BadgeTone> = { completed: "success", processing: "warning", failed: "danger" };

/** Screen 15 — Earnings (`/driver/earnings`). Every amount is derived from the store. */
export function EarningsView() {
  const hydrated = useHydrated();
  const data = useEarnings();
  const driver = useCurrentDriver();
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  /** Bumped per open so the modal remounts with a fresh amount + idempotency key. */
  const [withdrawSession, setWithdrawSession] = useState(0);
  const [showAllSettlements, setShowAllSettlements] = useState(false);

  const header = <PageHeader title="Earnings" backHref={paths.driver.dashboard} backLabel="Back to dashboard" />;

  if (!hydrated || !data) {
    return (
      <>
        {header}
        <div aria-busy="true" className="flex flex-col gap-5">
          <span className="sr-only">Loading earnings…</span>
          <div className="grid gap-5 lg:grid-cols-2">
            <Skeleton className="h-40 rounded-lg" />
            <Skeleton className="h-40 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </>
    );
  }

  const { summary, settlements, payouts } = data;
  const available = summary.availableForPayout;
  const canWithdraw = available >= LIMITS.minWithdrawal;
  const destination = driver?.payoutAccount ? `${driver.payoutAccount.bankName} ••••${driver.payoutAccount.accountLast4}` : null;
  const shownSettlements = showAllSettlements ? settlements : settlements.slice(0, SETTLEMENTS_PREVIEW);
  const series = summary.monthlySeries;

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
        <section
          aria-labelledby="payout-title"
          data-surface="dark"
          className="flex min-w-0 flex-col justify-between gap-5 rounded-lg bg-green-700 bg-grad-payout p-5 text-white shadow-raised sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 id="payout-title" className="text-base font-medium text-white/90">
                Available for Payout
              </h2>
              <p className="type-amount-xl mt-1 text-white" data-testid="available-payout">
                {formatINR(available)}
              </p>
            </div>
            <Button
              variant="lime"
              size="lg"
              leadingIcon={<Wallet />}
              disabled={!canWithdraw}
              aria-describedby={canWithdraw ? undefined : "withdraw-min-note"}
              onClick={() => {
                setWithdrawSession((n) => n + 1);
                setWithdrawOpen(true);
              }}
            >
              Withdraw
            </Button>
          </div>
          <p id="withdraw-min-note" className="text-sm text-white/85">
            {canWithdraw
              ? "Withdrawals are simulated in this demo — no money moves."
              : `Minimum withdrawal is ${formatINR(LIMITS.minWithdrawal)}.`}
          </p>
        </section>

        <Card as="section" aria-labelledby="breakdown-title" padding="none" className="min-w-0 p-5 sm:p-6">
          <h2 id="breakdown-title" className="sr-only">
            Earnings breakdown
          </h2>
          <dl className="divide-y divide-border">
            <BreakdownRow label="This Month" value={summary.thisMonth} testId="earnings-this-month" />
            <BreakdownRow label="Last Month" value={summary.lastMonth} testId="earnings-last-month" />
            <BreakdownRow label="Total Earnings" value={summary.total} testId="earnings-total" strong />
          </dl>
          {series.length > 1 ? (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-caption font-medium text-ink-muted">Last {series.length} months</p>
              <div aria-hidden="true" className="mt-2">
                <MiniAreaChart data={series.map((m) => m.amount)} tone="onLight" width={480} height={64} ariaLabel="" className="h-16 w-full" />
                <div className="mt-1 flex justify-between text-caption text-ink-subtle">
                  {series.map((m) => (
                    <span key={m.month}>{formatMonthShort(m.month)}</span>
                  ))}
                </div>
              </div>
              <table className="sr-only">
                <caption>Monthly earnings, last {series.length} months</caption>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Earnings</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map((m) => (
                    <tr key={m.month}>
                      <th scope="row">{formatMonth(m.month)}</th>
                      <td>{formatINR(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      </div>

      <Card as="section" aria-labelledby="settlements-title" padding="none" className="mt-5 p-5 sm:p-6 lg:mt-6">
        <h2 id="settlements-title" className="type-h3 text-ink">
          Recent Settlements
        </h2>
        <p className="mt-0.5 text-sm text-ink-muted">Paid = credited to your TAKI balance</p>
        {settlements.length === 0 ? (
          <p className="mt-4 rounded-md bg-surface-muted px-4 py-6 text-center text-sm text-ink-muted">
            No settlements yet — complete a delivery to get paid
          </p>
        ) : (
          <>
            <ul className="mt-4 flex flex-col gap-2.5">
              {shownSettlements.map((s) => (
                <li
                  key={s.id}
                  data-testid="settlement-row"
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md border border-border px-3.5 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:gap-x-4"
                >
                  <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-sm bg-mint-100 text-green-700">
                    <ReceiptText strokeWidth={1.75} className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{s.bookingId}</p>
                    <p className="truncate text-sm text-ink-muted">
                      {cityName(s.sourceCityId)} → {cityName(s.destinationCityId)}
                      <span className="hidden sm:inline"> · {formatInstantDate(s.creditedAt)}</span>
                    </p>
                  </div>
                  <p className="text-right font-heading font-bold tabular-nums text-price">{formatINR(s.amount)}</p>
                  <Badge tone="paid" className="col-start-3 justify-self-end sm:col-start-auto">
                    Paid
                  </Badge>
                </li>
              ))}
            </ul>
            {settlements.length > SETTLEMENTS_PREVIEW ? (
              <Button variant="ghost" className="mt-3" aria-expanded={showAllSettlements} onClick={() => setShowAllSettlements((v) => !v)}>
                {showAllSettlements ? "Show fewer" : `Show all (${settlements.length})`}
              </Button>
            ) : null}
          </>
        )}
      </Card>

      <Card as="section" aria-labelledby="payouts-title" padding="none" className="mt-5 p-5 sm:p-6 lg:mt-6">
        <h2 id="payouts-title" className="type-h3 text-ink">
          Payout history
        </h2>
        {payouts.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No payouts yet. Withdrawals you make appear here.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border" data-testid="payout-history">
            {payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-3">
                <div className="min-w-0">
                  <p className="font-heading font-bold tabular-nums text-ink">{formatINR(p.amount)}</p>
                  <p className="text-sm text-ink-muted">
                    {formatInstantDate(p.requestedAt)} · {p.destinationLabel}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={PAYOUT_TONE[p.status]}>{PAYOUT_STATUS_LABEL[p.status]}</Badge>
                  {p.mode === "demo" ? <Badge tone="neutral">Demo</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {withdrawSession > 0 ? (
        <WithdrawModal
          key={withdrawSession}
          open={withdrawOpen}
          onClose={() => setWithdrawOpen(false)}
          available={available}
          destination={destination}
        />
      ) : null}
    </>
  );
}

function BreakdownRow({ label, value, testId, strong }: { label: string; value: number; testId: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3 first:pt-0">
      <dt className={strong ? "font-semibold text-ink" : "text-ink-muted"}>{label}</dt>
      <dd className="font-heading text-lg font-bold tabular-nums text-ink" data-testid={testId}>
        {formatINR(value)}
      </dd>
    </div>
  );
}
