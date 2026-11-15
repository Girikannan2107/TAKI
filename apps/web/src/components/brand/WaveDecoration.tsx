import { cn } from "@/lib/utils/cn";

export interface WaveDecorationProps {
  position?: "bottom" | "top";
  className?: string;
}

/**
 * Layered soft-green waves along a card edge (back → front: green-300 band, wave-3, wave-2, wave-1).
 * ~12% of an auth card's height, matching the board. Decorative (aria-hidden).
 */
export function WaveDecoration({ position = "bottom", className }: WaveDecorationProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 440 112"
      preserveAspectRatio="none"
      className={cn(
        "pointer-events-none block h-[88px] w-full sm:h-[104px]",
        position === "top" && "-scale-y-100",
        className,
      )}
    >
      <path
        className="fill-green-300"
        fillOpacity={0.6}
        d="M0 46 C 80 18, 170 20, 250 40 S 390 62, 440 14 L 440 112 L 0 112 Z"
      />
      <path
        className="fill-wave-3"
        fillOpacity={0.65}
        d="M0 68 C 70 40, 150 40, 230 60 S 380 90, 440 36 L 440 112 L 0 112 Z"
      />
      <path
        className="fill-wave-2"
        fillOpacity={0.7}
        d="M0 82 C 90 58, 170 66, 250 80 S 380 82, 440 56 L 440 112 L 0 112 Z"
      />
      <path
        className="fill-wave-1"
        fillOpacity={0.95}
        d="M0 94 C 80 78, 160 84, 240 96 S 370 100, 440 78 L 440 112 L 0 112 Z"
      />
    </svg>
  );
}
