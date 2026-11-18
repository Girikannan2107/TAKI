/** Small display/link helpers shared by the agency screens (D2). */
import type { SelectOptionGroup } from "@/components/ui";
import type { NotificationLink } from "@/lib/api/contracts/agency";
import { isApiError } from "@/lib/api/http";
import { paths } from "@/lib/config/routes";
import { STATE_CODES, STATE_NAMES } from "@/lib/domain/model";
import { getDistrict } from "@/lib/domain/places/districts";
import { PLACES } from "@/lib/domain/places/places";
import { formatDateTime } from "@/lib/format";

/** Checkpoint place <Select> groups: one <optgroup> per state; hubs that aren't a district HQ show their district. */
export function placeSelectGroups(): SelectOptionGroup[] {
  return STATE_CODES.map((state) => ({
    label: STATE_NAMES[state],
    options: PLACES.filter((p) => p.state === state)
      .map((p) => {
        const district = getDistrict(p.districtId)?.name;
        return { value: p.id, label: p.isHq || !district || district === p.name ? p.name : `${p.name} (${district})` };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
  }));
}

/** "20 Nov, 08:00 AM" (IST) or a dash. */
export function when(iso: string | null | undefined): string {
  return iso ? formatDateTime(iso) : "—";
}

/** Server field errors (422/409 with `fields`) or an empty object. */
export function fieldErrorsOf(e: unknown): Record<string, string> {
  return isApiError(e) && e.fields ? e.fields : {};
}

/** Where a notification link points inside the agency app. */
export function agencyLinkHref(link: NotificationLink | null): string | null {
  if (!link) return null;
  switch (link.type) {
    case "booking":
      return paths.agency.booking(link.id);
    case "trip":
      return paths.agency.trip(link.id);
    case "driver":
      return paths.agency.driver(link.id);
    case "earnings":
      return paths.agency.earnings();
    case "profile":
      return paths.agency.profile;
    default:
      return null;
  }
}

export const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;

/** First value of a search param (pages pass `await searchParams` entries through this). */
export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
