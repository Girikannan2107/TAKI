"use client";

import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { IconButton } from "./IconButton";
import { useDialog } from "./useDialog";

export interface ModalProps {
  open: boolean;
  onClose(): void;
  title: string;
  description?: string;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
  footer?: ReactNode;
  /** Hide the top-right close (X) button, e.g. while a blocking action runs. */
  hideClose?: boolean;
}

const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

/**
 * Native <dialog> + showModal(): background is inert, focus is trapped inside the page,
 * Esc and backdrop click call onClose, focus returns to the trigger on close.
 */
export function Modal({ open, onClose, title, description, size = "md", children, footer, hideClose }: ModalProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descId = description ? `${id}-desc` : undefined;
  const dialogProps = useDialog(open, onClose);

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={titleId}
      aria-describedby={descId}
      className={cn(
        "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-visible rounded-xl bg-transparent text-ink",
        "open:motion-safe:animate-pop-in backdrop:motion-safe:animate-fade-in",
        sizes[size],
      )}
    >
      {open ? (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-xl bg-surface shadow-auth">
          <div className="flex items-start gap-3 px-5 pb-2 pt-5 sm:px-6 sm:pt-6">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="type-h3 text-ink">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="mt-1 text-sm text-ink-muted">
                  {description}
                </p>
              ) : null}
            </div>
            {hideClose ? null : (
              <IconButton
                label="Close dialog"
                icon={<X strokeWidth={1.75} />}
                size="sm"
                onClick={onClose}
                className="-mr-2 -mt-1"
              />
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:px-6">{children}</div>
          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              {footer}
            </div>
          ) : (
            <div className="h-3" />
          )}
        </div>
      ) : null}
    </dialog>
  );
}
