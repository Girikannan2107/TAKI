/** Vehicle models catalogue (data-contract.md §11.3). */
import type { VehicleImageKey, VehicleModel, VehicleModelId } from "./types";

export const VEHICLE_MODELS: readonly VehicleModel[] = [
  { id: "tata_ace", label: "Tata Ace", vehicleClass: "Mini Truck", maxPayloadKg: 750, imageKey: "mini_delivery_truck_taki" },
  { id: "mahindra_bolero_pickup", label: "Mahindra Bolero Pik-Up", vehicleClass: "Pickup", maxPayloadKg: 1500, imageKey: "medium_box_truck_generic" },
  { id: "tata_407", label: "Tata 407", vehicleClass: "Light Truck", maxPayloadKg: 3000, imageKey: "light_cargo_lorry_taki" },
  { id: "eicher_pro", label: "Eicher Pro", vehicleClass: "Medium Truck", maxPayloadKg: 5000, imageKey: "multi_axle_container_taki" },
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
