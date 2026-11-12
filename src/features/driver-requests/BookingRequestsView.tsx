"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { ClipboardList, PackageCheck, PackageX, Undo2 } from "lucide-react";
import { Button, ConfirmDialog, EmptyState, Modal, OtpInput, Skeleton, Tabs, useToast } from "@/components/ui";
import { stepNeedsOtp } from "@/lib/domain/commands";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { PageHeader } from "@/components/layout/PageHeader";
import { paths } from "@/lib/config/routes";
import { cityName } from "@/lib/domain/cities";
import type { BookingId, BookingRequestStatus } from "@/lib/domain/types";
import { formatINR } from "@/lib/format";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { errorMessage, marketplace } from "@/lib/services/marketplace";
import { useDriverRequests, type DriverRequest } from "@/lib/store/selectors";
import { BookingRequestCard, NEXT_ACTION, type CardBusy } from "./BookingRequestCard";

const TABS: ReadonlyArray<{ value: BookingRequestStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "withdrawn", label: "Withdrawn" },
];
const PANEL_ID = "booking-requests-panel";
const DELIVERED_PREVIEW = 5;

function parseTab(v: string | null): BookingRequestStatus {
  return TABS.some((t) => t.value === v) ? (v as BookingRequestStatus) : "pending";
}

function routeText(r: DriverRequest): string {
  return `${cityName(r.booking.shipment.sourceCityId)} → ${cityName(r.booking.shipment.destinationCityId)}`;
}

/** Screen 14 — Booking Requests (`/driver/bookings?tab=`), incl. Manage Shipments on the Accepted tab. */
export function BookingRequestsView() {
  const hydrated = useHydrated();
  const requests = useDriverRequests();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const { toast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(new Set<BookingId>());
  const [busy, setBusy] = useState<Record<BookingId, CardBusy>>({});
  const [declineTarget, setDeclineTarget] = useState<DriverRequest | null>(null);
  /** Booking awaiting OTP verification (pickup or delivery). */
  const [deliverTarget, setDeliverTarget] = useState<DriverRequest | null>(null);
  const [otp, setOtp] = useState("");
  const verifyKind = deliverTarget ? stepNeedsOtp(deliverTarget.booking.status) : null;
  const verifying = deliverTarget ? busy[deliverTarget.booking.id] === "advance" : false;
  const [showAllDelivered, setShowAllDelivered] = useState(false);

  const groups = useMemo(() => {
    const g: Record<BookingRequestStatus, DriverRequest[]> = { pending: [], accepted: [], declined: [], withdrawn: [] };
    for (const r of requests) g[r.status].push(r);
    return g;
  }, [requests]);
  const pendingCount = groups.pending.length;

  function selectTab(value: string) {
    const next = parseTab(value);
    const q = new URLSearchParams(params.toString());
    if (next === "pending") q.delete("tab");
    else q.set("tab", next);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  async function run(id: BookingId, kind: Exclude<CardBusy, null>, action: () => Promise<unknown>, success: { title: string; description?: string }) {
    if (inFlight.current.has(id)) return false;
    inFlight.current.add(id);
    setBusy((b) => ({ ...b, [id]: kind }));
    try {
      await action();
      toast({ ...success, tone: "success" });
      return true;
    } catch (e) {
      toast({ title: "Couldn't update this request", description: errorMessage(e), tone: "error" });
      return false;
    } finally {
      inFlight.current.delete(id);
      setBusy((b) => ({ ...b, [id]: null }));
    }
  }

  async function accept(r: DriverRequest) {
    if (r.overCapacity) return;
    const ok = await run(r.booking.id, "accept", () => marketplace.acceptRequest(r.booking.id), {
      title: "Request accepted",
      description: `${routeText(r)} · ${formatINR(r.earnings)}. The customer can now pay — find it under Accepted.`,
    });
    if (ok) panelRef.current?.focus();
  }

  async function confirmDecline() {
    const r = declineTarget;
    if (!r) return;
    const ok = await run(r.booking.id, "decline", () => marketplace.declineRequest(r.booking.id), {
      title: "Request declined",
      description: "The customer will be told. No payment was taken.",
    });
    setDeclineTarget(null);
    if (ok) panelRef.current?.focus();
  }

  async function advance(r: DriverRequest, otp?: string) {
    const label = NEXT_ACTION[r.booking.status];
    return run(r.booking.id, "advance", () => marketplace.advanceShipment(r.booking.id, otp), {
      title: label === "Mark delivered" ? "Delivery verified — earnings credited" : label === "Mark picked up" ? "Pickup verified" : "Shipment updated",
      description: `${r.booking.id} · ${routeText(r)}`,
    });
  }

  function closeVerify() {
    setDeliverTarget(null);
    setOtp("");
  }

  /** Pickup and delivery are verified with the OTP the customer sees on their tracking page. */
  async function confirmVerify(code = otp) {
    const r = deliverTarget;
    if (!r || code.length !== 6) return;
    if (await advance(r, code)) closeVerify();
    else setOtp("");
  }

  const header = <PageHeader title="Booking Requests" count={hydrated ? pendingCount : undefined} backHref={paths.driver.dashboard} backLabel="Back to dashboard" />;

  if (!hydrated) {
    return (
      <>
        {header}
        <div aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">Loading booking requests…</span>
          <Skeleton className="h-11 w-80 max-w-full" rounded="full" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-lg" />
          ))}
        </div>
      </>
    );
  }

  const list = groups[tab];
  const acceptedActive = groups.accepted.filter((r) => r.booking.status !== "delivered");
  const acceptedDone = groups.accepted.filter((r) => r.booking.status === "delivered");
  const shownDone = showAllDelivered ? acceptedDone : acceptedDone.slice(0, DELIVERED_PREVIEW);

  const cardFor = (r: DriverRequest) => (
    <BookingRequestCard
      key={r.booking.id}
      request={r}
      busy={busy[r.booking.id] ?? null}
      onAccept={() => void accept(r)}
      onDecline={() => setDeclineTarget(r)}
      onAdvance={() => (stepNeedsOtp(r.booking.status) ? setDeliverTarget(r) : void advance(r))}
    />
  );

  return (
    <>
      {header}
      <Tabs
        items={TABS.map((t) => ({ ...t, count: groups[t.value].length }))}
        value={tab}
        onChange={selectTab}
        ariaLabel="Filter booking requests"
        panelId={PANEL_ID}
        className="mb-5"
      />

      <div
        ref={panelRef}
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={`${PANEL_ID}-tab-${tab}`}
        tabIndex={-1}
        className="max-w-3xl outline-none"
      >
        {list.length === 0 ? (
          <EmptyByTab tab={tab} />
        ) : tab === "accepted" ? (
          <div className="flex flex-col gap-6">
            <DemoBanner kind="general" compact title="Demo: status updates are manual; no GPS" />
            {acceptedActive.length > 0 ? (
              <section aria-labelledby="active-shipments-title">
                <h2 id="active-shipments-title" className="mb-3 type-h3 text-ink">
                  Manage shipments
                </h2>
                <ul className="flex flex-col gap-4">{acceptedActive.map(cardFor)}</ul>
              </section>
            ) : null}
            {acceptedDone.length > 0 ? (
              <section aria-labelledby="delivered-title">
                <h2 id="delivered-title" className="mb-3 type-h3 text-ink">
                  Delivered
                </h2>
                <ul className="flex flex-col gap-4">{shownDone.map(cardFor)}</ul>
                {acceptedDone.length > DELIVERED_PREVIEW ? (
                  <Button variant="ghost" className="mt-3" onClick={() => setShowAllDelivered((v) => !v)} aria-expanded={showAllDelivered}>
                    {showAllDelivered ? "Show fewer" : `Show all (${acceptedDone.length})`}
                  </Button>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : (
          <ul className="flex flex-col gap-4">{list.map(cardFor)}</ul>
        )}
      </div>

      <ConfirmDialog
        open={declineTarget !== null}
        title="Decline this request?"
        description="The customer will be told. No payment has been taken yet."
        confirmLabel="Decline request"
        cancelLabel="Keep request"
        tone="danger"
        loading={declineTarget ? busy[declineTarget.booking.id] === "decline" : false}
        onConfirm={confirmDecline}
        onCancel={() => setDeclineTarget(null)}
      />
      <Modal
        open={deliverTarget !== null}
        onClose={closeVerify}
        size="sm"
        title={verifyKind === "pickup" ? "Verify pickup" : "Verify delivery"}
        description={
          verifyKind === "pickup"
            ? "Ask the customer for the 6-digit pickup OTP shown on their tracking page."
            : deliverTarget
              ? `Ask the receiver for the 6-digit delivery OTP. ${formatINR(deliverTarget.earnings)} will be credited to your TAKI balance.`
              : undefined
        }
        footer={
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={closeVerify}>
              Cancel
            </Button>
            <Button onClick={() => void confirmVerify()} disabled={otp.length !== 6} loading={verifying}>
              {verifyKind === "pickup" ? "Mark picked up" : "Mark delivered"}
            </Button>
          </div>
        }
      >
        <OtpInput
          value={otp}
          onChange={setOtp}
          onComplete={(code) => void confirmVerify(code)}
          disabled={verifying}
          autoFocus
          label={verifyKind === "pickup" ? "Pickup OTP" : "Delivery OTP"}
        />
      </Modal>
    </>
  );
}

function EmptyByTab({ tab }: { tab: BookingRequestStatus }) {
  switch (tab) {
    case "pending":
      return (
        <EmptyState
          icon={<ClipboardList strokeWidth={1.75} />}
          title="No pending requests"
          description="New requests appear here when customers book space on your routes."
          action={{ label: "Post a New Route", href: paths.driver.newRoute }}
        />
      );
    case "accepted":
      return (
        <EmptyState
          icon={<PackageCheck strokeWidth={1.75} />}
          title="No accepted bookings yet"
          description="Requests you accept appear here so you can update their status."
        />
      );
    case "declined":
      return <EmptyState icon={<PackageX strokeWidth={1.75} />} title="No declined requests" description="Requests you decline appear here." />;
    case "withdrawn":
      return (
        <EmptyState
          icon={<Undo2 strokeWidth={1.75} />}
          title="No withdrawn requests"
          description="Requests a customer cancels before you respond appear here."
        />
      );
  }
}
