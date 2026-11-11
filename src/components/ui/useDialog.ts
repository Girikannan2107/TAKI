"use client";

import { useEffect, useRef, type MouseEvent, type SyntheticEvent } from "react";
import { routeClickToToast } from "./Toast";

/**
 * Drives a native <dialog> from a controlled `open` prop (showModal/close), restores focus to the
 * previously focused element on close, routes Esc and backdrop clicks to `onClose`, and locks page scroll.
 * Shared by Modal and Drawer.
 */
export function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      document.documentElement.style.overflow = "hidden";
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Restore focus + scroll whenever the dialog closes (or unmounts while open).
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => {
      document.documentElement.style.overflow = "";
      const target = returnFocus.current;
      returnFocus.current = null;
      if (target && target.isConnected) target.focus();
    };
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("close", handleClose);
      if (dialog.open) {
        dialog.close();
        document.documentElement.style.overflow = "";
      }
    };
  }, []);

  const dialogProps = {
    ref,
    onCancel: (e: SyntheticEvent<HTMLDialogElement>) => {
      // Esc: keep the dialog controlled by the parent.
      e.preventDefault();
      onClose();
    },
    onClick: (e: MouseEvent<HTMLDialogElement>) => {
      // Clicks on the ::backdrop target the <dialog> element itself. Toasts float above the modal but are
      // inert, so their clicks land here too: route those to the toast instead of closing (V-12).
      if (e.target !== e.currentTarget) return;
      if (routeClickToToast(e.clientX, e.clientY)) return;
      onClose();
    },
  };

  return dialogProps;
}
