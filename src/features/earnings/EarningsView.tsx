"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheckBig, Clock3, IndianRupee, ReceiptText } from "lucide-react";
import { Badge, Card, DataList, EmptyState, MiniAreaChart, Skeleton, StatCard, Tabs, type DataListColumn } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { agencyApi } from "@/lib/api/client/agency";
import type { AgencyEarningRowDTO, AgencyEarningsDTO, AgencyPaymentRowDTO, AgencySettlementDTO } from "@/lib/api/contracts/agency";
import { paths, type AgencyEarningsTab } from "@/lib/config/routes";
import { formatDate, formatINR, formatMonth, formatMonthShort } from "@/lib/format";
import { when } from "@/features/agency/format";
import { EARNING_STATUS, PAYMENT_STATUS } from "@/features/agency/labels";
import { LoadError } from "@/features/agency/states";
import { useApi } from "@/features/agency/useApi";

const TABS: ReadonlyArray<{ value: AgencyEarningsTab; label: string }> = [
  { value: "trips", label: "Trips" },
  { value: "bookings", label: "Bookings" },
  { value: "payments", label: "Payments" },
  { value: "settlements", label: "Settlements" },
];
const PANEL_ID = "earnings-panel";

function parseTab(v: string | null | undefined): AgencyEarningsTab {
  return TABS.some((t) => t.value === v) ? (v as AgencyEarningsTab) : "trips";
}

/**
 * Earnings (`/agency/earnings?tab=`, P3 §4.4). Read-only (owner decision): built from delivered bookings,
 * payments and settlements that TAKI ops mark as paid. There is no withdraw action.
 */
export function EarningsView({ tab: tabParam }: { tab?: string } = {}) {
  const router = useRouter();
  const tab = parseTab(tabParam);
  const { state, reload } = useApi("earnings", () => agencyApi.earnings());
  const header = <PageHeader title="Earnings" backHref={paths.agency.dashboard} backLabel="Back to dashboard" subtitle="Your share of delivered bookings. TAKI settles to your bank account." />;

  if (state.status === "loading") {
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
  if (state.status === "error") {
    return (
      <>
        {header}
        <LoadError message={state.message} onRetry={reload} title="We couldn't load your earnings" />
      </>
    );
  }

  const d = state.data;
  const series = d.monthlySeries;
  const counts: Record<AgencyEarningsTab, number> = { trips: d.byTrip.length, bookings: d.byBooking.length, payments: d.payments.length, settlements: d.settlements.length };

  return (
    <>
      {header}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start lg:gap-6">
        <section aria-labelledby="total-title" data-surface="dark" className="flex min-w-0 flex-col gap-3 rounded-lg bg-green-700 bg-grad-payout p-5 text-white shadow-raised sm:p-6">
          <h2 id="total-title" className="text-base font-medium text-white/90">
            Total earned
          </h2>
          <p className="type-amount-xl text-white" data-testid="earnings-total">
            {formatINR(d.summary.total)}
          </p>
          <p className="text-sm text-white/85">
            {d.summary.total === 0 ? "Earnings appear after your first delivery." : "Settlements are processed by TAKI. There is nothing to withdraw here."}
          </p>
        </section>

        <Card as="section" aria-labelledby="trend-title" className="min-w-0">
          <h2 id="trend-title" className="type-h3 text-ink">
            Last {series.length} months
          </h2>
          {series.some((m) => m.amount > 0) ? (
            <>
              <div aria-hidden="true" className="mt-2">
                <MiniAreaChart data={series.map((m) => m.amount)} tone="onLight" width={480} height={64} ariaLabel="" className="h-16 w-full" />
                <div className="mt-1 flex justify-between text-caption text-ink-subtle">
                  {series.map((m) => (
                    <span key={m.month}>{formatMonthShort(m.month)}</span>
                  ))}
                </div>
              </div>
              <table className="sr-only">
                <caption>Monthly earnings</caption>
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
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">No earnings in this period yet.</p>
          )}
        </Card>
      </div>

      <ul className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" data-testid="earnings-stats">
        <li className="flex">
          <StatCard className="w-full" label="This month" value={formatINR(d.summary.thisMonth)} icon={<IndianRupee strokeWidth={1.75} />} />
        </li>
        <li className="flex">
          <StatCard className="w-full" label="Last month" value={formatINR(d.summary.lastMonth)} icon={<ReceiptText strokeWidth={1.75} />} />
        </li>
        <li className="flex">
          <StatCard className="w-full" label="Pending settlement" value={formatINR(d.summary.pending + d.summary.onHold)} icon={<Clock3 strokeWidth={1.75} />} />
        </li>
        <li className="flex">
          <StatCard className="w-full" label="Settled" value={formatINR(d.summary.settled)} icon={<CircleCheckBig strokeWidth={1.75} />} />
        </li>
      </ul>

      <Tabs
        ariaLabel="Earnings breakdown"
        panelId={PANEL_ID}
        value={tab}
        onChange={(v) => router.replace(paths.agency.earnings(parseTab(v)), { scroll: false })}
        items={TABS.map((t) => ({ ...t, count: counts[t.value] }))}
        className="mb-5 mt-6"
      />
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={`${PANEL_ID}-tab-${tab}`}>
        {tab === "trips" ? <TripsTab d={d} /> : tab === "bookings" ? <BookingsTab rows={d.byBooking} /> : tab === "payments" ? <PaymentsTab rows={d.payments} /> : <SettlementsTab rows={d.settlements} />}
      </div>
    </>
  );
}

const link = "font-semibold text-green-700 underline-offset-4 hover:underline";

function TripsTab({ d }: { d: AgencyEarningsDTO }) {
  const cols: DataListColumn<AgencyEarningsDTO["byTrip"][number]>[] = [
    { id: "trip", header: "Trip", cell: (r) => <Link className={link} href={paths.agency.trip(r.tripId)}>{r.routeLabel}</Link> },
    { id: "n", header: "Delivered", cell: (r) => r.deliveredBookings, align: "right" },
    { id: "last", header: "Last delivery", cell: (r) => when(r.lastDeliveredAt) },
    { id: "net", header: "Your earnings", cell: (r) => <strong>{formatINR(r.agencyNet)}</strong>, align: "right" },
  ];
  const recent = [...d.byBooking].sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt)).slice(0, 5);
  return (
    <div className="flex flex-col gap-6">
      <DataList label="Earnings by trip" columns={cols} rows={d.byTrip} rowKey={(r) => r.tripId} empty={<Empty />} />
      {recent.length ? (
        <section aria-labelledby="recent-tx-title">
          <h2 id="recent-tx-title" className="type-h3 mb-3 text-ink">
            Recent transactions
          </h2>
          <BookingsTab rows={recent} />
        </section>
      ) : null}
    </div>
  );
}

function BookingsTab({ rows }: { rows: AgencyEarningRowDTO[] }) {
  const cols: DataListColumn<AgencyEarningRowDTO>[] = [
    { id: "id", header: "Booking", cell: (r) => <Link className={link} href={paths.agency.booking(r.bookingId)}>{r.bookingId}</Link> },
    { id: "route", header: "Route", cell: (r) => r.routeLabel },
    { id: "paid", header: "Customer paid", cell: (r) => formatINR(r.customerPaid), align: "right" },
    { id: "fee", header: "TAKI fee", cell: (r) => formatINR(r.platformFee), align: "right" },
    { id: "net", header: "Net", cell: (r) => <strong>{formatINR(r.agencyNet)}</strong>, align: "right" },
    { id: "status", header: "Status", cell: (r) => <Badge tone={EARNING_STATUS[r.status].tone}>{EARNING_STATUS[r.status].label}</Badge> },
  ];
  return <DataList label="Earnings by booking" columns={cols} rows={rows} rowKey={(r) => r.bookingId} empty={<Empty />} />;
}

function PaymentsTab({ rows }: { rows: AgencyPaymentRowDTO[] }) {
  const cols: DataListColumn<AgencyPaymentRowDTO>[] = [
    { id: "id", header: "Booking", cell: (r) => <Link className={link} href={paths.agency.booking(r.bookingId)}>{r.bookingId}</Link> },
    { id: "amount", header: "Amount", cell: (r) => formatINR(r.amountRupees), align: "right" },
    { id: "method", header: "Method", cell: (r) => r.methodLabel ?? "—" },
    { id: "date", header: "Date", cell: (r) => when(r.paidAt ?? r.createdAt) },
    { id: "status", header: "Status", cell: (r) => <Badge tone={PAYMENT_STATUS[r.status].tone}>{PAYMENT_STATUS[r.status].label}</Badge> },
  ];
  return <DataList label="Customer payments" columns={cols} rows={rows} rowKey={(r) => r.id} empty={<Empty text="No customer payments yet." />} />;
}

function SettlementsTab({ rows }: { rows: AgencySettlementDTO[] }) {
  const cols: DataListColumn<AgencySettlementDTO>[] = [
    { id: "ref", header: "Reference", cell: (r) => r.reference },
    { id: "period", header: "Up to", cell: (r) => formatDate(r.periodThrough) },
    { id: "n", header: "Bookings", cell: (r) => r.bookings, align: "right" },
    { id: "amount", header: "Amount", cell: (r) => <strong>{formatINR(r.amount)}</strong>, align: "right" },
    { id: "date", header: "Settled", cell: (r) => <Badge tone="paid">{when(r.settledAt)}</Badge> },
  ];
  return <DataList label="Settlements" columns={cols} rows={rows} rowKey={(r) => r.id} empty={<Empty text="No settlements yet. TAKI settles delivered bookings periodically." />} />;
}

function Empty({ text = "No earnings yet. They appear after your first delivery." }: { text?: string }) {
  return <EmptyState icon={<ReceiptText strokeWidth={1.75} />} title="Nothing here yet" description={text} headingLevel={3} />;
}
