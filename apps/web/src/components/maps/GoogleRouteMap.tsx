"use client";

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { RouteMap, type RouteMapProps } from "@/features/booking/RouteMap";
import { loadMapsLibrary, mapsBrowserKey, mapsMapId } from "@/lib/maps/loader";
import { cn } from "@/lib/utils/cn";

export interface GoogleRouteMapProps extends RouteMapProps {
  /** Encoded overview polyline from the server (Routes API, cached on the trip). Straight segments without it. */
  polyline?: string | null;
}

const EMERALD = "#087443";

/**
 * Planned route on a real Google map (M3): the server's road polyline in emerald plus a pin per stop
 * (pickup / drop highlighted). There is no GPS in TAKI: this is the plan, never a vehicle position, and the
 * caption says so. Without NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY, or when Maps fails to load, it renders the
 * SVG `RouteMap` sketch with the same props.
 */
export function GoogleRouteMap({ polyline, ...props }: GoogleRouteMapProps) {
  const [hasKey] = useState(() => !!mapsBrowserKey());
  const [failed, setFailed] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const { stops, variant = "card", className, caption = "Planned route — not live location" } = props;
  const stopsKey = stops.map((s) => `${s.lat},${s.lng}`).join("|");

  useEffect(() => {
    if (!hasKey || stops.length < 2) return;
    let alive = true;
    const overlays: Array<{ setMap(m: google.maps.Map | null): void } | google.maps.marker.AdvancedMarkerElement> = [];
    void (async () => {
      const [maps, geometry, marker] = await Promise.all([loadMapsLibrary("maps"), loadMapsLibrary("geometry"), mapsMapId() ? loadMapsLibrary("marker") : null]);
      if (!alive) return;
      if (!maps || !host.current) {
        setFailed(true);
        return;
      }
      const map = new maps.Map(host.current, {
        mapId: mapsMapId() ?? undefined,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "cooperative",
        clickableIcons: false,
      });
      const path = polyline && geometry ? geometry.encoding.decodePath(polyline) : stops.map((s) => new google.maps.LatLng(s.lat, s.lng));
      overlays.push(new maps.Polyline({ path, map, strokeColor: EMERALD, strokeOpacity: 0.9, strokeWeight: 4 }));
      const bounds = new google.maps.LatLngBounds();
      path.forEach((p) => bounds.extend(p));
      stops.forEach((s, i) => {
        const position = { lat: s.lat, lng: s.lng };
        bounds.extend(position);
        const end = i === 0 || i === stops.length - 1;
        if (marker) {
          const pin = new marker.PinElement({ background: end ? EMERALD : "#ffffff", borderColor: EMERALD, glyphColor: end ? "#C8F56A" : EMERALD, scale: end ? 1 : 0.8 });
          overlays.push(new marker.AdvancedMarkerElement({ map, position, title: s.name, content: pin.element }));
        } else {
          overlays.push(
            new google.maps.Marker({
              map,
              position,
              title: s.name,
              icon: { path: google.maps.SymbolPath.CIRCLE, scale: end ? 7 : 5, fillColor: end ? EMERALD : "#ffffff", fillOpacity: 1, strokeColor: EMERALD, strokeWeight: 2 },
            }),
          );
        }
      });
      map.fitBounds(bounds, 32);
    })().catch(() => {
      if (alive) setFailed(true);
    });
    return () => {
      alive = false;
      for (const o of overlays) {
        if ("setMap" in o) o.setMap(null);
        else o.map = null;
      }
    };
    // stopsKey captures the stop coordinates; `stops` itself is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey, stopsKey, polyline]);

  if (!hasKey || failed || stops.length < 2) return <RouteMap {...props} />;

  const names = stops.map((s) => s.name);
  return (
    <figure className={cn("m-0 overflow-hidden rounded-lg border border-border bg-surface", className)}>
      <div
        ref={host}
        role="img"
        aria-label={`Map of the planned route from ${names[0]} to ${names[names.length - 1]}${names.length > 2 ? ` via ${names.slice(1, -1).join(", ")}` : ""}. Not a live location.`}
        className={cn("bg-map-land", variant === "card" ? "aspect-[16/10]" : "aspect-[640/440]")}
      />
      <figcaption className="flex items-center gap-1.5 px-3 py-2 text-caption text-ink-muted">
        <Info aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0" />
        {caption}
      </figcaption>
    </figure>
  );
}
