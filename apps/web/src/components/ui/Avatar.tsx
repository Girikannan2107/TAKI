import Image from "next/image";
import { cn } from "@/lib/utils/cn";

export interface AvatarProps {
  name: string;
  /** Local image path (public/…) or a private `/api/files/<id>` URL. Falls back to initials when absent. */
  src?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Decorative avatars (next to a visible name) should pass true. */
  decorative?: boolean;
}

const sizes = { sm: { cls: "size-8 text-xs", px: 32 }, md: { cls: "size-10 text-sm", px: 40 }, lg: { cls: "size-16 text-xl", px: 64 } };

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({ name, src, size = "md", className, decorative = false }: AvatarProps) {
  const s = sizes[size];
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-mint-100 font-heading font-semibold text-green-800 ring-2 ring-surface",
        s.cls,
        className,
      )}
    >
      {src && src.startsWith("/api/") ? (
        // Private, access-checked file (/api/files/…): plain <img> so the image optimiser never caches it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={s.px} height={s.px} className="size-full object-cover" />
      ) : src ? (
        <Image src={src} alt="" width={s.px} height={s.px} className="size-full object-cover" />
      ) : (
        <span aria-hidden="true">{initialsOf(name)}</span>
      )}
    </span>
  );
}
