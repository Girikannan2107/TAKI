"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Route as RouteIcon } from "lucide-react";
import { ButtonLink, EmptyState, Skeleton, Tabs, useToast } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { paths } from "@/lib/config/routes";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { useDriverRoutes, type DriverRouteSummary } from "@/lib/store/selectors";
import { RouteCard } from "./RouteCard";

type StatusFilter = "active" | "completed" | "all";
const PANEL_ID = "my-routes-panel";

function parseStatus(v: string | null): StatusFilter {
  return v === "completed" || v === "all" ? v : "active";
}

function matches(s: DriverRouteSummary, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "completed") return s.route.status === "completed";
  return s.route.status === "published";
}

function routesHref(status: StatusFilter): string {
  return paths.driver.routes({ status: status === "active" ? undefined : status });
}

function Header() {
  return (
    <PageHeader
      title="My Routes"
      actions={
        <ButtonLink href={paths.driver.newRoute} size="md" leadingIcon={<Plus aria-hidden="true" strokeWidth={2.25} />}>
          Add New Route
        </ButtonLink>
      }
    />
  );
}

/** My Routes (`/driver/routes`): tabs via `?status=`, highlight + toast for `?published=<id>`. */
export function MyRoutesView() {
  const hydrated = useHydrated();
  const routes = useDriverRoutes();
  const params = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const status = parseStatus(params.get("status"));
  // Captured once from the URL; the param itself is dropped after the toast.
  const [highlightId] = useState(() => params.get("published"));
  const announced = useRef(false);

  useEffect(() => {
    if (!hydrated || !highlightId || announced.current) return;
    announced.current = true;
    const published = routes.find((r) => r.route.id === highlightId);
    toast({ title: "Route published", description: published?.pathLabel, tone: "success" });
    router.replace(routesHref(status), { scroll: false });
    if (published) {
      requestAnimationFrame(() => {
        document.querySelector(`[data-route-id="${CSS.escape(highlightId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  }, [hydrated, highlightId, routes, router, status, toast]);

  if (!hydrated) return <MyRoutesSkeleton />;

  if (routes.length === 0) {
    return (
      <>
        <Header />
        <EmptyState
          icon={<RouteIcon strokeWidth={1.75} />}
          title="You haven't listed a route yet"
          description="Post the trip you're already making and let customers book your spare space."
          action={{ label: "Post a New Route", href: paths.driver.newRoute }}
        />
      </>
    );
  }

  const counts = {
    active: routes.filter((r) => matches(r, "active")).length,
    completed: routes.filter((r) => matches(r, "completed")).length,
    all: routes.length,
  };
  const visible = routes.filter((r) => matches(r, status));

  return (
    <>
      <Header />
      <Tabs
        ariaLabel="Filter routes"
        panelId={PANEL_ID}
        value={status}
        onChange={(v) => router.replace(routesHref(parseStatus(v)), { scroll: false })}
        items={[
          { value: "active", label: "Active", count: counts.active },
          { value: "completed", label: "Completed", count: counts.completed },
          { value: "all", label: "All", count: counts.all },
        ]}
        className="mb-5"
      />
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={`${PANEL_ID}-tab-${status}`}>
        {visible.length === 0 ? (
          <EmptyState
            icon={<RouteIcon strokeWidth={1.75} />}
            title={status === "completed" ? "No completed trips yet" : "No active routes"}
            description={
              status === "completed"
                ? "Routes you finish will show up here."
                : "Post your next trip so customers can book space on it."
            }
            action={{ label: "Post a New Route", href: paths.driver.newRoute }}
          />
        ) : (
          <ul className="grid gap-4 xl:grid-cols-2" data-testid="route-list">
            {visible.map((s) => (
              <li key={s.route.id} className="flex [&>*]:w-full">
                <RouteCard summary={s} highlighted={s.route.id === highlightId} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export function MyRoutesSkeleton() {
  return (
    <>
      <Header />
      <div aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">Loading your routes…</span>
        <Skeleton className="h-11 w-72 rounded-full" />
        <div className="grid gap-4 xl:grid-cols-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-60 rounded-lg" />
          ))}
        </div>
      </div>
    </>
  );
}
