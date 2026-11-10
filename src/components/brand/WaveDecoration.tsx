import { cn } from "@/lib/utils/cn";

export interface WaveDecorationProps {
  position?: "bottom" | "top";
  className?: string;
}

/** Three layered soft-green waves (back → front: wave-3, wave-2, wave-1). Decorative. */
export function WaveDecoration({ position = "bottom", className }: WaveDecorationProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 440 96"
      preserveAspectRatio="none"
      className={cn(
        "pointer-events-none block h-[72px] w-full sm:h-[88px]",
        position === "top" && "-scale-y-100",
        className,
      )}
    >
      <path
        className="fill-wave-3"
        fillOpacity={0.55}
        d="M0 58 C 70 30, 150 30, 230 50 S 380 78, 440 26 L 440 96 L 0 96 Z"
      />
      <path
        className="fill-wave-2"
        fillOpacity={0.6}
        d="M0 70 C 90 48, 170 56, 250 68 S 380 70, 440 46 L 440 96 L 0 96 Z"
      />
      <path
        className="fill-wave-1"
        fillOpacity={0.9}
        d="M0 80 C 80 66, 160 72, 240 82 S 370 86, 440 66 L 440 96 L 0 96 Z"
      />
    </svg>
  );
}
