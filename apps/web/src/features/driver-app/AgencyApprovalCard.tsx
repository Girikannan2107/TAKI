"use client";

import { useEffect, useId, useState } from "react";
import { Building2, Clock3, FileText, Search } from "lucide-react";
import { Badge, Button, ButtonLink, Card, FormField, Input, Spinner, useToast } from "@/components/ui";
import type { PublicAgencyDTO } from "@/lib/api/contracts/auth";
import type { DriverAgencyStatusDTO } from "@/lib/api/contracts/driver";
import { authApi } from "@/lib/api/client/auth";
import { driverApi } from "@/lib/api/client/driver";
import { errorMessage } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { STATE_NAMES } from "@/lib/domain/model";

export interface AgencyApprovalCardProps {
  agency: DriverAgencyStatusDTO | null;
  /** Called after a new join request is accepted by the server. */
  onRequested(): void;
}

/**
 * Shown instead of the driver app until the agency approves the driver (P3 §3.0 / §4.5).
 * Pending → waiting copy. Rejected / removed / none → pick a verified agency and send a join request.
 */
export function AgencyApprovalCard({ agency, onRequested }: AgencyApprovalCardProps) {
  const pending = agency?.status === "pending";
  const headingId = useId();
  return (
    <Card as="section" tone="muted" aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-green-700">
          {pending ? <Clock3 className="size-5" /> : <Building2 className="size-5" />}
        </span>
        <div className="min-w-0">
          <Badge tone="attention">{pending ? "Approval pending" : agency?.status === "rejected" ? "Request declined" : "No agency yet"}</Badge>
          <h2 id={headingId} className="type-h3 mt-2 text-ink">
            {pending ? `Waiting for ${agency.agencyName} to approve you` : "Join a travel agency to start driving"}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {pending
              ? "You'll see your trips and shipments here as soon as the agency approves you. Make sure your licence and Aadhaar are uploaded so they can verify you."
              : agency?.status === "rejected"
                ? `${agency.agencyName} declined your request. Choose another agency below.`
                : agency?.status === "removed"
                  ? `${agency.agencyName} removed you from their drivers. Choose an agency to join.`
                  : "Choose the agency you drive for. They'll approve you before assigning trips."}
          </p>
        </div>
      </div>
      <ButtonLink href={paths.driver.documents()} variant="outline" leadingIcon={<FileText aria-hidden="true" className="size-4" />} className="self-start">
        Check my documents
      </ButtonLink>
      {pending ? null : <AgencyPicker onRequested={onRequested} />}
    </Card>
  );
}

function AgencyPicker({ onRequested }: { onRequested(): void }) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ query: string; items: PublicAgencyDTO[] } | { query: string; error: string } | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    authApi
      .publicAgencies(query || undefined)
      .then((r) => {
        if (!cancelled) setResult({ query, items: r.items });
      })
      .catch((e: unknown) => {
        if (!cancelled) setResult({ query, error: errorMessage(e, "We couldn't load agencies.") });
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const loading = !result || result.query !== query;

  async function request(a: PublicAgencyDTO) {
    setSending(a.id);
    try {
      await driverApi.requestAgencyLink(a.id);
      toast({ title: `Request sent to ${a.agencyName}`, description: "We'll let you know when they approve you.", tone: "success" });
      onRequested();
    } catch (e) {
      toast({ title: "Request not sent", description: errorMessage(e), tone: "error" });
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <FormField label="Find your agency" htmlFor="agency-search" hint="Only verified agencies are listed.">
        <Input
          type="search"
          leadingIcon={<Search />}
          placeholder="Agency name or district"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
      </FormField>
      <div aria-live="polite" aria-busy={loading}>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner size="sm" label="" /> Loading agencies…
          </p>
        ) : "error" in result ? (
          <p className="text-sm text-error">{result.error}</p>
        ) : result.items.length === 0 ? (
          <p className="text-sm text-ink-muted">No verified agencies match “{query}”.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
            {result.items.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{a.agencyName}</span>
                  <span className="block truncate text-[13px] text-ink-muted">
                    {a.districtName}, {STATE_NAMES[a.state]}
                  </span>
                </span>
                <Button size="sm" variant="secondary" loading={sending === a.id} disabled={sending !== null} onClick={() => void request(a)}>
                  Request to join
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
