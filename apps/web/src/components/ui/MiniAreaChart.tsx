import { useId } from "react";
import { cn } from "@/lib/utils/cn";

export interface MiniAreaChartProps {
  data: number[];
  width?: number;
  height?: number;
  /** onDark = lime line on the green earnings card; onLight = green line on white. */
  tone?: "onDark" | "onLight";
  /** Text summary for screen readers, e.g. "Earnings trend, up 12% vs last month". */
  ariaLabel: string;
  className?: string;
}

function buildPaths(data: number[], w: number, h: number) {
  const pad = 3;
  const values = data.length === 1 ? [data[0], data[0]] : data;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => [pad + i * step, pad + (h - pad * 2) * (1 - (v - min) / span)] as const);

  // Smooth curve: cubic segments with horizontal control points at the midpoint.
  let line = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    line += ` C${mx.toFixed(2)},${y0.toFixed(2)} ${mx.toFixed(2)},${y1.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  const last = pts[pts.length - 1];
  const area = `${line} L${last[0].toFixed(2)},${h} L${pts[0][0].toFixed(2)},${h} Z`;
  return { line, area };
}

/** Decorative sparkline with gradient fill. Data is summarised via `ariaLabel` (role="img"). */
export function MiniAreaChart({ data, width = 240, height = 72, tone = "onDark", ariaLabel, className }: MiniAreaChartProps) {
  const gradientId = `mac-${useId().replace(/:/g, "")}`;
  if (data.length === 0) return null;
  const { line, area } = buildPaths(data, width, height);
  const stroke = tone === "onDark" ? "stroke-lime-300" : "stroke-green-500";
  const stop = tone === "onDark" ? "text-lime-300" : "text-green-500";

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("block h-auto w-full overflow-visible", className)}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1" className={stop}>
          <stop offset="0%" stopColor="currentColor" stopOpacity={tone === "onDark" ? 0.45 : 0.28} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        className={stroke}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
