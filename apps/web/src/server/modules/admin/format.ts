import "server-only";

/** "+91 98765 43210" — admins see full numbers (they may need to call during verification). */
export function formatPhoneForAdmin(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : e164;
}
