/**
 * Client-side mirror of the v3 checkpoint rules (contract §10.1 TripBody validators); the API re-validates.
 * Places are Google place ids now, so there is no local dataset check — only "picked a place", "not the same
 * place twice in a row" and the time order.
 */
import { MAX_STOPS } from "./CheckpointEditor";

export interface CheckpointDraftV3 {
  placeId: string;
  /** Display name for messages. */
  label: string;
  expectedArrivalAt: string | null;
  expectedDepartureAt: string | null;
}

export interface CheckpointIssue {
  path: string;
  message: string;
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

export function checkpointIssuesV3(cps: readonly CheckpointDraftV3[]): CheckpointIssue[] {
  const issues: CheckpointIssue[] = [];
  if (cps.length < 2) issues.push({ path: "checkpoints", message: "Add a source and a destination." });
  if (cps.length > MAX_STOPS) issues.push({ path: "checkpoints", message: `A trip can have at most ${MAX_STOPS} stops including source and destination.` });

  cps.forEach((c, i) => {
    if (!c.placeId) issues.push({ path: `checkpoints.${i}.placeId`, message: "Choose a place from the suggestions." });
    else if (i > 0 && cps[i - 1]!.placeId === c.placeId)
      issues.push({ path: `checkpoints.${i}.placeId`, message: "This is the same place as the stop before it." });
  });

  const last = cps.length - 1;
  let prevDeparture: number | null = null;
  let prevLabel = "";
  cps.forEach((c, i) => {
    const arr = ms(c.expectedArrivalAt);
    const dep = ms(c.expectedDepartureAt);
    const label = c.label || (i === 0 ? "the source" : i === last ? "the destination" : `checkpoint ${i}`);
    if (i === 0) {
      if (dep === null) issues.push({ path: `checkpoints.${i}.expectedDepartureAt`, message: "Enter the departure date and time." });
    } else if (i === last) {
      if (arr === null) issues.push({ path: `checkpoints.${i}.expectedArrivalAt`, message: "Enter the arrival date and time." });
    } else {
      if (arr === null) issues.push({ path: `checkpoints.${i}.expectedArrivalAt`, message: `Enter the expected arrival at ${label}.` });
      if (dep === null) issues.push({ path: `checkpoints.${i}.expectedDepartureAt`, message: `Enter the expected departure from ${label}.` });
      if (arr !== null && dep !== null && dep < arr)
        issues.push({ path: `checkpoints.${i}.expectedDepartureAt`, message: `Departure from ${label} can't be before arriving there.` });
    }
    if (i > 0 && arr !== null && prevDeparture !== null && arr <= prevDeparture)
      issues.push({ path: `checkpoints.${i}.expectedArrivalAt`, message: `Arrival at ${label} must be after leaving ${prevLabel}.` });
    const effectiveDep = i === last ? null : dep;
    if (effectiveDep !== null) {
      prevDeparture = effectiveDep;
      prevLabel = label;
    } else if (arr !== null) {
      prevDeparture = arr;
      prevLabel = label;
    }
  });
  return issues;
}
