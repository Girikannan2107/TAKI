"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, History, ImageOff, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, Card, EmptyState, FormField, Input, Select, useToast } from "@/components/ui";
import type { DriverHistoryItem } from "@/lib/api/contracts/driver";
import { driverApi } from "@/lib/api/client/driver";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { formatDateTime, formatKg, formatMonth } from "@/lib/format";
import { ListSkeleton, LoadError } from "./parts";
import { useResource } from "./useResource";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The current IST month and the 11 before it, newest first ("2026-11", "2026-10", …). */
function recentMonths(now = new Date()): string[] {
  const ist = new Date(now.getTime() + 330 * 60_000);
  let y = ist.getUTCFullYear();
  let m = ist.getUTCMonth() + 1;
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** History (P3 §4.5): delivered shipments, search by booking ID, filter by month. Filters live in the URL. */
export function DriverHistoryView() {
  const params = useSearchParams();
  const router = useRouter();
  const q = (params.get("q") ?? "").trim();
  const rawMonth = params.get("month") ?? "";
  const month = MONTH_RE.test(rawMonth) ? rawMonth : "";
  const [draft, setDraft] = useState(q);
  const [months] = useState(recentMonths);

  const key = `${q}|${month}`;
  const { state, reload } = useResource((signal) => driverApi.history({ q: q || undefined, month: month || undefined }, signal), key);

  function go(next: { q?: string; month?: string }) {
    router.replace(paths.driver.history({ q: next.q || undefined, month: next.month || undefined }), { scroll: false });
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    go({ q: draft.trim(), month });
  }

  const filtered = !!q || !!month;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <PageHeader title="History" subtitle="Shipments you've delivered." className="mb-0 lg:mb-0" />

      <Card padding="sm" className="sm:p-5">
        <form role="search" aria-label="Search history" onSubmit={onSearch} className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
          <FormField label="Booking ID" htmlFor="history-q">
            <Input
              id="history-q"
              type="search"
              leadingIcon={<Search />}
              placeholder="e.g. TAKI123456"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoComplete="off"
              inputMode="text"
              maxLength={20}
            />
          </FormField>
          <FormField label="Month" htmlFor="history-month">
            <Select
              id="history-month"
              value={month}
              onChange={(e) => go({ q, month: e.target.value })}
              options={[{ value: "", label: "All months" }, ...months.map((m) => ({ value: m, label: formatMonth(m) }))]}
            />
          </FormField>
          <Button type="submit" variant="secondary" className="sm:mb-0">
            Search
          </Button>
        </form>
      </Card>

      <div aria-live="polite">
        {state.status === "loading" ? (
          <ListSkeleton label="Loading history…" />
        ) : state.status === "error" ? (
          <LoadError message={state.message} onRetry={reload} />
        ) : state.data.items.length === 0 ? (
          <EmptyState
            icon={<History />}
            title={filtered ? "No deliveries match" : "No deliveries yet"}
            description={
              filtered
                ? q
                  ? `We couldn't find a delivered shipment with ID “${q}”. Check the ID, or clear the search.`
                  : `You didn't deliver anything in ${formatMonth(month)}.`
                : "Shipments you deliver will be listed here with their proof photos."
            }
            action={filtered ? { label: "Clear filters", onClick: () => { setDraft(""); go({}); } } : { label: "View assigned shipments", href: paths.driver.shipments() }}
          />
        ) : (
          <HistoryList key={key} first={state.data.items} firstCursor={state.data.nextCursor} q={q} month={month} />
        )}
      </div>
    </div>
  );
}

function HistoryList({ first, firstCursor, q, month }: { first: DriverHistoryItem[]; firstCursor: string | null; q: string; month: string }) {
  const { toast } = useToast();
  const [more, setMore] = useState<DriverHistoryItem[]>([]);
  const [cursor, setCursor] = useState(firstCursor);
  const [loading, setLoading] = useState(false);
  const items = [...first, ...more];

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await driverApi.history({ q: q || undefined, month: month || undefined, cursor });
      setMore((m) => [...m, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      toast({ title: "Couldn't load more", description: errorMessage(e), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="sr-only">
        {items.length} {items.length === 1 ? "delivery" : "deliveries"} shown
      </p>
      <ul className="flex flex-col gap-3">
        {items.map((it) => (
          <li key={it.bookingId}>
            <HistoryRow it={it} />
          </li>
        ))}
      </ul>
      {cursor ? (
        <Button variant="outline" onClick={() => void loadMore()} loading={loading} className="self-center">
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function HistoryRow({ it }: { it: DriverHistoryItem }) {
  return (
    <Card as="article" padding="none" interactive>
      <Link
        href={paths.driver.historyRecord(it.bookingId)}
        className="flex min-h-11 items-center gap-3 rounded-[inherit] p-3 outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2 sm:p-4"
      >
        <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted">
          {it.proofThumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- private, access-checked file (never next/image)
            <img src={it.proofThumbUrl} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <ImageOff aria-hidden="true" className="size-5 text-ink-subtle" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-sm font-semibold tabular-nums text-ink">{it.bookingId}</span>
          <span className="block truncate text-sm text-ink">
            {it.pickup.placeName} → {it.drop.placeName}
          </span>
          <span className="block truncate text-[13px] text-ink-muted">
            To {it.receiverName} · {formatKg(it.package.weightKg)}
          </span>
          <span className="block text-[13px] tabular-nums text-ink-muted">{it.deliveredAt ? `Delivered ${formatDateTime(it.deliveredAt)}` : "Delivered"}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-ink-subtle" />
      </Link>
    </Card>
  );
}
