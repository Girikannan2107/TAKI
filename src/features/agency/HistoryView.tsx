"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, IdCard, Route as RouteIcon, Search, Truck, UserRound } from "lucide-react";
import { Badge, Button, Card, DataList, EmptyState, FormField, Input, Select, Skeleton, useToast, type BadgeTone, type DataListColumn } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { agencyApi } from "@/lib/api/client/agency";
import { HISTORY_TYPES, type HistoryRow, type HistoryType } from "@/lib/api/contracts/agency";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import type { BookingStatus, TripStatus } from "@/lib/domain/model";
import { when } from "./format";
import { BOOKING_STATUS, TRIP_STATUS } from "./labels";
import { LoadError } from "./states";
import { useApi } from "./useApi";

const TYPE_LABEL: Record<HistoryType, string> = { bookings: "Shipments", trips: "Trips", vehicles: "Vehicles", drivers: "Drivers", customers: "Customers" };
const TYPE_ICON: Record<HistoryType, typeof Truck> = { bookings: ClipboardList, trips: RouteIcon, vehicles: Truck, drivers: IdCard, customers: UserRound };

function parseType(v: string | undefined): HistoryType {
  return (HISTORY_TYPES as readonly string[]).includes(v ?? "") ? (v as HistoryType) : "bookings";
}
const isDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

function statusBadge(row: HistoryRow): { label: string; tone: BadgeTone } | null {
  if (!row.status) return null;
  if (row.type === "bookings" && row.status in BOOKING_STATUS) return BOOKING_STATUS[row.status as BookingStatus];
  if (row.type === "trips" && row.status in TRIP_STATUS) return TRIP_STATUS[row.status as TripStatus];
  return { label: row.status.replace(/_/g, " "), tone: "neutral" };
}

function hrefOf(row: HistoryRow): string | null {
  if (!row.link) return null;
  switch (row.link.type) {
    case "booking":
      return paths.agency.booking(row.link.id);
    case "trip":
      return paths.agency.trip(row.link.id);
    case "vehicle":
      return paths.agency.vehicle(row.link.id);
    case "driver":
      return paths.agency.driver(row.link.id);
  }
}

export interface HistoryViewProps {
  q?: string;
  type?: string;
  from?: string;
  to?: string;
}

/** History (`/agency/history?q=&type=&from=&to=`, P3 §4.4): searchable shipments, trips, vehicles, drivers and customers. */
export function HistoryView(props: HistoryViewProps) {
  const router = useRouter();
  const { toast } = useToast();
  const type = parseType(props.type);
  const q = (props.q ?? "").slice(0, 60);
  const from = isDate(props.from);
  const to = isDate(props.to);
  const [text, setText] = useState(q);
  const key = JSON.stringify({ q, type, from, to });
  const { state, reload, setData } = useApi(key, () => agencyApi.history({ q: q || undefined, type, from: from || undefined, to: to || undefined, limit: 20 }));
  const [loadingMore, setLoadingMore] = useState(false);

  function go(next: Partial<{ q: string; type: string; from: string; to: string }>) {
    const merged = { q, type, from, to, ...next };
    router.replace(paths.agency.history({ q: merged.q || undefined, type: merged.type === "bookings" ? undefined : merged.type, from: merged.from || undefined, to: merged.to || undefined }), { scroll: false });
  }

  // 300 ms debounce from the search box to the URL.
  useEffect(() => {
    if (text.trim() === q) return;
    const t = setTimeout(() => go({ q: text.trim() }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  async function loadMore() {
    if (state.status !== "ready" || !state.data.nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await agencyApi.history({ q: q || undefined, type, from: from || undefined, to: to || undefined, cursor: state.data.nextCursor, limit: 20 });
      setData({ items: [...state.data.items, ...res.items], nextCursor: res.nextCursor });
    } catch (e) {
      toast({ title: "Couldn't load more", description: errorMessage(e), tone: "error" });
    } finally {
      setLoadingMore(false);
    }
  }

  const cols: DataListColumn<HistoryRow>[] = [
    {
      id: "item",
      header: TYPE_LABEL[type],
      cell: (r) => {
        const Icon = TYPE_ICON[r.type];
        const href = hrefOf(r);
        return (
          <span className="flex min-w-0 items-start gap-2">
            <Icon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-green-600" />
            <span className="min-w-0">
              {href ? (
                <Link href={href} className="font-semibold text-ink underline-offset-4 hover:underline">
                  {r.title}
                </Link>
              ) : (
                <span className="font-semibold text-ink">{r.title}</span>
              )}
              <span className="block text-sm text-ink-muted">{r.subtitle}</span>
            </span>
          </span>
        );
      },
    },
    { id: "date", header: "Date", cell: (r) => when(r.date), className: "whitespace-nowrap" },
    {
      id: "status",
      header: "Status",
      cell: (r) => {
        const b = statusBadge(r);
        return b ? <Badge tone={b.tone}>{b.label}</Badge> : null;
      },
    },
  ];

  return (
    <>
      <PageHeader title="History" subtitle="Search past and current shipments, trips, vehicles, drivers and customers." />
      <Card padding="sm" className="mb-5">
        <form role="search" onSubmit={(e) => (e.preventDefault(), go({ q: text.trim() }))} className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <FormField label="Search" htmlFor="history-q">
            <Input id="history-q" type="search" leadingIcon={<Search aria-hidden="true" strokeWidth={1.75} />} placeholder="Booking ID, name, registration, place…" value={text} maxLength={60} onChange={(e) => setText(e.target.value)} />
          </FormField>
          <FormField label="Type" htmlFor="history-type">
            <Select id="history-type" value={type} options={HISTORY_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} onChange={(e) => go({ type: e.target.value })} />
          </FormField>
          <FormField label="From" htmlFor="history-from">
            <Input id="history-from" type="date" value={from} max={to || undefined} onChange={(e) => go({ from: e.target.value })} />
          </FormField>
          <FormField label="To" htmlFor="history-to">
            <Input id="history-to" type="date" value={to} min={from || undefined} onChange={(e) => go({ to: e.target.value })} />
          </FormField>
        </form>
      </Card>

      {state.status === "loading" ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Searching…</span>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-md" />
          ))}
        </div>
      ) : state.status === "error" ? (
        <LoadError message={state.message} onRetry={reload} />
      ) : (
        <DataList
          label={`${TYPE_LABEL[type]} history`}
          columns={cols}
          rows={state.data.items}
          rowKey={(r) => `${r.type}:${r.id}`}
          empty={
            <EmptyState
              icon={<Search strokeWidth={1.75} />}
              title={q ? `No results for '${q}'` : `No ${TYPE_LABEL[type].toLowerCase()} yet`}
              description={q || from || to ? "Try a different search or date range." : undefined}
              headingLevel={3}
            />
          }
          footer={
            state.data.nextCursor ? (
              <div className="flex justify-center py-3">
                <Button variant="outline" loading={loadingMore} onClick={loadMore}>
                  Load more
                </Button>
              </div>
            ) : undefined
          }
        />
      )}
    </>
  );
}
