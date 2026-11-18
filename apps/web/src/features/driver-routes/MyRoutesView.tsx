"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Route as RouteIcon, Trash2 } from "lucide-react";
import { Button, ButtonLink, ConfirmDialog, EmptyState, Skeleton, Tabs, useToast } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { agencyApi } from "@/lib/api/client/agency";
import type { AgencyTripListItem, AgencyTripsTabValue, TripListResponse } from "@/lib/api/contracts/agency";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { LoadError } from "@/features/agency/states";
import { useApi } from "@/features/agency/useApi";
import { RouteCard } from "./RouteCard";

const TABS: ReadonlyArray<{ value: AgencyTripsTabValue; label: string; empty: string; hint: string }> = [
  { value: "upcoming", label: "Upcoming", empty: "No upcoming trips", hint: "Publish a trip so customers can book space on it." },
  { value: "active", label: "Active", empty: "No trips on the road", hint: "Trips show here once the driver starts them." },
  { value: "completed", label: "Completed", empty: "No completed trips yet", hint: "Trips you finish will show up here." },
  { value: "cancelled", label: "Cancelled", empty: "No cancelled trips", hint: "Cancelled trips stay here for your records." },
  { value: "drafts", label: "Drafts", empty: "No drafts", hint: "Save a trip as a draft to finish it later." },
];
const PANEL_ID = "trips-panel";

export function parseTripsTab(v: string | null | undefined): AgencyTripsTabValue {
  return TABS.some((t) => t.value === v) ? (v as AgencyTripsTabValue) : "upcoming";
}

function Header() {
  return (
    <PageHeader
      title="Trips"
      actions={
        <ButtonLink href={paths.agency.newTrip()} size="md" variant="accent" leadingIcon={<Plus aria-hidden="true" strokeWidth={2.25} />}>
          Add Trip
        </ButtonLink>
      }
    />
  );
}

export interface MyRoutesViewProps {
  tab?: string;
  /** `?published=<tripId>` after publishing: toast + highlight. */
  published?: string;
}

/** Trips (`/agency/trips?tab=`): Upcoming · Active · Completed · Cancelled · Drafts (P3 §4.4). */
export function MyRoutesView({ tab: tabParam, published }: MyRoutesViewProps = {}) {
  const router = useRouter();
  const { toast } = useToast();
  const tab = parseTripsTab(tabParam);
  const [pages, setPages] = useState<{ key: string; items: AgencyTripListItem[]; cursor: string | null }>({ key: "", items: [], cursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const { state, reload } = useApi<TripListResponse>(`trips:${tab}`, () => agencyApi.trips({ tab, limit: 20 }));
  const [highlightId] = useState(() => published ?? null);
  const announced = useRef(false);
  const [deleting, setDeleting] = useState<AgencyTripListItem | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!highlightId || announced.current || state.status !== "ready") return;
    announced.current = true;
    const trip = state.data.items.find((t) => t.id === highlightId);
    toast({ title: "Trip published", description: trip?.routeLabel, tone: "success" });
    router.replace(paths.agency.trips({ tab }), { scroll: false });
    if (trip) {
      requestAnimationFrame(() => {
        document.querySelector(`[data-route-id="${CSS.escape(highlightId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  }, [highlightId, state, router, tab, toast]);

  if (state.status === "loading") return <MyRoutesSkeleton />;
  if (state.status === "error") {
    return (
      <>
        <Header />
        <LoadError message={state.message} onRetry={reload} title="We couldn't load your trips" />
      </>
    );
  }

  const key = `trips:${tab}`;
  const extra = pages.key === key ? pages.items : [];
  const items = [...state.data.items, ...extra.filter((x) => !state.data.items.some((y) => y.id === x.id))];
  const nextCursor = pages.key === key ? pages.cursor : state.data.nextCursor;
  const meta = TABS.find((t) => t.value === tab)!;

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await agencyApi.trips({ tab, cursor: nextCursor, limit: 20 });
      setPages({ key, items: [...extra, ...res.items], cursor: res.nextCursor });
    } catch (e) {
      toast({ title: "Couldn't load more trips", description: errorMessage(e), tone: "error" });
    } finally {
      setLoadingMore(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await agencyApi.deleteDraft(deleting.id);
      toast({ title: "Draft deleted", tone: "success" });
      setDeleting(null);
      setPages({ key: "", items: [], cursor: null });
      reload();
    } catch (e) {
      toast({ title: "Couldn't delete the draft", description: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <Tabs
        ariaLabel="Filter trips"
        panelId={PANEL_ID}
        value={tab}
        onChange={(v) => router.replace(paths.agency.trips({ tab: parseTripsTab(v) }), { scroll: false })}
        items={TABS.map((t) => ({ value: t.value, label: t.label, count: state.data.counts[t.value] }))}
        className="mb-5"
      />
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={`${PANEL_ID}-tab-${tab}`}>
        {items.length === 0 ? (
          <EmptyState icon={<RouteIcon strokeWidth={1.75} />} title={meta.empty} description={meta.hint} action={{ label: "Add Trip", href: paths.agency.newTrip() }} />
        ) : (
          <>
            <ul className="grid gap-4 xl:grid-cols-2" data-testid="route-list">
              {items.map((t) => (
                <li key={t.id} className="flex [&>*]:w-full">
                  <RouteCard
                    trip={t}
                    highlighted={t.id === highlightId}
                    actions={
                      t.status === "draft" ? (
                        <div className="flex w-full flex-wrap justify-end gap-2">
                          <Button variant="ghost" size="sm" leadingIcon={<Trash2 aria-hidden="true" strokeWidth={2} />} onClick={() => setDeleting(t)}>
                            Delete<span className="sr-only"> draft {t.routeLabel}</span>
                          </Button>
                          <ButtonLink href={paths.agency.newTrip(t.id)} size="sm" leadingIcon={<Pencil aria-hidden="true" strokeWidth={2} />}>
                            Continue editing
                          </ButtonLink>
                        </div>
                      ) : undefined
                    }
                  />
                </li>
              ))}
            </ul>
            {nextCursor ? (
              <div className="mt-5 flex justify-center">
                <Button variant="outline" loading={loadingMore} onClick={loadMore}>
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this draft?"
        description={deleting ? `${deleting.routeLabel} will be removed. This can't be undone.` : undefined}
        confirmLabel="Delete draft"
        tone="danger"
        loading={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

export function MyRoutesSkeleton() {
  return (
    <>
      <Header />
      <div aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">Loading your trips…</span>
        <Skeleton className="h-11 w-full max-w-xl rounded-full" />
        <div className="grid gap-4 xl:grid-cols-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-60 rounded-lg" />
          ))}
        </div>
      </div>
    </>
  );
}
