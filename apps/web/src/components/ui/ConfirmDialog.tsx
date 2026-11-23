"use client";

import { Button } from "./Button";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  /** Parent-controlled busy state: disables both buttons and shows a spinner on confirm. */
  loading?: boolean;
  onConfirm(): void | Promise<void>;
  onCancel(): void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const close = () => {
    if (!loading) onCancel();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="sm"
      hideClose={loading}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={loading} fullWidth className="sm:w-auto">
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={() => void onConfirm()}
            loading={loading}
            fullWidth
            className="sm:w-auto"
            autoFocus={tone !== "danger"}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description ? <p className="text-[15px] text-ink-muted">{description}</p> : null}
    </Modal>
  );
}
