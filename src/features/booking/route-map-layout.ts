/**
 * Pure geometry for RouteMap: projection, the wavy route line and collision-aware
 * label placement. Dependency-free so it can be reasoned about (and run) in isolation.
 *
 * Labels are HTML chips with a constant pixel size laid over an SVG that scales with
 * its container. Placement is therefore computed per size "regime" (container width
 * below / at least LABEL_REGIME_BREAKPOINT px) at the narrowest width of that regime,
 * the worst case, and RouteMap switches chips with container queries.
 */

export interface Pt {
  x: number;
  y: number;
}

export type MapVariant = "card" | "modal";
export type Regime = "compact" | "regular";

export const MAP_SIZE: Record<MapVariant, { w: number; h: number }> = {
  card: { w: 640, h: 400 },
  modal: { w: 640, h: 440 },
};
interface Pad {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
/**
 * Inner padding (viewBox units) per regime: room above for a chip over its pin and below for one that
 * flips under it. Compact chips are relatively bigger (the map is ~290px wide), so they need more.
 */
const PAD: Record<Regime, Pad> = {
  compact: { left: 64, right: 64, top: 132, bottom: 76 },
  regular: { left: 72, right: 72, top: 104, bottom: 64 },
};
/** Minimum lat/lng span so very short routes don't fill the whole frame. */
const MIN_SPAN_DEG = 1.4;

/** Container width (px) where chips switch from compact to regular. Must match the `@min-[520px]` classes in RouteMap. */
export const LABEL_REGIME_BREAKPOINT = 520;
/**
 * Container widths (px) each placement is checked at. Chips keep their pixel size while the map scales,
 * so a spot that is clear at one width can collide at another; a placement must be clear at all of them.
 * (A 360px phone gives a ~296px map; the desktop card is ~600px; tablets ~690px.)
 */
const REGIME_WIDTHS: Record<Regime, readonly number[]> = {
  compact: [288, 340, 400, 460, LABEL_REGIME_BREAKPOINT - 1],
  regular: [LABEL_REGIME_BREAKPOINT, 580, 640, 720, 820],
};

/** Approximate rendered sizes (px) of the overlay elements; keep in sync with RouteMap classes. */
const CHIP = {
  // text-[11px] semibold, px-2 py-1, no icon; 18×24 pin; chip bottom 32px above the tip.
  compact: {
    charW: 6.4,
    extraW: 18,
    h: 24,
    aboveGap: 32,
    sideBottom: 2,
    sideX: 13,
    pinHalfW: 9,
    pinH: 24,
  },
  // text-sm semibold, px-2.5 py-1.5, 12px icon + gap; 24×32 pin; chip bottom 40px above the tip.
  regular: {
    charW: 8,
    extraW: 40,
    h: 32,
    aboveGap: 40,
    sideBottom: 4,
    sideX: 16,
    pinHalfW: 12,
    pinH: 32,
  },
} as const;
const STOP_LABEL = { charW: 6.4, extraW: 14, h: 18 }; // text-[11px] medium, px-1.5
const DOT_R = 6; // size-3
const LINE_HALF = 6; // white casing stroke (10px) / 2 + 1px air
const EDGE = 4; // keep labels this many units inside the frame

/** Where a marker chip sits relative to its pin tip. */
export type ChipVertical = "above" | "side" | "below";
/** Which way the chip extends from the pin. */
export type ChipHorizontal = "east" | "center" | "west";
export interface ChipPlacement {
  v: ChipVertical;
  h: ChipHorizontal;
}
export type StopLabelPlacement =
  "below" | "above" | "east" | "west" | "ne" | "nw" | "se" | "sw";

/** One drawing of the route for a size regime (projected with that regime's padding). */
export interface RouteMapDrawing {
  points: Pt[];
  /** SVG path data for the route line ("" for < 2 points). */
  d: string;
  startChip: ChipPlacement;
  endChip: ChipPlacement;
  /** Intermediate stop labels (regular only; compact maps show unlabelled dots). */
  stopLabels: StopLabelPlacement[] | null;
  /** True when every label found a spot clear of the line, pins, dots and frame edge. */
  clear: boolean;
}

export interface RouteMapLayout {
  w: number;
  h: number;
  compact: RouteMapDrawing;
  regular: RouteMapDrawing;
}

export function layoutRouteMap(
  coords: Array<{ lat: number; lng: number }>,
  names: string[],
  variant: MapVariant,
  seedKey: string,
): RouteMapLayout {
  const { w, h } = MAP_SIZE[variant];
  const draw = (regime: Regime): RouteMapDrawing => {
    const points = project(coords, w, h, PAD[regime]);
    const wave = points.length > 1 ? wavyPoints(points, hash(seedKey)) : points;
    const d = points.length > 1 ? smoothPath(wave) : "";
    const start = points[0];
    const end = points.length > 1 ? points[points.length - 1] : undefined;
    const stops = points.slice(1, -1);

    const samples = densify(wave, 3);
    const ctxs: ScoreCtx[] = REGIME_WIDTHS[regime].map((px) => {
      const u = w / px; // viewBox units per CSS px at this container width
      const pins = [start, end]
        .filter(Boolean)
        .map((p) => pinRect(p!, regime, u));
      const dots = stops.map((p) =>
        inflate({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }, (DOT_R + 2) * u),
      );
      return { w, h, u, samples, obstacles: [...pins, ...dots], placed: [] };
    });
    const state = { worst: 0 };

    // Destination first (it is the one most often crowded by the incoming line), then origin, then stops.
    const chip = (pt: Pt, name: string): ChipPlacement => {
      const preferred: ChipHorizontal =
        pt.x / w < 0.35 ? "east" : pt.x / w > 0.65 ? "west" : "center";
      return place(
        ctxs,
        state,
        CHIP_CANDIDATES,
        (c, u) => chipRect(pt, name, c, regime, u),
        (c) => VERTICAL_PENALTY[c.v] + (c.h === preferred ? 0 : 2),
      );
    };
    const fallback: ChipPlacement = { v: "above", h: "center" };
    const endChip = end ? chip(end, names[names.length - 1] ?? "") : fallback;
    const startChip = start ? chip(start, names[0] ?? "") : fallback;
    const stopLabels =
      regime === "regular"
        ? stops.map((pt, i) =>
            place(
              ctxs,
              state,
              STOP_CANDIDATES,
              (c, u) => stopLabelRect(pt, names[i + 1] ?? "", c, u),
              (c) => STOP_PENALTY[c],
            ),
          )
        : null;
    return {
      points,
      d,
      startChip,
      endChip,
      stopLabels,
      clear: state.worst < 100,
    };
  };
  return { w, h, compact: draw("compact"), regular: draw("regular") };
}

// ───────────────────────────── placement ─────────────────────────────

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface ScoreCtx {
  w: number;
  h: number;
  u: number;
  samples: Pt[];
  obstacles: Rect[];
  placed: Rect[];
}

const CHIP_CANDIDATES: ChipPlacement[] = (
  ["above", "side", "below"] as const
).flatMap((v) =>
  (v === "side"
    ? (["east", "west"] as const)
    : (["east", "center", "west"] as const)
  ).map((h) => ({ v, h })),
);
const VERTICAL_PENALTY: Record<ChipVertical, number> = {
  above: 0,
  side: 8,
  below: 16,
};

/**
 * Picks the candidate with the lowest worst-case collision cost over all checked widths (plus a small
 * preference penalty), then records its rects as obstacles for the labels placed after it.
 */
function place<T>(
  ctxs: ScoreCtx[],
  state: { worst: number },
  candidates: readonly T[],
  rectFor: (c: T, u: number) => Rect,
  penalty: (c: T) => number,
): T {
  let best: T = candidates[0] as T;
  let bestCost = Infinity;
  let bestCollision = 0;
  for (const c of candidates) {
    let collision = 0;
    for (const ctx of ctxs)
      collision = Math.max(collision, collisionCost(ctx, rectFor(c, ctx.u)));
    const cost = collision + penalty(c);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
      bestCollision = collision;
    }
  }
  state.worst = Math.max(state.worst, bestCollision);
  for (const ctx of ctxs) ctx.placed.push(rectFor(best, ctx.u));
  return best;
}

function chipRect(
  p: Pt,
  name: string,
  c: ChipPlacement,
  regime: Regime,
  u: number,
): Rect {
  const m = CHIP[regime];
  const W = (name.length * m.charW + m.extraW) * u;
  const H = m.h * u;
  let y1: number;
  if (c.v === "above") y1 = p.y - m.aboveGap * u;
  else if (c.v === "side")
    y1 = p.y - m.sideBottom * u; // beside the pin head
  else y1 = p.y + 8 * u + H; // top-2
  let x0: number;
  if (c.v === "side")
    x0 = c.h === "east" ? p.x + m.sideX * u : p.x - m.sideX * u - W;
  else if (c.h === "east")
    x0 = p.x - 14 * u; // left-[-14px]
  else if (c.h === "west")
    x0 = p.x + 14 * u - W; // right-[-14px]
  else x0 = p.x - W / 2;
  return { x0, y0: y1 - H, x1: x0 + W, y1 };
}

const STOP_CANDIDATES: StopLabelPlacement[] = [
  "below",
  "above",
  "east",
  "west",
  "se",
  "nw",
  "ne",
  "sw",
];
const STOP_PENALTY: Record<StopLabelPlacement, number> = {
  below: 0,
  above: 1,
  east: 2,
  west: 2,
  se: 3,
  nw: 3,
  ne: 3,
  sw: 3,
};

function stopLabelRect(
  p: Pt,
  name: string,
  c: StopLabelPlacement,
  u: number,
): Rect {
  const W = (name.length * STOP_LABEL.charW + STOP_LABEL.extraW) * u;
  const H = STOP_LABEL.h * u;
  switch (c) {
    case "below":
      return {
        x0: p.x - W / 2,
        y0: p.y + 10 * u,
        x1: p.x + W / 2,
        y1: p.y + 10 * u + H,
      };
    case "above":
      return {
        x0: p.x - W / 2,
        y0: p.y - 10 * u - H,
        x1: p.x + W / 2,
        y1: p.y - 10 * u,
      };
    case "east":
      return {
        x0: p.x + 12 * u,
        y0: p.y - H / 2,
        x1: p.x + 12 * u + W,
        y1: p.y + H / 2,
      };
    case "west":
      return {
        x0: p.x - 12 * u - W,
        y0: p.y - H / 2,
        x1: p.x - 12 * u,
        y1: p.y + H / 2,
      };
    // Diagonals: the label's corner sits 10px from the dot centre on both axes.
    case "se":
      return {
        x0: p.x + 10 * u,
        y0: p.y + 10 * u,
        x1: p.x + 10 * u + W,
        y1: p.y + 10 * u + H,
      };
    case "sw":
      return {
        x0: p.x - 10 * u - W,
        y0: p.y + 10 * u,
        x1: p.x - 10 * u,
        y1: p.y + 10 * u + H,
      };
    case "ne":
      return {
        x0: p.x + 10 * u,
        y0: p.y - 10 * u - H,
        x1: p.x + 10 * u + W,
        y1: p.y - 10 * u,
      };
    case "nw":
      return {
        x0: p.x - 10 * u - W,
        y0: p.y - 10 * u - H,
        x1: p.x - 10 * u,
        y1: p.y - 10 * u,
      };
  }
}

/** Lower is better: clipping > covering a pin/dot/label > covering the route line. */
function collisionCost(ctx: ScoreCtx, r: Rect): number {
  let cost = 0;
  const overflow =
    Math.max(0, EDGE - r.x0) +
    Math.max(0, r.x1 - (ctx.w - EDGE)) +
    Math.max(0, EDGE - r.y0) +
    Math.max(0, r.y1 - (ctx.h - EDGE));
  if (overflow > 0) cost += 2000 + overflow * 10;
  for (const o of ctx.obstacles) if (intersects(r, o)) cost += 600;
  for (const o of ctx.placed) if (intersects(r, o)) cost += 800;
  const lineBox = inflate(r, LINE_HALF * ctx.u);
  for (const s of ctx.samples)
    if (
      s.x >= lineBox.x0 &&
      s.x <= lineBox.x1 &&
      s.y >= lineBox.y0 &&
      s.y <= lineBox.y1
    )
      cost += 100;
  return cost;
}

function pinRect(p: Pt, regime: Regime, u: number): Rect {
  const m = CHIP[regime];
  return {
    x0: p.x - m.pinHalfW * u,
    y0: p.y - m.pinH * u,
    x1: p.x + m.pinHalfW * u,
    y1: p.y,
  };
}

function inflate(r: Rect, by: number): Rect {
  return { x0: r.x0 - by, y0: r.y0 - by, x1: r.x1 + by, y1: r.y1 + by };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Points every `step` units along a polyline. */
function densify(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++)
      out.push({
        x: a.x + ((b.x - a.x) * k) / n,
        y: a.y + ((b.y - a.y) * k) / n,
      });
  }
  if (pts.length) out.push(pts[pts.length - 1]!);
  return out;
}

// ───────────────────────────── geometry ─────────────────────────────

/** Equirectangular projection of lat/lng into the viewBox, uniform scale, centred, with padding. */
function project(
  coords: Array<{ lat: number; lng: number }>,
  w: number,
  h: number,
  pad: Pad,
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
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const scale = Math.min(innerW / (maxX - minX), innerH / (maxY - minY));
  const offX = pad.left + (innerW - (maxX - minX) * scale) / 2;
  const offY = pad.top + (innerH - (maxY - minY) * scale) / 2;
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
