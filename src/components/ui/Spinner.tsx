import { cn } from "@/lib/utils/cn";

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  /** Accessible label. Default "Loading". Pass "" for a purely decorative spinner (e.g. inside a busy button). */
  label?: string;
  className?: string;
}

const sizes = { sm: "size-[18px]", md: "size-6", lg: "size-10" } as const;

export function Spinner({ size = "md", label = "Loading", className }: SpinnerProps) {
  const svg = (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn("shrink-0 animate-spin", sizes[size], className)}>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.22" strokeWidth="3" />
      <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  if (label === "") return svg;
  return (
    <span role="status" className="inline-flex items-center">
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  );
}
