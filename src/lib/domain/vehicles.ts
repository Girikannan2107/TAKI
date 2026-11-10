/** Vehicle models catalogue (data-contract.md §11.3). */
import type { Db } from "./db";
import type { Id, VehicleImageKey, VehicleModel, VehicleModelId } from "./types";

export const VEHICLE_MODELS: readonly VehicleModel[] = [
  { id: "tata_ace", label: "Tata Ace", vehicleClass: "Mini Truck", maxPayloadKg: 750, imageKey: "mini_delivery_truck_taki" },
  { id: "mahindra_bolero_pickup", label: "Mahindra Bolero Pik-Up", vehicleClass: "Pickup", maxPayloadKg: 1500, imageKey: "medium_box_truck_generic" },
  { id: "tata_407", label: "Tata 407", vehicleClass: "Light Truck", maxPayloadKg: 3000, imageKey: "green_tarpaulin_truck_taki" },
  { id: "eicher_pro", label: "Eicher Pro", vehicleClass: "Medium Truck", maxPayloadKg: 5000, imageKey: "medium_cargo_truck_taki" },
  { id: "ashok_leyland_ecomet", label: "Ashok Leyland", vehicleClass: "Heavy Truck", maxPayloadKg: 7000, imageKey: "large_curtainside_lorry_taki" },
];

export function getVehicleModel(id: VehicleModelId | string | undefined): VehicleModel | undefined {
  return VEHICLE_MODELS.find((m) => m.id === id);
}

/** Public path of a vehicle photo. Photos are synthetic marketing images, not a verified fleet. */
export function vehicleImageSrc(key: VehicleImageKey): string {
  return `/assets/taki/vehicles/${key}.webp`;
}

/** "Tata 407 (Light Truck)" — reference Add Route select label. */
export function vehicleModelLabel(id: VehicleModelId | string): string {
  const m = getVehicleModel(id);
  return m ? `${m.label} (${m.vehicleClass})` : String(id);
}

/**
 * Options for the Add Route "Vehicle Type" select. Values are either an existing
 * vehicle id ("veh_…") or "new:<modelId>" (a vehicle created on publish for drivers
 * who have not registered that model yet).
 */
export function vehicleOptionsFor(db: Db, driverId: Id): Array<{ value: string; label: string; maxPayloadKg: number }> {
  const own = Object.values(db.vehicles)
    .filter((v) => v.driverId === driverId)
    .map((v) => {
      const m = getVehicleModel(v.modelId);
      return { value: v.id, label: `${vehicleModelLabel(v.modelId)} · ${v.registrationNumber}`, maxPayloadKg: m?.maxPayloadKg ?? v.capacity.maxPayloadKg };
    });
  const ownModels = new Set(Object.values(db.vehicles).filter((v) => v.driverId === driverId).map((v) => v.modelId));
  const others = VEHICLE_MODELS.filter((m) => !ownModels.has(m.id)).map((m) => ({
    value: `new:${m.id}`,
    label: vehicleModelLabel(m.id),
    maxPayloadKg: m.maxPayloadKg,
  }));
  return [...own, ...others];
}

/** Max payload for a "Vehicle Type" select value. */
export function maxPayloadForOption(db: Db, value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (value.startsWith("new:")) return getVehicleModel(value.slice(4))?.maxPayloadKg;
  const v = db.vehicles[value];
  return v ? (getVehicleModel(v.modelId)?.maxPayloadKg ?? v.capacity.maxPayloadKg) : undefined;
}
