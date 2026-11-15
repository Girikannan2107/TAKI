import type { DistrictDTO } from "@/lib/api/contracts/auth";
import { STATE_NAMES } from "@/lib/domain/model";
import { DISTRICTS } from "@/lib/domain/places/districts";
import { handler, json } from "@/server/http/handler";

const ITEMS: DistrictDTO[] = DISTRICTS.map((d) => ({ id: d.id, name: d.name, state: d.state, stateName: STATE_NAMES[d.state] })).sort(
  (a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name),
);

/** GET /api/geo/districts — the district list shared by trip checkpoints and shipment addresses (5 states). */
export const GET = handler({ auth: "public" }, () => json({ items: ITEMS }, 200, { "cache-control": "public, max-age=3600" }));
