"use client";

import { useRef } from "react";
import { ArrowDown, ArrowUp, MapPin, Plus, X } from "lucide-react";
import { Button, FormField, IconButton, Input } from "@/components/ui";
import { PlaceAutocompleteInput } from "@/components/maps/PlaceAutocompleteInput";
import { mapsApi } from "@/lib/api/client/auth";
import { cn } from "@/lib/utils/cn";

export interface CheckpointRow {
  /** Stable React key (not sent to the server). */
  key: string;
  /** Google place id (Places Autocomplete, or E23 server geocoding without a browser key). */
  placeId: string;
  /** Text shown for the place. */
  placeLabel: string;
  /** IST wall clock "YYYY-MM-DDTHH:mm" (datetime-local). */
  arrival: string;
  departure: string;
}

export const MAX_STOPS = 10;

let seq = 0;
export function newRow(partial: Partial<CheckpointRow> = {}): CheckpointRow {
  seq += 1;
  return { key: `cp${seq}-${Math.random().toString(36).slice(2, 7)}`, placeId: "", placeLabel: "", arrival: "", departure: "", ...partial };
}

export interface CheckpointEditorProps {
  rows: CheckpointRow[];
  onChange(rows: CheckpointRow[]): void;
  /** Errors keyed by the trip body path, e.g. "checkpoints.2.expectedArrivalAt". */
  errors: Record<string, string>;
  /** Server-computed road km from source per row (read-only, Routes API), when known. */
  kms?: Array<number | null>;
  disabled?: boolean;
}

const resolvePlace = async (input: { address: string } | { placeId: string }) => (await mapsApi.geocode(input)).place;

/**
 * Ordered route editor (M2): a fixed Source row (Places town + departure), intermediate checkpoints
 * (place + expected arrival + expected departure, movable/removable), and a fixed Destination row
 * (place + arrival). Max 10 stops. Each row is a stacked mini-card on mobile.
 */
export function CheckpointEditor({ rows, onChange, errors, kms, disabled }: CheckpointEditorProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const last = rows.length - 1;

  function update(i: number, patch: Partial<CheckpointRow>) {
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j <= 0 || j >= last) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-row="${next[j]!.key}"] [data-move="${dir < 0 ? "up" : "down"}"]`)?.focus());
  }
  function remove(i: number) {
    if (i <= 0 || i >= last) return;
    onChange(rows.filter((_, j) => j !== i));
  }
  function add() {
    if (rows.length >= MAX_STOPS) return;
    const row = newRow();
    onChange([...rows.slice(0, last), row, rows[last]!]);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLInputElement>(`[data-row="${row.key}"] input`)?.focus());
  }

  const listError = errors["checkpoints"];

  return (
    <fieldset className="min-w-0" aria-describedby={listError ? "checkpoints-error" : undefined}>
      <legend className="mb-3 text-sm font-medium text-ink">Route & checkpoints</legend>
      <ol ref={listRef} className="flex flex-col gap-3" data-testid="checkpoint-editor">
        {rows.map((row, i) => {
          const role = i === 0 ? "source" : i === last ? "destination" : "checkpoint";
          const name = row.placeLabel.split(",")[0] || (role === "checkpoint" ? `checkpoint ${i}` : role);
          const id = `cp-${row.key}`;
          const e = (field: string) => errors[`checkpoints.${i}.${field}`];
          const km = kms?.[i];
          return (
            <li key={row.key} data-row={row.key} className="rounded-md border border-border bg-surface p-3 sm:p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <MapPin aria-hidden="true" strokeWidth={1.75} className={cn("size-4", role === "checkpoint" ? "text-ink-subtle" : "text-green-600")} />
                  {role === "source" ? "Source" : role === "destination" ? "Destination" : `Checkpoint ${i}`}
                  {km !== undefined && km !== null && i > 0 ? <span className="font-normal text-ink-muted">· {km.toLocaleString("en-IN")} km by road from source</span> : null}
                </p>
                {role === "checkpoint" ? (
                  <div className="flex items-center gap-1">
                    <IconButton
                      label={`Move ${name} up`}
                      data-move="up"
                      size="sm"
                      disabled={disabled || i === 1}
                      onClick={() => move(i, -1)}
                      icon={<ArrowUp aria-hidden="true" strokeWidth={2} />}
                    />
                    <IconButton
                      label={`Move ${name} down`}
                      data-move="down"
                      size="sm"
                      disabled={disabled || i === last - 1}
                      onClick={() => move(i, 1)}
                      icon={<ArrowDown aria-hidden="true" strokeWidth={2} />}
                    />
                    <IconButton label={`Remove ${name}`} size="sm" disabled={disabled} onClick={() => remove(i)} icon={<X aria-hidden="true" strokeWidth={2} />} />
                  </div>
                ) : null}
              </div>
              <div className={cn("grid grid-cols-1 gap-3", role === "checkpoint" ? "md:grid-cols-3" : "md:grid-cols-2")}>
                <FormField label={role === "source" ? "From" : role === "destination" ? "To" : "Place"} htmlFor={`${id}-place`} error={e("placeId")} required>
                  <PlaceAutocompleteInput
                    id={`${id}-place`}
                    kind="cities"
                    placeholder="Town or city"
                    value={row.placeLabel ? { placeId: row.placeId, label: row.placeLabel } : null}
                    resolve={resolvePlace}
                    invalid={!!e("placeId")}
                    disabled={disabled}
                    onChange={(sel) => update(i, { placeId: sel?.placeId ?? "", placeLabel: sel?.label ?? "" })}
                  />
                </FormField>
                {role !== "source" ? (
                  <FormField label={role === "destination" ? "Arrival date & time" : "Expected arrival"} htmlFor={`${id}-arr`} error={e("expectedArrivalAt")} required>
                    <Input
                      id={`${id}-arr`}
                      type="datetime-local"
                      value={row.arrival}
                      invalid={!!e("expectedArrivalAt")}
                      disabled={disabled}
                      onChange={(ev) => update(i, { arrival: ev.target.value })}
                    />
                  </FormField>
                ) : null}
                {role !== "destination" ? (
                  <FormField label={role === "source" ? "Departure date & time" : "Expected departure"} htmlFor={`${id}-dep`} error={e("expectedDepartureAt")} required>
                    <Input
                      id={`${id}-dep`}
                      type="datetime-local"
                      value={row.departure}
                      invalid={!!e("expectedDepartureAt")}
                      disabled={disabled}
                      onChange={(ev) => update(i, { departure: ev.target.value })}
                    />
                  </FormField>
                ) : null}
              </div>
              {e("kmFromOrigin") ? <p className="mt-2 text-sm text-error">{e("kmFromOrigin")}</p> : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" leadingIcon={<Plus aria-hidden="true" strokeWidth={2} />} onClick={add} disabled={disabled || rows.length >= MAX_STOPS}>
          Add checkpoint
        </Button>
        <p className="text-xs text-ink-subtle">
          {rows.length >= MAX_STOPS ? `Maximum ${MAX_STOPS} stops reached.` : "Times are IST. Each stop must come after the previous one."}
        </p>
      </div>
      {listError ? (
        <p id="checkpoints-error" role="alert" className="mt-2 text-sm text-error">
          {listError}
        </p>
      ) : null}
    </fieldset>
  );
}
