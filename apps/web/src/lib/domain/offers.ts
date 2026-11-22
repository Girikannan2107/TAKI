/**
 * Display vocabulary for trip offers (search results, vehicle details). Matching itself runs only in
 * the FastAPI backend; these are the enum values its responses use and the copy the UI shows for them.
 */
export type OfferProblem =
  | "trip_not_bookable"
  | "not_on_route"
  | "wrong_date"
  | "departed"
  | "goods_not_accepted"
  | "handling_not_supported"
  | "package_too_heavy"
  | "insufficient_capacity"
  | "maps_unavailable";

export const OFFER_PROBLEM_MESSAGE: Record<OfferProblem, string> = {
  trip_not_bookable: "This trip is no longer accepting bookings.",
  not_on_route: "This trip doesn't pass through your pickup and drop places in that order.",
  wrong_date: "This trip doesn't leave your pickup point on your shipping date.",
  departed: "This trip has already left (or is about to leave) your pickup point.",
  goods_not_accepted: "This vehicle doesn't accept your goods category.",
  handling_not_supported: "This vehicle can't provide the special handling your goods need.",
  package_too_heavy: "Your package is heavier than this trip allows per package.",
  insufficient_capacity: "There isn't enough space left on this trip for your shipment.",
  maps_unavailable: "Road distances are temporarily unavailable; prices use straight-line distance.",
};

export type OfferSort = "price_asc" | "price_desc" | "departure_asc" | "arrival_asc";
export const OFFER_SORTS: readonly OfferSort[] = ["price_asc", "price_desc", "departure_asc", "arrival_asc"];

export type OfferBadge = "best_price" | "top_rated" | "more_capacity";
