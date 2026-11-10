import type { Role } from "@/lib/domain/types";

/**
 * Validate a `?next=` return URL. Only same-origin relative paths inside the
 * signed-in role's own section are allowed (prevents open redirects).
 * Returns null when the value must be ignored.
 */
export function safeRedirect(next: string | null | undefined, role: Role): string | null {
  if (!next || typeof next !== "string") return null;
  let value = next.trim();
  try {
    // Values may arrive URL-encoded more than once.
    for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(value); i++) value = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.includes("\\")) return null;
  // Reject control characters and any scheme-looking content.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  const prefix = role === "customer" ? "/customer" : "/driver";
  if (value !== prefix && !value.startsWith(prefix + "/") && !value.startsWith(prefix + "?")) return null;
  return value;
}
