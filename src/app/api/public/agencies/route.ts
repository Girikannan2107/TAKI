import { z } from "zod";
import { DistrictIdSchema } from "@/lib/api/contracts/common";
import { listPublicAgencies } from "@/server/core/contact";
import { handler } from "@/server/http/handler";

/** GET /api/public/agencies?q=&districtId= — verified agencies (id, name, district) for the driver signup picker. */
const Query = z.object({
  q: z.string().trim().max(60).optional(),
  districtId: z.union([DistrictIdSchema, z.literal("")]).optional(),
});

export const GET = handler({ auth: "public", query: Query }, async ({ query }) => ({
  items: await listPublicAgencies({ q: query.q, districtId: query.districtId || undefined }),
}));
