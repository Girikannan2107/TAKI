import { GuestSearchQuery } from "@/lib/api/contracts/customer";
import { handler } from "@/server/http/handler";
import { guestSearch } from "@/server/modules/customer/search";

/**
 * GET /api/customer/search?from&to&weightKg&date&goods&handling&sort&vehicleClass&minPrice&maxPrice&minCapacityKg
 * Public: guests may search and compare; requesting a booking needs a customer login.
 */
export const GET = handler({ auth: "public", query: GuestSearchQuery }, ({ query, now, session }) => guestSearch(query, now, session));
