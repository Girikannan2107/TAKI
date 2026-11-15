import { ROLE_SECTION, type AppRole } from "@/lib/config/routes";

/**
 * Validate a `?next=` return URL. Only same-origin relative paths inside the
 * signed-in role's own section are allowed (prevents open redirects).
 * Returns null when the value must be ignored.
 */
export function safeRedirect(next: string | null | undefined, role: AppRole): string | null {
  if (!next || typeof next !== "string") return null;
  const raw = next.trim();
  // Validate the fully decoded form (values may arrive URL-encoded more than once) …
  let decoded = raw;
  try {
    for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(decoded); i++) decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  if (!isSafePath(decoded, role)) return null;
  // … but keep the query string's own encoding (e.g. `from=A%26B`), so a deep link such as
  // /customer/shipments/new?from=…&trip=… survives the login intact. Only a fully encoded path
  // ("%2Fcustomer%2F…") is returned decoded.
  return raw.startsWith("/") && isSafePath(raw, role) ? raw : decoded;
}

function isSafePath(value: string, role: AppRole): boolean {
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//") || value.includes("\\")) return false;
  // Reject control characters and any scheme-looking content.
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  const prefix = ROLE_SECTION[role];
  return value === prefix || value.startsWith(prefix + "/") || value.startsWith(prefix + "?");
}
