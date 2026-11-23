import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface ChipProps {
  label: string;
  /** Renders a remove button with aria-label "Remove {label}". */
  onRemove?(): void;
  /** add = mint "+ Add Stop" button chip. */
  variant?: "default" | "add";
  onClick?(): void;
  className?: string;
}

export function Chip({ label, onRemove, variant = "default", onClick, className }: ChipProps) {
  if (variant === "add") {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-full bg-mint-100 px-3.5 text-sm font-semibold text-green-800 transition-colors hover:bg-green-300/70 pointer-coarse:min-h-11",
          className,
        )}
      >
        <Plus aria-hidden="true" strokeWidth={2} className="size-4" />
        {label}
      </button>
    );
  }

  const body = <span className="truncate">{label}</span>;
  return (
    <span
      className={cn(
        "inline-flex h-9 max-w-full items-center gap-1 rounded-full border border-border bg-surface-muted text-sm font-medium text-ink",
        onRemove ? "pl-3.5 pr-1" : "px-3.5",
        className,
      )}
    >
      {onClick ? (
        <button type="button" onClick={onClick} className="truncate rounded-full">
          {label}
        </button>
      ) : (
        body
      )}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-ink/8 hover:text-ink after:absolute after:-inset-2 after:content-['']"
        >
          <X aria-hidden="true" strokeWidth={2} className="size-4" />
        </button>
      ) : null}
    </span>
  );
}
