"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, CircleAlert, Clock3, MapPin, Package, Phone, RotateCcw, Snowflake, Droplets, ArrowUpFromLine, Wine } from "lucide-react";
import { Badge, Button, ButtonLink, Card, Skeleton } from "@/components/ui";
import type { DriverShipmentListItem } from "@/lib/api/contracts/driver";
import { paths } from "@/lib/config/routes";
import type { BookingStatus, SpecialHandling } from "@/lib/domain/model";
import { formatDateTime, formatKg, formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { DRIVER_STATUS_LABEL, HANDLING_LABEL, PACKAGE_LABEL, STATUS_TONE } from "./labels";

export function StatusBadge({ status, size = "sm" }: { status: BookingStatus; size?: "sm" | "md" }) {
  return (
    <Badge tone={STATUS_TONE[status]} size={size}>
      {DRIVER_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Load-failure card (P3 §3.0): icon, plain-language message, "Try again". */
export function LoadError({ message, onRetry, className }: { message: string; onRetry(): void; className?: string }) {
  return (
    <Card role="alert" className={cn("flex flex-col items-start gap-3", className)}>
      <div className="flex items-start gap-2.5">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-error" />
        <p className="text-sm text-error">{message}</p>
      </div>
      <Button variant="outline" size="sm" leadingIcon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={onRetry}>
        Try again
      </Button>
    </Card>
  );
}

export function ListSkeleton({ rows = 3, label = "Loading…" }: { rows?: number; label?: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-36 w-full" rounded="md" />
      ))}
    </div>
  );
}

const HANDLING_ICON: Record<SpecialHandling, ReactNode> = {
  fragile: <Wine aria-hidden="true" className="size-3.5" />,
  keep_dry: <Droplets aria-hidden="true" className="size-3.5" />,
  this_side_up: <ArrowUpFromLine aria-hidden="true" className="size-3.5" />,
  temperature_sensitive: <Snowflake aria-hidden="true" className="size-3.5" />,
};

export function HandlingChips({ items, className }: { items: readonly SpecialHandling[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Special handling">
      {items.map((h) => (
        <li key={h}>
          <Badge tone="attention" icon={HANDLING_ICON[h]}>
            {HANDLING_LABEL[h]}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** Assigned shipment row (P3 §4.5): booking id, people, pickup → drop, package, status. Whole card links to the action screen. */
export function ShipmentCard({ item, href }: { item: DriverShipmentListItem; href?: string }) {
  const target = href ?? paths.driver.shipment(item.bookingId);
  const delivered = item.status === "delivered";
  return (
    <Card as="article" padding="none" interactive className="relative">
      <Link
        href={target}
        className="flex min-h-11 flex-col gap-3 rounded-[inherit] p-4 outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold tabular-nums text-ink">{item.bookingId}</p>
            <p className="truncate text-sm text-ink-muted">
              {item.customerName} → {item.receiverName}
            </p>
          </div>
          <StatusBadge status={item.status} />
        </div>
        <ol className="flex flex-col gap-1.5 text-sm">
          <li className="flex items-start gap-2">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-green-700" />
            <span className="min-w-0">
              <span className="sr-only">Pickup: </span>
              <span className="font-medium text-ink">{item.pickup.placeName}</span>
              <span className="block truncate text-ink-muted">{item.pickup.shortAddress}</span>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
            <span className="min-w-0">
              <span className="sr-only">Drop: </span>
              <span className="font-medium text-ink">{item.drop.placeName}</span>
              <span className="block truncate text-ink-muted">{item.drop.shortAddress}</span>
            </span>
          </li>
        </ol>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <Package aria-hidden="true" className="size-4" />
            <span className="tabular-nums">{formatKg(item.package.weightKg)}</span> · {item.package.pieces} × {PACKAGE_LABEL[item.package.packageType]}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock3 aria-hidden="true" className="size-4" />
            {delivered && item.deliveredAt
              ? `Delivered ${formatDateTime(item.deliveredAt)}`
              : item.status === "confirmed"
                ? `Pickup ${formatDateTime(item.pickup.expectedAt)}`
                : `Drop by ${formatDateTime(item.drop.expectedAt)}`}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <HandlingChips items={item.package.specialHandling} />
          <ChevronRight aria-hidden="true" className="ml-auto size-5 shrink-0 text-ink-subtle" />
        </div>
      </Link>
    </Card>
  );
}

/** `tel:` call button, 44px target. */
export function CallButton({ phone, name }: { phone: string | null; name: string }) {
  if (!phone) return null;
  return (
    <a
      href={`tel:${phone}`}
      aria-label={`Call ${name}, ${formatPhone(phone)}`}
      className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-mint-100 px-4 text-sm font-semibold text-green-800 transition-colors hover:bg-green-300/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
    >
      <Phone aria-hidden="true" className="size-4" />
      Call
    </a>
  );
}

/** Section card with an h2 (P3 conventions: `Card as="section" aria-labelledby`). */
export function Section({ id, title, children, action, className }: { id: string; title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <Card as="section" aria-labelledby={id} padding="sm" className={cn("flex flex-col gap-3 sm:p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="type-h3 text-ink">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Shown when the API answers `driver_not_linked` (agency hasn't approved the driver yet). */
export function NotLinkedNotice() {
  return (
    <Card tone="muted" className="flex flex-col items-start gap-3">
      <Badge tone="attention">Approval pending</Badge>
      <p className="text-sm text-ink-muted">Your agency hasn&apos;t approved you yet, so there are no trips or shipments to show. Check the dashboard for your request status.</p>
      <ButtonLink href={paths.driver.dashboard} variant="outline" size="sm">
        Go to dashboard
      </ButtonLink>
    </Card>
  );
}
