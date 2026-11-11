import type { CSSProperties } from "react";
import { Info } from "lucide-react";
import type { CityId } from "@/lib/domain/types";
import { cityName, getCity } from "@/lib/domain/cities";
import { cn } from "@/lib/utils/cn";

export interface RouteMapProps {
  /** Ordered pickup..drop, including intermediate stops. */
  cityIds: CityId[];
  variant?: "card" | "modal";
  className?: string;
  /** Visible caption chip. Default "Illustrative route — not live location". */
  caption?: string;
}

interface Pt {
  x: number;
  y: number;
}

const SIZE = { card: { w: 640, h: 400 }, modal: { w: 640, h: 440 } } as const;
const PAD = { left: 72, right: 72, top: 92, bottom: 60 };
/** Minimum lat/lng span so very short routes don't fill the whole frame. */
const MIN_SPAN_DEG = 1.4;

/**
 * Illustrative route map (screen 08). A static SVG drawn from the cities' real
 * coordinates — NOT a live map and never a GPS position. Server-safe (no hooks).
 */
export function RouteMap({
  cityIds,
  variant = "card",
  className,
  caption = "Illustrative route — not live location",
}: RouteMapProps) {
  const { w, h } = SIZE[variant];
  const cities = cityIds
    .map((id) => ({ id, city: getCity(id) }))
    .filter((c) => c.city);
  const points = project(
    cities.map((c) => ({ lat: c.city!.lat, lng: c.city!.lng })),
    w,
    h,
  );
  const names = cityIds.map(cityName);
  const first = names[0] ?? "";
  const last = names[names.length - 1] ?? "";
  const via = names.slice(1, -1);
  const label =
    names.length > 1
      ? `Illustrative route map from ${first} to ${last}${via.length ? ` via ${joinList(via)}` : ""}. Not a live location.`
      : "Illustrative route map. Not a live location.";

  const seed = hash(cityIds.join("|"));
  const routeD = points.length > 1 ? smoothPath(wavyPoints(points, seed)) : "";
  const pct = (p: Pt) => ({
    left: `${(p.x / w) * 100}%`,
    top: `${(p.y / h) * 100}%`,
  });

  const start = points[0];
  const end = points.length > 1 ? points[points.length - 1] : undefined;
  const stops = points.slice(1, -1);

  return (
    <figure
      className={cn(
        "m-0 overflow-hidden rounded-lg border border-border bg-surface",
        className,
      )}
    >
      <div
        className={cn(
          "relative bg-map-land",
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
          {routeD ? (
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path
                d={routeD}
                className="stroke-surface"
                strokeWidth={10}
                opacity={0.85}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={routeD}
                className="stroke-green-700"
                strokeWidth={6}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ) : null}
        </svg>

        {/* Markers + labels: HTML overlay positioned in % so they keep a constant size. Decorative (the svg carries the label). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          {stops.map((p, i) => (
            <span
              key={`${cityIds[i + 1]}-${i}`}
              className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-green-700 bg-surface shadow-card"
              style={pct(p)}
            >
              <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-sm bg-surface/85 px-1.5 py-px text-[11px] font-medium leading-4 text-ink-muted max-sm:hidden">
                {names[i + 1]}
              </span>
            </span>
          ))}
          {end ? (
            <Marker
              point={end}
              tone="end"
              name={last}
              w={w}
              h={h}
              style={pct(end)}
            />
          ) : null}
          {start ? (
            <Marker
              point={start}
              tone="start"
              name={first}
              w={w}
              h={h}
              style={pct(start)}
            />
          ) : null}
        </div>
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

function Marker({
  point,
  tone,
  name,
  w,
  h,
  style,
}: {
  point: Pt;
  tone: "start" | "end";
  name: string;
  w: number;
  h: number;
  style: CSSProperties;
}) {
  // Anchor the chip so it grows away from the nearest edges: sideways by x, below the pin when the point is near the top.
  const ratio = point.x / w;
  const chipAnchor =
    ratio < 0.35
      ? "left-[-14px]"
      : ratio > 0.65
        ? "right-[-14px]"
        : "left-1/2 -translate-x-1/2";
  const chipVertical = point.y / h < 0.3 ? "top-2" : "bottom-10";
  const pinColor = tone === "start" ? "fill-green-700" : "fill-danger";
  return (
    <span className="absolute" style={style}>
      {/* pin: tip sits on the point */}
      <svg
        viewBox="0 0 24 32"
        className="absolute -left-3 -top-8 h-8 w-6 drop-shadow-sm"
      >
        <path
          d="M12 31C10.5 27 3 20.6 3 12.5a9 9 0 1 1 18 0C21 20.6 13.5 27 12 31Z"
          className={pinColor}
        />
        <circle cx="12" cy="12.5" r="3.6" className="fill-surface" />
      </svg>
      <span
        className={cn(
          "absolute flex items-center gap-1.5 whitespace-nowrap rounded-md bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink shadow-raised sm:text-sm",
          chipVertical,
          chipAnchor,
        )}
      >
        <svg viewBox="0 0 24 32" className="h-3.5 w-3 shrink-0">
          <path
            d="M12 31C10.5 27 3 20.6 3 12.5a9 9 0 1 1 18 0C21 20.6 13.5 27 12 31Z"
            className={pinColor}
          />
          <circle cx="12" cy="12.5" r="3.6" className="fill-surface" />
        </svg>
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

/** Equirectangular projection of lat/lng into the viewBox, uniform scale, centred, with padding. */
function project(
  coords: Array<{ lat: number; lng: number }>,
  w: number,
  h: number,
): Pt[] {
  if (coords.length === 0) return [];
  const meanLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
  const kx = Math.cos((meanLat * Math.PI) / 180);
  const xs = coords.map((c) => c.lng * kx);
  const ys = coords.map((c) => -c.lat);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  const grow = (lo: number, hi: number): [number, number] => {
    const span = hi - lo;
    if (span >= MIN_SPAN_DEG) return [lo, hi];
    const mid = (lo + hi) / 2;
    return [mid - MIN_SPAN_DEG / 2, mid + MIN_SPAN_DEG / 2];
  };
  [minX, maxX] = grow(minX, maxX);
  [minY, maxY] = grow(minY, maxY);
  const innerW = w - PAD.left - PAD.right;
  const innerH = h - PAD.top - PAD.bottom;
  const scale = Math.min(innerW / (maxX - minX), innerH / (maxY - minY));
  const offX = PAD.left + (innerW - (maxX - minX) * scale) / 2;
  const offY = PAD.top + (innerH - (maxY - minY) * scale) / 2;
  return xs.map((x, i) => ({
    x: offX + (x - minX) * scale,
    y: offY + (ys[i]! - minY) * scale,
  }));
}

/** Adds a deterministic road-like wiggle between consecutive points (ends of each leg stay fixed). */
function wavyPoints(points: Pt[], seed: number): Pt[] {
  const out: Pt[] = [points[0]!];
  const rand = mulberry32(seed);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const steps = Math.max(5, Math.round(len / 16));
    const amp = Math.min(20, len * 0.09);
    const phase = rand() * Math.PI * 2;
    const freq = 2 + Math.floor(rand() * 2);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const taper = Math.sin(Math.PI * t);
      const jitter = (rand() - 0.5) * 0.5;
      const off =
        s === steps
          ? 0
          : amp * taper * (Math.sin(Math.PI * freq * t + phase) * 0.8 + jitter);
      out.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off });
    }
  }
  return out;
}

/** Catmull-Rom → cubic Bézier path through all points. */
function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(pts[0]!.x)} ${f(pts[0]!.y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
