"use client";

import { useState } from "react";
import { Avatar, Card, FileUpload, useToast, type FileUploadValue } from "@/components/ui";
import { accountApi } from "@/lib/api/client/auth";
import { errorMessage } from "@/lib/api/http";
import { refreshSession } from "@/features/auth/session";

export interface AccountPhotoCardProps {
  /** Shown next to the avatar and used for initials. */
  name: string;
  photoUrl: string | null;
  /** Called with the new `/api/files/<id>` URL after a successful upload. */
  onChanged?(photoUrl: string): void;
  /** Agency logo / driver photo wording. Default "Profile photo". */
  label?: string;
  description?: string;
  /** Mark as required (driver and agency verification need a photo). */
  required?: boolean;
  className?: string;
}

/**
 * Profile photo (P3 §4.1 account cards): PUT /api/me/photo, JPEG/PNG/WEBP up to 5 MB (server re-checks magic bytes).
 * Updates the shell avatar via refreshSession().
 */
export function AccountPhotoCard({ name, photoUrl, onChanged, label = "Profile photo", description, required, className }: AccountPhotoCardProps) {
  const { toast } = useToast();
  const [value, setValue] = useState<FileUploadValue | null>(photoUrl ? { name: "photo.jpg", status: "uploaded", url: photoUrl } : null);
  const [lastFile, setLastFile] = useState<File | null>(null);

  async function upload(file: File) {
    setLastFile(file);
    setValue({ name: file.name, status: "uploading", sizeBytes: file.size });
    try {
      const res = await accountApi.uploadPhoto(file);
      setValue({ name: file.name, status: "uploaded", url: res.photoUrl, sizeBytes: file.size });
      onChanged?.(res.photoUrl);
      void refreshSession();
      toast({ tone: "success", title: "Photo updated" });
    } catch (e) {
      setValue({ name: file.name, status: "error", error: errorMessage(e, "We couldn't upload the photo. Try again."), sizeBytes: file.size });
    }
  }

  const current = value?.status === "uploaded" ? (value.url ?? photoUrl) : photoUrl;

  return (
    <Card as="section" aria-labelledby="account-photo-title" className={className}>
      <div className="mb-4 flex items-center gap-4">
        <Avatar name={name} src={current ?? undefined} size="lg" decorative />
        <div className="min-w-0">
          <h2 id="account-photo-title" className="type-h3 text-ink">
            {label}
          </h2>
          <p className="text-sm text-ink-muted">{description ?? "A clear photo helps customers and agencies recognise you."}</p>
        </div>
      </div>
      <FileUpload
        label={current ? "Replace photo" : "Upload photo"}
        kind="image"
        capture="user"
        maxSizeMb={5}
        value={value}
        required={required}
        privateNote={false}
        onSelect={(f) => void upload(f)}
        onRetry={lastFile ? () => void upload(lastFile) : undefined}
      />
    </Card>
  );
}
