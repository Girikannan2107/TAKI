import { z } from "zod";
import { DocumentKindSchema } from "@/lib/api/contracts/auth";
import { handler } from "@/server/http/handler";
import { uploadDocument } from "@/server/modules/profile/service";

/**
 * PUT /api/me/documents/[kind] (multipart: number, file, backFile?, validUntil?) — agency identity document
 * (aadhaar | pan | driving_license) or driver driving_license / aadhaar. → { document, verification }.
 */
export const PUT = handler({ auth: ["agency", "driver"], form: true, params: z.object({ kind: DocumentKindSchema }) }, ({ form, params, session, now }) =>
  uploadDocument(session, params.kind, form!, now),
);
