import { ContactBody } from "@/lib/api/contracts/common";
import { saveContactMessage } from "@/server/core/contact";
import { created, handler } from "@/server/http/handler";
import { RATE_LIMITS } from "@/server/http/rate-limit";

/**
 * POST /api/public/contact { name, phone?, email?, role, message } — landing-page contact form.
 * Stored in `contactMessages`; 5 per hour per IP (429 rate_limited); 201 `{ id, receivedAt }`.
 */
export const POST = handler(
  {
    auth: "public",
    body: ContactBody,
    maxBodyBytes: 16 * 1024,
    rateLimit: { rule: RATE_LIMITS.contact, bucket: ({ ip }) => `contact:ip:${ip}` },
  },
  async ({ body, ip, now }) => created(await saveContactMessage(body, ip, now)),
);
