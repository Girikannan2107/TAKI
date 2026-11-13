import type { CSSProperties } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  layoutRouteMap,
  type ChipPlacement,
  type Pt,
  type Regime,
  type RouteMapDrawing,
  type StopLabelPlacement,
} from "./route-map-layout";

export interface RouteMapProps {
  /** Ordered stops (pickup..drop or the whole trip) with approximate hub coordinates. */
  stops: ReadonlyArray<{ name: string; lat: number; lng: number }>;
  variant?: "card" | "modal";
  className?: string;
  /** Visible caption. Default "Illustrative route — not live location". */
  caption?: string;
}

/**
 * Illustrative route map (screen 08). A static SVG drawn from the stops' approximate
 * coordinates — NOT a live map and never a GPS position. Server-safe (no hooks).
 *
 * Pins and label chips are an HTML overlay with a constant pixel size. Their placement
 * (above the pin by default; beside or below only when the top edge, the route line, a
 * stop dot or another label is in the way) is precomputed in `route-map-layout.ts` for two
 * container-width regimes, switched with container queries at 520px (`@min-[520px]:`).
 */
export function RouteMap({
  stops,
  variant = "card",
  className,
  caption = "Illustrative route — not live location",
}: RouteMapProps) {
  const names = stops.map((s) => s.name);
  const layout = layoutRouteMap(
    stops.map((s) => ({ lat: s.lat, lng: s.lng })),
    names,
    variant,
    names.join("|"),
  );
  const { w, h } = layout;

  const first = names[0] ?? "";
  const last = names[names.length - 1] ?? "";
  const via = names.slice(1, -1);
  const label =
    names.length > 1
      ? `Illustrative route map from ${first} to ${last}${via.length ? ` via ${joinList(via)}` : ""}. Not a live location.`
      : "Illustrative route map. Not a live location.";

  return (
    <figure
      className={cn(
        "m-0 overflow-hidden rounded-lg border border-border bg-surface",
        className,
      )}
    >
      <div
        className={cn(
          "@container relative bg-map-land",
          variant === "card" ? "aspect-[16/10]" : "aspect-[640/440]",
        )}
      >
        <svg
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={label}
          className="absolute inset-0 size-full"
          preserveAspectRatio="xMidYMid meet"
          focusable="false"
        >
          <MapBackdrop w={w} h={h} />
          <RouteLine d={layout.compact.d} className="@min-[520px]:hidden" />
          <RouteLine
            d={layout.regular.d}
            className="hidden @min-[520px]:inline"
          />
        </svg>

        {/* Markers + labels (decorative: the svg carries the accessible label). */}
        <Overlay
          drawing={layout.compact}
          regime="compact"
          names={names}
          w={w}
          h={h}
          className="@min-[520px]:hidden"
        />
        <Overlay
          drawing={layout.regular}
          regime="regular"
          names={names}
          w={w}
          h={h}
          className="hidden @min-[520px]:block"
        />
      </div>

      <figcaption className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-caption text-ink-muted">
        <Info
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3.5 shrink-0 text-green-700"
        />
        {caption}
      </figcaption>
    </figure>
  );
}

function RouteLine({ d, className }: { d: string; className: string }) {
  if (!d) return null;
  return (
    <g
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path
        d={d}
        className="stroke-surface"
        strokeWidth={10}
        opacity={0.85}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={d}
        className="stroke-green-700"
        strokeWidth={6}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

// Class lookups are written out in full so Tailwind can see every class.
// Sizes and offsets mirror the px values assumed in route-map-layout.ts (CHIP, STOP_LABEL); change both together.
const PIN_CLASS: Record<Regime, string> = {
  compact: "-left-[9px] -top-6 h-6 w-[18px]",
  regular: "-left-3 -top-8 h-8 w-6",
};
const CHIP_BASE: Record<Regime, string> = {
  compact: "rounded-sm px-2 py-1 text-[11px] leading-4",
  regular: "gap-1.5 rounded-md px-2.5 py-1.5 text-sm",
};
const CHIP_V: Record<Regime, Record<ChipPlacement["v"], string>> = {
  compact: { above: "bottom-8", side: "bottom-0.5", below: "top-2" },
  regular: { above: "bottom-10", side: "bottom-1", below: "top-2" },
};
const CHIP_H: Record<
  Regime,
  Record<"stacked" | "side", Record<ChipPlacement["h"], string>>
> = {
  compact: {
    stacked: {
      east: "left-[-14px]",
      center: "left-1/2 -translate-x-1/2",
      west: "right-[-14px]",
    },
    side: { east: "left-[13px]", center: "left-[13px]", west: "right-[13px]" },
  },
  regular: {
    stacked: {
      east: "left-[-14px]",
      center: "left-1/2 -translate-x-1/2",
      west: "right-[-14px]",
    },
    side: { east: "left-4", center: "left-4", west: "right-4" },
  },
};
const STOP_LABEL_CLASS: Record<StopLabelPlacement, string> = {
  below: "left-1/2 top-full mt-1 -translate-x-1/2",
  above: "left-1/2 bottom-full mb-1 -translate-x-1/2",
  east: "left-full top-1/2 ml-1.5 -translate-y-1/2",
  west: "right-full top-1/2 mr-1.5 -translate-y-1/2",
  se: "left-full top-full ml-1 mt-1",
  sw: "right-full top-full mr-1 mt-1",
  ne: "left-full bottom-full ml-1 mb-1",
  nw: "right-full bottom-full mr-1 mb-1",
};

function Overlay({
  drawing,
  regime,
  names,
  w,
  h,
  className,
}: {
  drawing: RouteMapDrawing;
  regime: Regime;
  names: string[];
  w: number;
  h: number;
  className: string;
}) {
  const { points, stopLabels } = drawing;
  const pct = (p: Pt): CSSProperties => ({
    left: `${(p.x / w) * 100}%`,
    top: `${(p.y / h) * 100}%`,
  });
  const start = points[0];
  const end = points.length > 1 ? points[points.length - 1] : undefined;
  const stops = points.slice(1, -1);
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0", className)}
    >
      {stops.map((p, i) => (
        <span
          key={`${names[i + 1]}-${i}`}
          className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-green-700 bg-surface shadow-card"
          style={pct(p)}
        >
          {stopLabels ? (
            <span
              className={cn(
                "absolute whitespace-nowrap rounded-sm bg-surface/90 px-1.5 py-px text-[11px] font-medium leading-4 text-ink-muted",
                STOP_LABEL_CLASS[stopLabels[i] ?? "below"],
              )}
            >
              {names[i + 1]}
            </span>
          ) : null}
        </span>
      ))}
      {end ? (
        <Marker
          tone="end"
          name={names[names.length - 1] ?? ""}
          placement={drawing.endChip}
          regime={regime}
          style={pct(end)}
        />
      ) : null}
      {start ? (
        <Marker
          tone="start"
          name={names[0] ?? ""}
          placement={drawing.startChip}
          regime={regime}
          style={pct(start)}
        />
      ) : null}
    </div>
  );
}

const PIN_PATH =
  "M12 31C10.5 27 3 20.6 3 12.5a9 9 0 1 1 18 0C21 20.6 13.5 27 12 31Z";

function Marker({
  tone,
  name,
  placement,
  regime,
  style,
}: {
  tone: "start" | "end";
  name: string;
  placement: ChipPlacement;
  regime: Regime;
  style: CSSProperties;
}) {
  const pinColor = tone === "start" ? "fill-green-700" : "fill-danger";
  const horizontal =
    CHIP_H[regime][placement.v === "side" ? "side" : "stacked"][placement.h];
  return (
    <span className="absolute" style={style}>
      {/* pin: tip sits on the point */}
      <svg
        viewBox="0 0 24 32"
        className={cn("absolute drop-shadow-sm", PIN_CLASS[regime])}
      >
        <path d={PIN_PATH} className={pinColor} />
        <circle cx="12" cy="12.5" r="3.6" className="fill-surface" />
      </svg>
      <span
        className={cn(
          "absolute flex items-center whitespace-nowrap bg-surface font-semibold text-ink shadow-raised",
          CHIP_BASE[regime],
          CHIP_V[regime][placement.v],
          horizontal,
        )}
      >
        {regime === "regular" ? (
          <svg viewBox="0 0 24 32" className="h-3.5 w-3 shrink-0">
            <path d={PIN_PATH} className={pinColor} />
            <circle cx="12" cy="12.5" r="3.6" className="fill-surface" />
          </svg>
        ) : null}
        {name}
      </span>
    </span>
  );
}

/** Pale land, soft patches, faint roads and water. Fixed decoration (not geographic). */
function MapBackdrop({ w, h }: { w: number; h: number }) {
  const X = (f: number) => f * w;
  const Y = (f: number) => f * h;
  return (
    <g aria-hidden="true">
      <rect width={w} height={h} className="fill-map-land" />
      <g className="fill-green-200" opacity={0.55}>
        <ellipse cx={X(0.18)} cy={Y(0.22)} rx={X(0.14)} ry={Y(0.12)} />
        <ellipse cx={X(0.55)} cy={Y(0.78)} rx={X(0.18)} ry={Y(0.1)} />
        <ellipse cx={X(0.86)} cy={Y(0.42)} rx={X(0.1)} ry={Y(0.16)} />
        <ellipse cx={X(0.4)} cy={Y(0.4)} rx={X(0.08)} ry={Y(0.07)} />
      </g>
      <g className="fill-green-50" opacity={0.8}>
        <ellipse cx={X(0.7)} cy={Y(0.15)} rx={X(0.12)} ry={Y(0.08)} />
        <ellipse cx={X(0.12)} cy={Y(0.7)} rx={X(0.1)} ry={Y(0.12)} />
        <ellipse cx={X(0.32)} cy={Y(0.9)} rx={X(0.09)} ry={Y(0.06)} />
      </g>
      {/* water */}
      <g fill="none" className="stroke-map-water" strokeLinecap="round">
        <path
          d={`M${X(-0.02)} ${Y(0.34)} C${X(0.12)} ${Y(0.3)} ${X(0.2)} ${Y(0.42)} ${X(0.32)} ${Y(0.36)} S${X(0.5)} ${Y(0.22)} ${X(0.62)} ${Y(0.3)} S${X(0.8)} ${Y(0.2)} ${X(1.02)} ${Y(0.26)}`}
          strokeWidth={3.5}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`M${X(0.48)} ${Y(1.02)} C${X(0.5)} ${Y(0.86)} ${X(0.62)} ${Y(0.8)} ${X(0.66)} ${Y(0.66)} S${X(0.76)} ${Y(0.54)} ${X(0.84)} ${Y(0.6)}`}
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
        />
      </g>
      <ellipse
        cx={X(0.9)}
        cy={Y(0.82)}
        rx={X(0.05)}
        ry={Y(0.05)}
        className="fill-map-water"
      />
      <ellipse
        cx={X(0.22)}
        cy={Y(0.55)}
        rx={X(0.025)}
        ry={Y(0.03)}
        className="fill-map-water"
      />
      {/* roads */}
      <g
        fill="none"
        className="stroke-surface"
        strokeLinecap="round"
        opacity={0.9}
      >
        <path
          d={`M${X(0)} ${Y(0.62)} C${X(0.25)} ${Y(0.58)} ${X(0.45)} ${Y(0.66)} ${X(0.7)} ${Y(0.5)} S${X(0.92)} ${Y(0.36)} ${X(1)} ${Y(0.4)}`}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`M${X(0.28)} ${Y(0)} C${X(0.3)} ${Y(0.3)} ${X(0.22)} ${Y(0.6)} ${X(0.3)} ${Y(1)}`}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`M${X(0.66)} ${Y(0)} C${X(0.6)} ${Y(0.25)} ${X(0.76)} ${Y(0.55)} ${X(0.7)} ${Y(1)}`}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`M${X(0)} ${Y(0.12)} C${X(0.3)} ${Y(0.18)} ${X(0.6)} ${Y(0.06)} ${X(1)} ${Y(0.14)}`}
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`M${X(0)} ${Y(0.88)} C${X(0.2)} ${Y(0.8)} ${X(0.5)} ${Y(0.94)} ${X(1)} ${Y(0.84)}`}
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`M${X(0.08)} ${Y(1)} L${X(0.46)} ${Y(0.46)} L${X(0.52)} ${Y(0)}`}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`M${X(0.86)} ${Y(1)} C${X(0.9)} ${Y(0.7)} ${X(0.82)} ${Y(0.3)} ${X(0.94)} ${Y(0)}`}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </g>
  );
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
