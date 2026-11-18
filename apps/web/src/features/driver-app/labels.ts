import type { BadgeTone } from "@/components/ui";
import { DRIVER_STATUS_LABEL, TRIP_STATUS_LABEL, type DriverShipmentTab } from "@/lib/api/contracts/driver";
import type { DriverShipmentsTab } from "@/lib/config/routes";
import type { BookingStatus, GoodsCategory, PackageType, SpecialHandling, TripStatus } from "@/lib/domain/model";

export { DRIVER_STATUS_LABEL, TRIP_STATUS_LABEL };

export const STATUS_TONE: Record<BookingStatus, BadgeTone> = {
  awaiting_agency: "neutral",
  pending_payment: "neutral",
  payment_failed: "neutral",
  confirmed: "attention",
  picked_up: "info",
  in_transit: "info",
  out_for_delivery: "warning",
  delivered: "success",
  rejected: "danger",
  cancelled: "danger",
};

export const TRIP_TONE: Record<TripStatus, BadgeTone> = {
  draft: "neutral",
  published: "info",
  in_progress: "attention",
  completed: "success",
  cancelled: "danger",
};

export const GOODS_LABEL: Record<GoodsCategory, string> = {
  general_goods: "General goods",
  agriculture: "Agriculture",
  construction: "Construction",
  industrial: "Industrial",
  electronics: "Electronics",
  furniture: "Furniture",
  textiles: "Textiles",
  perishables: "Perishables",
  other: "Other",
};

export const PACKAGE_LABEL: Record<PackageType, string> = {
  box: "Box",
  bag: "Bag",
  sack: "Sack",
  crate: "Crate",
  pallet: "Pallet",
  loose: "Loose",
  other: "Other",
};

export const HANDLING_LABEL: Record<SpecialHandling, string> = {
  fragile: "Fragile",
  keep_dry: "Keep dry",
  this_side_up: "This side up",
  temperature_sensitive: "Temperature sensitive",
};

/** URL tab (paths.driver.shipments) ↔ API tab. */
export const URL_TO_API_TAB: Record<DriverShipmentsTab, DriverShipmentTab> = {
  pickup: "pending_pickup",
  transit: "in_transit",
  delivered: "delivered",
};

export function isUrlTab(v: unknown): v is DriverShipmentsTab {
  return v === "pickup" || v === "transit" || v === "delivered";
}

/** "+12 min" / "−5 min" / "on time" delta between expected and actual instants (null when unknown). */
export function delayLabel(expected: string | null, actual: string | null): { text: string; late: boolean } | null {
  if (!expected || !actual) return null;
  const mins = Math.round((Date.parse(actual) - Date.parse(expected)) / 60_000);
  if (Math.abs(mins) < 5) return { text: "On time", late: false };
  const abs = Math.abs(mins);
  const span = abs >= 60 ? `${Math.floor(abs / 60)} h ${abs % 60 ? `${abs % 60} min` : ""}`.trim() : `${abs} min`;
  return mins > 0 ? { text: `+${span} late`, late: true } : { text: `${span} early`, late: false };
}
