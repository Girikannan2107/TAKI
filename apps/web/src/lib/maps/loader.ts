"use client";

/**
 * Google Maps JavaScript API loader (P3 §3.7). One functional `@googlemaps/js-api-loader` setup per page;
 * libraries load on demand. Resolves to `null` when no browser key is configured or loading fails, and
 * every caller then falls back (plain inputs + server geocoding, SVG route map).
 *
 * Why `@googlemaps/js-api-loader` (not `@vis.gl/react-google-maps`): TAKI needs two small surfaces (an
 * accessible Places (New) suggestion list styled with our own Input, and one route map). The loader is
 * framework-agnostic, tiny and exposes `importLibrary` directly; the React wrapper would add a provider
 * tree and components we would restyle anyway.
 */
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

/** Restricted browser key (HTTP referrers = app domains; APIs = Maps JavaScript + Places (New)). */
export function mapsBrowserKey(): string | null {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY?.trim() || null;
}

/** Optional cloud map id (needed for AdvancedMarkerElement). */
export function mapsMapId(): string | null {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID?.trim() || null;
}

let configured = false;
let failed = false;

type LibraryName = keyof google.maps.ImportLibraryMap;

export async function loadMapsLibrary<T extends LibraryName>(name: T): Promise<google.maps.ImportLibraryMap[T] | null> {
  const key = mapsBrowserKey();
  if (!key || failed || typeof window === "undefined") return null;
  if (!configured) {
    setOptions({ key, v: "weekly", region: "IN", language: "en-IN" });
    configured = true;
  }
  try {
    return await importLibrary(name);
  } catch {
    failed = true; // bad key, blocked script, offline: stay on the fallback for this page view
    return null;
  }
}
