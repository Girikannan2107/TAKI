"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, PackageCheck, PackagePlus, Truck } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { useShellSession } from "@/components/layout/useShellSession";
import { ButtonLink, Card, Skeleton, StatCard } from "@/components/ui";
import { customerApi } from "@/lib/api/client/customer";
import { paths } from "@/lib/config/routes";
import { addDaysIso, todayIst } from "@/lib/domain/dates";
import { firstName } from "@/lib/format";
import { searchToFormValues, toSearch, type ShipmentFormValues } from "@/lib/schemas/shipment-search.schema";
import { LoadError } from "@/features/customer-shipment/LoadError";
import { useApi } from "@/features/customer-shipment/use-api";
import { newShipmentHref, vehiclesHref } from "@/features/customer-shipment/urls";
import { RecentShipments } from "./RecentShipments";
import { ShipmentForm } from "./ShipmentForm";

/**
 * Customer dashboard (P3 §4.3): stats, a "Quick ship" card and recent activity.
 * Guests (public path) get the quick-ship card only; it runs a guest search.
 */
export function DashboardView() {
  const session = useShellSession();
  const customer = session.signedIn && session.role === "customer";
  const dash = useApi(customer ? "customer:dashboard" : null, (signal) => customerApi.dashboard(signal));
  const name = dash.data?.firstName || (session.user ? firstName(session.user.name) : "");

  return (
    <>
      <TopBar
        title={!session.ready ? <Skeleton className="h-9 w-48" /> : name ? `Hi, ${name}` : "Hi there"}
        emoji={name ? "👋" : undefined}
        subtitle="Where are we shipping today?"
      />

      {customer ? (
        dash.error ? (
          <LoadError error={dash.error} title="We couldn't load your dashboard" onRetry={() => void dash.reload()} className="mb-6" />
        ) : (
          <section aria-label="Shipment summary" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {dash.data ? (
              <>
                <StatCard
                  label="Active shipments"
                  value={dash.data.counts.confirmed + dash.data.counts.picked_up + dash.data.counts.in_transit}
                  icon={<Truck strokeWidth={1.75} />}
                  href={paths.customer.shipmentsTab("in_transit")}
                />
                <StatCard label="Completed" value={dash.data.counts.delivered} icon={<PackageCheck strokeWidth={1.75} />} href={paths.customer.shipmentsTab("delivered")} />
                <StatCard label="Pending bookings" value={dash.data.counts.pending} icon={<Clock strokeWidth={1.75} />} href={paths.customer.shipmentsTab("pending")} />
              </>
            ) : (
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-[104px] rounded-lg" />)
            )}
          </section>
        )
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,720px)_minmax(0,1fr)] xl:gap-8">
        <Card as="section" padding="lg" aria-labelledby="quick-ship-heading" className="w-full max-w-[720px]">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 id="quick-ship-heading" className="type-h3 text-ink">
              Quick ship
            </h2>
            {customer ? (
              <ButtonLink href={paths.customer.newShipment()} variant="accent" size="sm" leadingIcon={<PackagePlus strokeWidth={1.75} />}>
                New Shipment
              </ButtonLink>
            ) : null}
          </div>
          {session.ready ? <QuickShipForm signedIn={customer} /> : <FormSkeleton />}
        </Card>
        {customer ? (
          dash.data ? (
            <RecentShipments active={dash.data.active} activity={dash.data.recentActivity} className="w-full max-w-[720px] xl:max-w-none" />
          ) : dash.loading ? (
            <Skeleton className="h-64 w-full max-w-[720px] rounded-lg xl:max-w-none" />
          ) : null
        ) : null}
      </div>
    </>
  );
}

/**
 * Signed in: "Continue" opens New Shipment prefilled (the full form saves the shipment).
 * Guest: searches vehicles directly; requesting one later asks them to log in.
 */
function QuickShipForm({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  // Computed once so defaults don't shift while typing.
  const [{ today, defaults }] = useState(() => {
    const t = todayIst(new Date());
    const values: ShipmentFormValues = searchToFormValues({}, addDaysIso(t, 1));
    return { today: t, defaults: values };
  });

  return (
    <ShipmentForm
      today={today}
      defaultValues={defaults}
      submitLabel={signedIn ? "Continue" : "Find Available Vehicles"}
      submittingLabel={signedIn ? "Opening…" : "Finding vehicles…"}
      onSubmit={(values) => {
        const criteria = toSearch(values);
        // Guests search directly when both places are known (Google Places); otherwise the New Shipment form
        // (login first) resolves the typed places server-side.
        router.push(signedIn || !criteria.from || !criteria.to ? newShipmentHref(criteria) : vehiclesHref({ criteria }));
      }}
    />
  );
}

function FormSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <span className="sr-only">Loading shipment form…</span>
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-12" />
        </div>
      ))}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-12" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-1 h-13" />
    </div>
  );
}
