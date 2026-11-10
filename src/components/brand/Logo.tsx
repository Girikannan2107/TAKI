import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

export interface LogoProps {
  /** The SURFACE the logo sits on: "light" (cream/white pages) or "dark" (hero, sidebar, footer). */
  variant?: "light" | "dark";
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  /** Default "/". Pass null to render without a link. */
  href?: string | null;
  /** Preload the symbol image (use above the fold, e.g. landing header). */
  priority?: boolean;
  className?: string;
}

const SYMBOL_SRC = "/assets/taki/branding/taki_symbol_transparent.png";
const RATIO = 262 / 229; // height / width of the source PNG

const sizes = {
  sm: { symbol: 26, tile: "size-9", taki: "text-[17px]", travel: "text-[8px]", gap: "gap-2" },
  md: { symbol: 32, tile: "size-10", taki: "text-[21px]", travel: "text-[9.5px]", gap: "gap-2.5" },
  lg: { symbol: 44, tile: "size-14", taki: "text-[28px]", travel: "text-[12px]", gap: "gap-3" },
} as const;

/** Pin symbol + "TAKI / TRAVEL" Montserrat wordmark. */
export function Logo({ variant = "light", size = "md", showWordmark = true, href = "/", priority, className }: LogoProps) {
  const s = sizes[size];
  const onDark = variant === "dark";
  const symbolW = onDark ? Math.round(s.symbol * 0.82) : s.symbol;

  const symbol = (
    <Image
      src={SYMBOL_SRC}
      alt={showWordmark || href ? "" : "TAKI Travel"}
      width={symbolW}
      height={Math.round(symbolW * RATIO)}
      preload={priority}
      sizes={`${symbolW}px`}
      className="h-auto shrink-0 select-none"
      draggable={false}
    />
  );

  const content = (
    <>
      {onDark ? (
        // Cream tile hides the PNG's light matte fringe on dark backgrounds.
        <span className={cn("flex shrink-0 items-center justify-center rounded-md bg-canvas", s.tile)}>{symbol}</span>
      ) : (
        symbol
      )}
      {showWordmark ? (
        <span className="flex flex-col font-heading leading-none" aria-hidden={href ? true : undefined}>
          <span className={cn("font-bold tracking-[0.28em]", s.taki, onDark ? "text-white" : "text-green-950")}>TAKI</span>
          <span
            className={cn(
              "mt-1 font-semibold tracking-[0.5em]",
              s.travel,
              onDark ? "text-lime-300" : "text-green-500",
            )}
          >
            TRAVEL
          </span>
        </span>
      ) : null}
    </>
  );

  const classes = cn("inline-flex shrink-0 items-center", s.gap, className);

  if (href === null) {
    return (
      <span className={classes} role={showWordmark ? "img" : undefined} aria-label={showWordmark ? "TAKI Travel" : undefined}>
        {content}
      </span>
    );
  }
  return (
    <Link href={href} aria-label="TAKI Travel home" className={cn(classes, "rounded-md")}>
      {content}
    </Link>
  );
}
