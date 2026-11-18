/**
 * Phase 1 domain types still used by the v2 UI (city/route-draft helpers, pricing v1 preview,
 * vehicle catalogue). v2 documents live in `./model` and `src/server/db/schema.ts`.
 * Framework-free: no React/Next/browser imports.
 */
export type Id = string; export type BookingId = string; // BookingId: /^TAKI\d{6}$/
export type CityId = string;             // slug, e.g. "coimbatore"
export type IsoDate = string;            // "YYYY-MM-DD" (IST calendar date)
export type IsoDateTime = string;        // UTC instant, "2026-11-10T06:00:00.000Z"
export type TimeOfDay = string;          // "HH:mm" 24h IST, minutes 00 or 30
export type Rupees = number; export type Paise = number;  // both integer >= 0
export type Mobile = string;             // E.164 "+919876543210"
export interface City { id: CityId; name: string; state: string; lat: number; lng: number }
export type VehicleModelId = 'tata_ace' | 'mahindra_bolero_pickup' | 'tata_407' | 'eicher_pro' | 'ashok_leyland_ecomet';
export type VehicleClass = 'Mini Truck' | 'Pickup' | 'Light Truck' | 'Medium Truck' | 'Heavy Truck';
export type VehicleImageKey =
  | 'green_tarpaulin_truck_taki' | 'light_cargo_lorry_taki' | 'medium_cargo_truck_taki' | 'large_curtainside_lorry_taki'
  | 'heavy_freight_lorry_taki' | 'mini_delivery_truck_taki' | 'multi_axle_container_taki' | 'medium_box_truck_generic';
export interface VehicleModel { id: VehicleModelId; label: string; vehicleClass: VehicleClass; maxPayloadKg: number; imageKey: VehicleImageKey }
// Add Trip form draft (agency pricing step).
export interface RouteDraft {
  originCityId?: CityId; destinationCityId?: CityId; stopCityIds: CityId[];
  travelDate?: IsoDate; departureTime?: TimeOfDay; vehicleId?: Id;
  totalCapacityKg?: number; offeredCapacityKg?: number; ratePerKmPaise?: Paise; ratePerKgPaise?: Paise;
}
export interface PricingBreakdown {
  pricingVersion: 1;
  distanceKm: number; weightKg: number;                          // segment distance actually charged
  ratePerKmPaise: Paise; ratePerKgPaise: Paise;
  distanceCharge: Rupees;                                        // roundHalfUp(distanceKm * ratePerKmPaise / 100)
  weightCharge: Rupees;                                          // roundHalfUp(weightKg * ratePerKgPaise / 100)
  transportationCharge: Rupees;                                  // distanceCharge + weightCharge
  serviceFee: Rupees;                                            // serviceFeeFor(weightKg)
  totalPayable: Rupees;                                          // transportationCharge + serviceFee
}
