"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Camera, CircleAlert, CircleCheck, FileText, Lock, RotateCcw, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "./Button";

/** "selected" = staged in a form, sent on submit ("Ready to upload"). */
export type FileUploadStatus = "selected" | "uploading" | "uploaded" | "error";

/** What the parent knows about the current file. `url` is a same-origin `/api/files/<id>` (never next/image). */
export interface FileUploadValue {
  name: string;
  status: FileUploadStatus;
  url?: string | null;
  /** 0–100 while uploading (omit for an indeterminate bar). */
  progress?: number;
  /** Server-side failure message (status "error"). */
  error?: string;
  sizeBytes?: number;
}

export interface FileUploadProps {
  /** Visible label above the dropzone. */
  label: string;
  description?: string;
  id?: string;
  kind?: "image" | "document";
  /** MIME list for the picker. Defaults: image → JPEG/PNG/WEBP; document → JPEG/PNG/WEBP/PDF. */
  accept?: string;
  maxSizeMb?: number;
  /** Adds a "Take photo" button that opens the camera on phones ("user" = selfie, "environment" = rear). */
  capture?: "user" | "environment";
  value: FileUploadValue | null;
  /** Called with a file that passed the type and size checks. The parent uploads it and updates `value`. */
  onSelect(file: File): void;
  onRemove?(): void;
  /** Re-try the last failed upload (shows "Try again"). */
  onRetry?(): void;
  /** Form-level error (e.g. "Upload your licence"). */
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** "Stored privately — visible only to you and TAKI verification". Default true for documents. */
  privateNote?: boolean | string;
  className?: string;
}

const DEFAULT_ACCEPT = {
  image: "image/jpeg,image/png,image/webp",
  document: "image/jpeg,image/png,image/webp,application/pdf",
} as const;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function typeLabel(accept: string): string {
  const parts = accept.split(",").map((t) => t.trim().replace(/^image\//, "").replace(/^application\//, "").toUpperCase());
  return parts.map((p) => (p === "JPEG" ? "JPG" : p)).join(", ");
}

/** Client pre-check only; the server re-checks magic bytes and size. Returns an error message or null. */
export function checkFile(file: File, accept: string, maxSizeMb: number): string | null {
  const allowed = accept.split(",").map((t) => t.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(file.type)) return `This file type isn't supported. Use ${typeLabel(accept)}.`;
  if (file.size > maxSizeMb * 1024 * 1024) return `This file is too large. The limit is ${maxSizeMb} MB.`;
  if (file.size === 0) return "This file is empty.";
  return null;
}

/**
 * Dropzone + "Choose file" / "Take photo". Shows a thumbnail (images), progress, uploaded state and errors.
 * Private files render with a plain <img> pointing at the access-checked file route (never next/image).
 */
export function FileUpload({
  label,
  description,
  id: idProp,
  kind = "document",
  accept: acceptProp,
  maxSizeMb = 5,
  capture,
  value,
  onSelect,
  onRemove,
  onRetry,
  error,
  required,
  disabled,
  privateNote,
  className,
}: FileUploadProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const accept = acceptProp ?? DEFAULT_ACCEPT[kind];
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Revoke the object URL when replaced/unmounted.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  function pick(file: File | undefined | null) {
    if (!file || disabled) return;
    const problem = checkFile(file, accept, maxSizeMb);
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError(null);
    setLocalPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    onSelect(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files?.[0]);
  }

  const shownError = localError ?? (value?.status === "error" ? (value.error ?? "Upload failed. Try again.") : null) ?? error ?? null;
  const descId = `${id}-desc`;
  const errorId = shownError ? `${id}-error` : undefined;
  const statusId = `${id}-status`;
  const note = privateNote ?? kind === "document";
  const noteText = typeof note === "string" ? note : "Stored privately — visible only to you and TAKI verification.";
  const preview = value?.url ?? localPreview;
  const isImage = kind === "image" || (!!value?.name && /\.(jpe?g|png|webp)$/i.test(value.name));
  const uploading = value?.status === "uploading";

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <p id={`${id}-label`} className="text-sm font-medium text-ink">
        {label}
        {required ? <span className="sr-only"> (required)</span> : null}
      </p>

      {value ? (
        <div
          className={cn(
            "flex items-center gap-3 rounded-md border bg-surface p-3",
            value.status === "error" ? "border-error/50" : "border-border",
          )}
        >
          <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-muted text-green-700">
            {preview && isImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- private file: no optimiser cache
              <img src={preview} alt="" className="size-full object-cover" />
            ) : (
              <FileText aria-hidden="true" strokeWidth={1.75} className="size-6" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{value.name}</p>
            <p id={statusId} role="status" aria-live="polite" className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-muted">
              {value.status === "uploading" ? (
                <>Uploading{typeof value.progress === "number" ? ` ${Math.round(value.progress)}%` : "…"}</>
              ) : value.status === "selected" ? (
                <>Ready to upload{value.sizeBytes ? ` · ${formatSize(value.sizeBytes)}` : ""}</>
              ) : value.status === "uploaded" ? (
                <>
                  <CircleCheck aria-hidden="true" strokeWidth={2} className="size-4 text-green-600" />
                  Uploaded{value.sizeBytes ? ` · ${formatSize(value.sizeBytes)}` : ""}
                </>
              ) : (
                <span className="text-error">Not uploaded</span>
              )}
            </p>
            {uploading ? (
              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
                role="progressbar"
                aria-label={`Uploading ${value.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={typeof value.progress === "number" ? Math.round(value.progress) : undefined}
              >
                <div
                  className={cn("h-full rounded-full bg-green-700 transition-[width]", typeof value.progress !== "number" && "w-1/3 motion-safe:animate-pulse")}
                  style={typeof value.progress === "number" ? { width: `${value.progress}%` } : undefined}
                />
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {value.status === "error" && onRetry ? (
              <Button variant="ghost" size="sm" onClick={onRetry} leadingIcon={<RotateCcw className="size-4" />}>
                Try again
              </Button>
            ) : null}
            {!uploading ? (
              <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
                Replace
              </Button>
            ) : null}
            {onRemove && !uploading ? (
              <button
                type="button"
                onClick={() => {
                  setLocalError(null);
                  setLocalPreview(null);
                  onRemove();
                }}
                disabled={disabled}
                aria-label={`Remove ${value.name}`}
                className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-ink/6 hover:text-ink"
              >
                <X aria-hidden="true" strokeWidth={2} className="size-5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-3 rounded-md border-[1.5px] border-dashed px-4 py-6 text-center transition-colors",
            dragging ? "border-green-500 bg-green-50" : shownError ? "border-error/60 bg-surface" : "border-border-strong bg-surface",
            disabled && "opacity-60",
          )}
        >
          <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full bg-mint-100 text-green-700">
            <Upload strokeWidth={1.75} className="size-5" />
          </span>
          <p id={descId} className="text-sm text-ink-muted">
            {description ?? (kind === "image" ? "Drag a photo here or choose one" : "Drag a file here or choose one")}
            <span className="block text-caption text-ink-subtle">
              {typeLabel(accept)} · up to {maxSizeMb} MB
            </span>
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
              aria-describedby={[descId, errorId].filter(Boolean).join(" ")}
              leadingIcon={<Upload className="size-4" />}
            >
              Choose file<span className="sr-only"> for {label}</span>
            </Button>
            {capture ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => cameraRef.current?.click()}
                disabled={disabled}
                leadingIcon={<Camera className="size-4" />}
              >
                Take photo<span className="sr-only"> for {label}</span>
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {capture ? (
        <input
          ref={cameraRef}
          type="file"
          accept={DEFAULT_ACCEPT.image}
          capture={capture}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      ) : null}

      {shownError ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-[13px] font-medium leading-5 text-error">
          <CircleAlert aria-hidden="true" strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
          <span>{shownError}</span>
        </p>
      ) : null}
      {note ? (
        <p className="flex items-center gap-1.5 text-caption text-ink-muted">
          <Lock aria-hidden="true" strokeWidth={2} className="size-3.5 shrink-0" />
          {noteText}
        </p>
      ) : null}
    </div>
  );
}
