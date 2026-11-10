"use client";

import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils/cn";

export interface OtpInputProps {
  length?: 6;
  /** Digits entered so far (contiguous, 0–6 chars). */
  value: string;
  onChange(value: string): void;
  /** Fires when all digits are filled (typed, pasted or autofilled). */
  onComplete?(value: string): void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  "aria-describedby"?: string;
  /** Group label. Default "One-time password". */
  label?: string;
  className?: string;
}

const onlyDigits = (s: string) => s.replace(/\D/g, "");

/**
 * Six single-digit boxes. Auto-advance, Backspace to previous, Arrow/Home/End navigation,
 * paste or SMS autofill (autocomplete="one-time-code") of the whole code.
 */
export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  autoFocus,
  "aria-describedby": describedBy,
  label = "One-time password",
  className,
}: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const code = onlyDigits(value).slice(0, length);
  // Latest committed code: fast typing can fire the next keystroke before the parent re-renders.
  const latest = useRef(code);

  useEffect(() => {
    latest.current = code;
  }, [code]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  function focusBox(i: number) {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))];
    el?.focus();
    el?.select();
  }

  function commit(next: string) {
    const prev = latest.current;
    const clean = onlyDigits(next).slice(0, length);
    if (clean === prev) return;
    latest.current = clean;
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  }

  /** Write `chars` starting at box `start` (clamped so there are never gaps). */
  function writeAt(start: number, chars: string) {
    const code = latest.current;
    const at = Math.min(start, code.length);
    const next = (code.slice(0, at) + chars + code.slice(at + chars.length)).slice(0, length);
    commit(next);
    focusBox(Math.min(at + chars.length, length - 1));
  }

  function handleInput(i: number, raw: string) {
    const code = latest.current;
    const digits = onlyDigits(raw);
    if (!digits) return;
    // Autofill / paste into one box delivers the whole code: fill from the start.
    if (digits.length >= length) {
      commit(digits.slice(0, length));
      focusBox(length - 1);
      return;
    }
    // A box already holding a digit may receive "old+new"; keep the newest char.
    const chars = digits.length > 1 && code[i] ? digits.slice(-1) : digits;
    writeAt(i, chars);
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    const code = latest.current;
    switch (e.key) {
      case "Backspace": {
        e.preventDefault();
        if (code[i]) {
          commit(code.slice(0, i) + code.slice(i + 1));
          focusBox(i);
        } else if (i > 0) {
          commit(code.slice(0, i - 1) + code.slice(i));
          focusBox(i - 1);
        }
        break;
      }
      case "Delete":
        e.preventDefault();
        if (code[i]) commit(code.slice(0, i) + code.slice(i + 1));
        break;
      case "ArrowLeft":
        e.preventDefault();
        focusBox(i - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        focusBox(Math.min(i + 1, code.length));
        break;
      case "Home":
        e.preventDefault();
        focusBox(0);
        break;
      case "End":
        e.preventDefault();
        focusBox(Math.min(code.length, length - 1));
        break;
    }
  }

  function handlePaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    const digits = onlyDigits(e.clipboardData.getData("text"));
    e.preventDefault();
    if (!digits) return;
    if (digits.length >= length) {
      commit(digits.slice(0, length));
      focusBox(length - 1);
    } else {
      writeAt(i, digits);
    }
  }

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      className={cn("flex w-full justify-center gap-2 sm:gap-2.5", invalid && "motion-safe:animate-shake", className)}
    >
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={code[i] ?? ""}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => {
            // Keep entry contiguous: clicking an empty box beyond the cursor jumps to the next free box.
            const filled = latest.current.length;
            if (i > filled) focusBox(filled);
            else e.target.select();
          }}
          className={cn(
            "h-13 w-full min-w-0 max-w-[52px] flex-1 rounded-md border border-border bg-surface text-center font-heading text-[22px] font-semibold text-ink tabular-nums caret-green-700",
            "transition-[border-color,box-shadow] duration-150 hover:border-border-strong sm:h-14 sm:text-2xl",
            "focus-visible:border-green-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700",
            "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60",
            invalid && "border-error focus-visible:border-error focus-visible:outline-error",
          )}
        />
      ))}
    </div>
  );
}
