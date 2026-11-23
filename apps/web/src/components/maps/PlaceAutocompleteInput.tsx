"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CircleCheck, MapPin, Search } from "lucide-react";
import { Button, Input } from "@/components/ui";
import type { PlaceDTO } from "@/lib/api/contracts/auth";
import { errorMessage } from "@/lib/api/http";
import { loadMapsLibrary, mapsBrowserKey } from "@/lib/maps/loader";
import { cn } from "@/lib/utils/cn";

export interface PlaceSelection {
  /** Google place id (or `fake_*` from the local gazetteer through E23). */
  placeId: string;
  /** Text shown in the input. */
  label: string;
  /** Present when the place was resolved server-side (fallback mode, or `resolve` in Google mode). */
  place?: PlaceDTO;
}

export interface PlaceAutocompleteInputProps {
  id: string;
  value: PlaceSelection | null;
  onChange: (value: PlaceSelection | null) => void;
  /** "cities" for agency bases and trip checkpoints, "address" for pickup / delivery addresses. */
  kind: "cities" | "address";
  /**
   * Server-side lookup (E23 POST /maps/geocode). Used for typed text when Google Places is unavailable,
   * and (when `resolveSelection`) to resolve a Google suggestion to coordinates / district / state.
   * Omit it where no token exists yet (agency signup step 1): without Google the input then just keeps the
   * typed text (`placeId: ""`) and the caller geocodes it later.
   */
  resolve?: (input: { address: string } | { placeId: string }) => Promise<PlaceDTO>;
  /** Also resolve Google suggestions through `resolve` (so `value.place` is always filled). */
  resolveSelection?: boolean;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  "aria-describedby"?: string;
}

interface Suggestion {
  placeId: string;
  main: string;
  secondary: string;
}

/** Five service states: rough bounding box (Places (New) `locationRestriction`). */
const SERVICE_AREA_BOUNDS = { south: 8.0, west: 74.0, north: 19.95, east: 84.8 };

/**
 * Place picker (M2). With NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY: Places API (New) `AutocompleteSuggestion`
 * with a session token, rendered as an accessible combobox + listbox in our own Input. Without a key (local,
 * e2e) or when Maps fails to load: a text box with "Find" that asks the server (E23) to geocode the text.
 * Only the place id leaves this component; the server resolves coordinates, district and state.
 */
export function PlaceAutocompleteInput(props: PlaceAutocompleteInputProps) {
  const [hasKey] = useState(() => !!mapsBrowserKey());
  /** undefined = still loading; null = unavailable (fallback). */
  const [places, setPlaces] = useState<google.maps.PlacesLibrary | null | undefined>(hasKey ? undefined : null);

  useEffect(() => {
    if (!hasKey) return;
    let alive = true;
    void loadMapsLibrary("places").then((lib) => {
      if (alive) setPlaces(lib);
    });
    return () => {
      alive = false;
    };
  }, [hasKey]);

  if (places) return <GoogleCombobox {...props} places={places} />;
  return <FallbackLookup {...props} loading={places === undefined} />;
}

function GoogleCombobox({
  id,
  value,
  onChange,
  kind,
  resolve,
  resolveSelection,
  placeholder,
  invalid,
  disabled,
  places,
  "aria-describedby": describedBy,
}: PlaceAutocompleteInputProps & { places: google.maps.PlacesLibrary }) {
  const listId = useId();
  const [text, setText] = useState(value?.label ?? "");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const seq = useRef(0);

  // Follow the parent's value (selection, swap, reset) without an effect.
  const [shownLabel, setShownLabel] = useState(value?.label);
  if (shownLabel !== value?.label) {
    setShownLabel(value?.label);
    setText(value?.label ?? "");
  }

  const query = text.trim();
  const searching = open && query.length >= 2 && query !== value?.label;

  useEffect(() => {
    if (!searching) return;
    const q = query;
    const mine = ++seq.current;
    const t = window.setTimeout(async () => {
      token.current ??= new places.AutocompleteSessionToken();
      try {
        const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q,
          sessionToken: token.current,
          includedRegionCodes: ["in"],
          locationRestriction: SERVICE_AREA_BOUNDS,
          ...(kind === "cities" ? { includedPrimaryTypes: ["locality", "administrative_area_level_3", "sublocality"] } : {}),
        });
        if (mine !== seq.current) return;
        setItems(
          suggestions
            .map((s) => s.placePrediction)
            .filter((p): p is google.maps.places.PlacePrediction => !!p)
            .map((p) => ({ placeId: p.placeId, main: p.mainText?.text ?? p.text.text, secondary: p.secondaryText?.text ?? "" })),
        );
        setActive(-1);
      } catch {
        if (mine === seq.current) setItems([]);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [searching, query, kind, places]);

  async function choose(s: Suggestion) {
    const label = s.secondary ? `${s.main}, ${s.secondary}` : s.main;
    setText(label);
    setOpen(false);
    setItems([]);
    token.current = null; // a session ends with a selection
    setError(null);
    if (!resolveSelection || !resolve) {
      onChange({ placeId: s.placeId, label });
      return;
    }
    setBusy(true);
    try {
      const place = await resolve({ placeId: s.placeId });
      onChange({ placeId: place.placeId, label, place });
    } catch (e) {
      onChange(null);
      setError(errorMessage(e, "We couldn't use that place. Try another."));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      void choose(items[active]!);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = searching && items.length > 0;
  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        leadingIcon={<MapPin strokeWidth={1.75} />}
        placeholder={placeholder}
        invalid={invalid || !!error}
        disabled={disabled || busy}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg">
          {items.map((s, i) => (
            <li
              key={s.placeId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                void choose(s);
              }}
              className={cn("flex cursor-pointer flex-col px-3.5 py-2 text-sm", i === active ? "bg-green-50" : "hover:bg-surface-muted")}
            >
              <span className="font-medium text-ink">{s.main}</span>
              {s.secondary ? <span className="text-ink-muted">{s.secondary}</span> : null}
            </li>
          ))}
          <li aria-hidden="true" className="px-3.5 pt-1 text-right text-[11px] text-ink-subtle">
            Powered by Google
          </li>
        </ul>
      ) : null}
      {error ? (
        <p className="mt-1.5 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function FallbackLookup({
  id,
  value,
  onChange,
  kind,
  resolve,
  placeholder,
  invalid,
  disabled,
  loading,
  "aria-describedby": describedBy,
}: PlaceAutocompleteInputProps & { loading: boolean }) {
  const [text, setText] = useState(value?.label ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Follow the parent's value (selection, swap, reset) without an effect.
  const [shownLabel, setShownLabel] = useState(value?.label);
  if (shownLabel !== value?.label) {
    setShownLabel(value?.label);
    setText(value?.label ?? "");
  }

  async function find() {
    const q = text.trim();
    if (!resolve) return;
    if (q.length < 3) {
      setError(kind === "cities" ? "Type a town or city name" : "Type the address, including the town");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const place = await resolve({ address: q });
      const label = place.formattedAddress || place.name;
      setText(label);
      onChange({ placeId: place.placeId, label, place });
    } catch (e) {
      onChange(null);
      setError(errorMessage(e, "We couldn't find that place. Check the spelling and try again."));
    } finally {
      setBusy(false);
    }
  }

  const resolved = !!value && !!value.placeId && value.label === text;
  return (
    <div>
      <div className="flex gap-2">
        <Input
          id={id}
          aria-describedby={describedBy}
          leadingIcon={<MapPin strokeWidth={1.75} />}
          placeholder={placeholder ?? (kind === "cities" ? "Town or city" : "Street, area and town")}
          invalid={invalid || !!error}
          disabled={disabled || busy}
          value={text}
          autoComplete="off"
          trailingSlot={resolved ? <CircleCheck aria-label="Place found" strokeWidth={2} className="size-5 text-green-600" /> : undefined}
          onChange={(e) => {
            setText(e.target.value);
            if (!resolve) onChange(e.target.value.trim() ? { placeId: "", label: e.target.value } : null);
            else if (value) onChange(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && resolve) {
              e.preventDefault();
              void find();
            }
          }}
          onBlur={() => {
            if (resolve && !resolved && text.trim().length >= 3 && !busy) void find();
          }}
        />
        {resolve ? (
          <Button type="button" variant="secondary" onClick={() => void find()} loading={busy} disabled={disabled || loading} className="shrink-0">
            <Search aria-hidden="true" strokeWidth={1.75} className="size-4" />
            Find
          </Button>
        ) : null}
      </div>
      {resolved && value?.place ? (
        <p className="mt-1.5 text-sm text-ink-muted">
          {[value.place.district ?? value.place.locality, value.place.stateName].filter(Boolean).join(", ")}
        </p>
      ) : null}
      {error ? (
        <p className="mt-1.5 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
