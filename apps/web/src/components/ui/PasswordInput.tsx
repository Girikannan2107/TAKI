"use client";

import { useState } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { Input, type InputProps } from "./Input";
import { IconButton } from "./IconButton";

export type PasswordInputProps = Omit<InputProps, "type" | "trailingSlot">;

/** Input with a LockKeyhole icon and a Show/Hide password toggle. */
export function PasswordInput({ leadingIcon, autoComplete = "current-password", ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...rest}
      type={visible ? "text" : "password"}
      autoComplete={autoComplete}
      leadingIcon={leadingIcon ?? <LockKeyhole strokeWidth={1.75} />}
      trailingSlot={
        <IconButton
          size="sm"
          label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          icon={visible ? <EyeOff strokeWidth={1.75} /> : <Eye strokeWidth={1.75} />}
          onClick={() => setVisible((v) => !v)}
          className="text-ink-muted hover:text-ink"
        />
      }
    />
  );
}
