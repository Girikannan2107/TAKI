"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Pencil, Plus, Trash2, Truck } from "lucide-react";
import { Badge, Button, ButtonLink, Card, ConfirmDialog, EmptyState, Skeleton, useToast, type BadgeTone } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { agencyApi } from "@/lib/api/client/agency";
import type { VehicleDTO } from "@/lib/api/contracts/agency";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { vehicleImageSrc } from "@/lib/domain/vehicles";
import { formatKg } from "@/lib/format";
import { BODY_TYPE_LABEL, GOODS_LABEL, plural } from "./labels";
import { LoadError } from "./states";
import { useApi } from "./useApi";
import { GOODS_CATEGORIES } from "@/lib/domain/model";

export function vehicleStatus(v: VehicleDTO): { label: string; tone: BadgeTone } {
  if (v.status === "inactive") return { label: "Inactive", tone: "neutral" };
  if (v.activeTrips > 0) return { label: "On trip", tone: "info" };
  return { label: "Active", tone: "success" };
}

export function VehiclePhoto({ v, className }: { v: Pick<VehicleDTO, "photos" | "imageKey" | "makeModel">; className?: string }) {
  const photo = v.photos[0]?.url;
  return (
    <div className={`relative aspect-[16/10] w-full overflow-hidden rounded-md bg-surface-muted ${className ?? ""}`}>
      {photo ? (
        // Private, access-checked file URL: rendered as-is (not through the image optimiser).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt={`Photo of ${v.makeModel}`} className="size-full object-cover" />
      ) : (
        <Image src={vehicleImageSrc(v.imageKey)} alt="" fill sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
      )}
    </div>
  );
}

/** Vehicles (`/agency/vehicles`, P3 §4.4): fleet cards with edit/remove. Removal is blocked while a vehicle has live trips. */
export function VehiclesView() {
  const { toast } = useToast();
  const { state, reload, setData } = useApi("vehicles", () => agencyApi.vehicles("all"));
  const [removing, setRemoving] = useState<VehicleDTO | null>(null);
  const [busy, setBusy] = useState(false);

  const header = (
    <PageHeader
      title="Vehicles"
      count={state.status === "ready" ? state.data.items.length : undefined}
      actions={
        <ButtonLink href={paths.agency.newVehicle} leadingIcon={<Plus aria-hidden="true" strokeWidth={2.25} />}>
          Add vehicle
        </ButtonLink>
      }
    />
  );

  if (state.status === "loading") {
    return (
      <>
        {header}
        <div aria-busy="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <span className="sr-only">Loading vehicles…</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-80 rounded-lg" />
          ))}
        </div>
      </>
    );
  }
  if (state.status === "error") {
    return (
      <>
        {header}
        <LoadError message={state.message} onRetry={reload} title="We couldn't load your vehicles" />
      </>
    );
  }
  const items = state.data.items;

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await agencyApi.removeVehicle(removing.id);
      setData({ items: items.filter((v) => v.id !== removing.id) });
      toast({ title: "Vehicle removed", description: removing.registrationNumber, tone: "success" });
      setRemoving(null);
    } catch (e) {
      toast({ title: "Couldn't remove the vehicle", description: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {header}
      {items.length === 0 ? (
        <EmptyState
          icon={<Truck strokeWidth={1.75} />}
          title="Add your first vehicle"
          description="Register the vehicles you run trips with: type, registration, capacity and the goods they can carry."
          action={{ label: "Add vehicle", href: paths.agency.newVehicle }}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="vehicle-list">
          {items.map((v) => {
            const s = vehicleStatus(v);
            const restricted = GOODS_CATEGORIES.filter((g) => !v.acceptedGoods.includes(g));
            return (
              <Card as="li" key={v.id} padding="sm" className="flex flex-col gap-3" data-testid="vehicle-card">
                <VehiclePhoto v={v} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-heading text-base font-semibold text-ink">
                      <Link href={paths.agency.vehicle(v.id)} className="underline-offset-4 hover:underline">
                        {v.makeModel}
                      </Link>
                    </h2>
                    <p className="text-sm text-ink-muted">
                      {v.registrationNumber} · {v.vehicleClass}
                    </p>
                  </div>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </div>
                <p className="text-sm text-ink">
                  Up to {formatKg(v.maxPayloadKg)} · {BODY_TYPE_LABEL[v.bodyType]} body
                </p>
                {restricted.length ? (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Restricted goods">
                    {restricted.slice(0, 3).map((g) => (
                      <li key={g}>
                        <Badge tone="neutral">No {GOODS_LABEL[g].toLowerCase()}</Badge>
                      </li>
                    ))}
                    {restricted.length > 3 ? (
                      <li>
                        <Badge tone="neutral">+{restricted.length - 3}</Badge>
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-muted">Carries all goods categories</p>
                )}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <span className="text-xs text-ink-subtle">{v.activeTrips ? plural(v.activeTrips, "live trip") : "No live trips"}</span>
                  <div className="flex gap-2">
                    <ButtonLink href={paths.agency.vehicle(v.id)} variant="outline" size="sm" leadingIcon={<Pencil aria-hidden="true" strokeWidth={2} />}>
                      Edit<span className="sr-only"> {v.registrationNumber}</span>
                    </ButtonLink>
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={<Trash2 aria-hidden="true" strokeWidth={2} />}
                      disabled={v.activeTrips > 0}
                      title={v.activeTrips > 0 ? "This vehicle has upcoming or active trips" : undefined}
                      onClick={() => setRemoving(v)}
                    >
                      Remove<span className="sr-only"> {v.registrationNumber}</span>
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Remove this vehicle?"
        description={removing ? `${removing.makeModel} · ${removing.registrationNumber} will no longer be available for trips. Past trips keep their records.` : undefined}
        confirmLabel="Remove vehicle"
        tone="danger"
        loading={busy}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
