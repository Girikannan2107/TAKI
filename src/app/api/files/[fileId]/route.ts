import { z } from "zod";
import { IdSchema } from "@/lib/api/contracts/common";
import { serveFile } from "@/server/files/access";
import { handler } from "@/server/http/handler";

/** GET /api/files/[fileId] — access-checked private file stream (404 when missing or not readable). */
export const GET = handler({ auth: "any", params: z.object({ fileId: IdSchema("fil") }) }, ({ params, session }) => serveFile(session, params.fileId));
