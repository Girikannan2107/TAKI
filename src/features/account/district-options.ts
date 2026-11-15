import type { SelectOptionGroup } from "@/components/ui";
import { STATE_CODES, STATE_NAMES, type StateCode } from "@/lib/domain/model";
import { DISTRICTS, getDistrict } from "@/lib/domain/places/districts";

/** District <Select> groups (one <optgroup> per state, A–Z). Same dataset trips and shipments use. */
export function districtSelectGroups(states: readonly StateCode[] = STATE_CODES): SelectOptionGroup[] {
  return states.map((state) => ({
    label: STATE_NAMES[state],
    options: DISTRICTS.filter((d) => d.state === state)
      .map((d) => ({ value: d.id, label: d.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  }));
}

export const STATE_CHOICES = STATE_CODES.map((s) => ({ value: s, label: STATE_NAMES[s] }));

export function districtLabel(id: string | null | undefined): string {
  const d = getDistrict(id);
  return d ? `${d.name}, ${STATE_NAMES[d.state]}` : "";
}
