import "server-only";
/**
 * Agency fleet CRUD (P2 §8.5 vehicles). Registration numbers are unique platform-wide through
 * `registrationIndex/{reg without spaces}`, claimed in the same transaction as the vehicle.
 * Removal is soft (`status: "removed"`) and blocked while the vehicle has published/in-progress trips.
 */
import { regKey, type VehicleDTO, type VehicleInput, type VehiclePatchInput, VehicleBody, VehiclePatchBody } from "@/lib/api/contracts/agency";
import { DomainError } from "@/lib/api/contracts/errors";
import { newId } from "@/lib/domain/ids";
import type { VehicleClass } from "@/lib/domain/model";
import type { VehicleImageKey } from "@/lib/domain/types";
import { getVehicleModel } from "@/lib/domain/vehicles";
import type { SessionContext } from "@/server/auth/guards";
import { C, getDocStore } from "@/server/db";
import type { AgencyDoc, RegistrationIndexDoc, TripDoc, VehicleDoc } from "@/server/db/schema";
import { formFile, markReplaced, saveUpload } from "@/server/files/uploads";
import { toVehicleDTO } from "@/server/views/agency";
import { agencyIdOf, fieldError, LIVE_TRIP_STATUSES, ownedVehicle } from "./shared";

export const MAX_VEHICLE_PHOTOS = 5;

const CLASS_IMAGE: Record<VehicleClass, VehicleImageKey> = {
  "Mini Truck": "mini_delivery_truck_taki",
  Pickup: "medium_box_truck_generic",
  "Light Truck": "light_cargo_lorry_taki",
  "Medium Truck": "medium_cargo_truck_taki",
  "Heavy Truck": "large_curtainside_lorry_taki",
};

function imageKeyFor(vehicleClass: VehicleClass, modelId: string | null): VehicleImageKey {
  return getVehicleModel(modelId ?? undefined)?.imageKey ?? CLASS_IMAGE[vehicleClass];
}

async function activeTripCount(vehicleId: string): Promise<number> {
  return getDocStore().count(C.trips, { where: [["vehicleId", "==", vehicleId], ["status", "in", [...LIVE_TRIP_STATUSES]]] });
}

export async function listVehicles(session: SessionContext, status: "active" | "inactive" | "all"): Promise<{ items: VehicleDTO[] }> {
  const agencyId = agencyIdOf(session);
  const statuses = status === "all" ? ["active", "inactive"] : [status];
  const rows = await getDocStore().query<VehicleDoc>(C.vehicles, {
    where: [["agencyId", "==", agencyId], ["status", "in", statuses]],
    orderBy: [["createdAt", "desc"], ["__name__", "desc"]],
    limit: 200,
  });
  const counts = await Promise.all(rows.map((v) => activeTripCount(v.id)));
  return { items: rows.map((v, i) => toVehicleDTO(v, counts[i])) };
}

export async function getVehicle(session: SessionContext, vehicleId: string): Promise<VehicleDTO> {
  const v = await ownedVehicle(agencyIdOf(session), vehicleId);
  return toVehicleDTO(v, await activeTripCount(v.id));
}

export async function createVehicle(session: SessionContext, raw: VehicleInput, now: Date): Promise<VehicleDTO> {
  const agencyId = agencyIdOf(session);
  const body = VehicleBody.parse(raw);
  const at = now.toISOString();
  const id = newId("veh");
  const key = regKey(body.registrationNumber);
  const vehicle: VehicleDoc = {
    id,
    agencyId,
    vehicleClass: body.vehicleClass,
    modelId: body.modelId,
    makeModel: body.makeModel,
    registrationNumber: body.registrationNumber,
    maxPayloadKg: body.maxPayloadKg,
    bodyType: body.bodyType,
    dimensionsFt: body.dimensionsFt,
    acceptedGoods: body.acceptedGoods,
    handlingSupported: body.handlingSupported,
    photos: [],
    imageKey: imageKeyFor(body.vehicleClass, body.modelId),
    status: "active",
    createdAt: at,
    updatedAt: at,
  };
  await getDocStore().runTransaction(async (tx) => {
    const [taken, agency] = await Promise.all([tx.get<RegistrationIndexDoc>(C.registrationIndex, key), tx.get<AgencyDoc>(C.agencies, agencyId)]);
    if (!agency) throw new DomainError("not_found");
    if (taken) throw fieldError("registration_taken", "registrationNumber", "A vehicle with this registration number already exists.");
    tx.create<RegistrationIndexDoc>(C.registrationIndex, key, { id: key, vehicleId: id, agencyId, createdAt: at });
    tx.create(C.vehicles, id, vehicle);
    tx.update(C.agencies, agencyId, { "stats.vehicles": (agency.stats?.vehicles ?? 0) + 1, updatedAt: at });
  });
  return toVehicleDTO(vehicle, 0);
}

export async function updateVehicle(session: SessionContext, vehicleId: string, raw: VehiclePatchInput, now: Date): Promise<VehicleDTO> {
  const agencyId = agencyIdOf(session);
  const patch = VehiclePatchBody.parse(raw);
  const at = now.toISOString();
  const active = await activeTripCount(vehicleId);
  const next = await getDocStore().runTransaction(async (tx) => {
    const v = await tx.get<VehicleDoc>(C.vehicles, vehicleId);
    if (!v || v.agencyId !== agencyId || v.status === "removed") throw new DomainError("not_found");
    const regChanged = patch.registrationNumber !== undefined && patch.registrationNumber !== v.registrationNumber;
    const newKey = regChanged ? regKey(patch.registrationNumber!) : null;
    const taken = newKey ? await tx.get<RegistrationIndexDoc>(C.registrationIndex, newKey) : null;
    if (taken && taken.vehicleId !== v.id) throw fieldError("registration_taken", "registrationNumber", "A vehicle with this registration number already exists.");
    if (patch.status === "inactive" && v.status !== "inactive" && active > 0)
      throw new DomainError("vehicle_has_active_trips", "This vehicle has upcoming or active trips. Cancel or reassign them first.");
    const merged: VehicleDoc = {
      ...v,
      ...(patch.vehicleClass !== undefined ? { vehicleClass: patch.vehicleClass } : {}),
      ...(patch.modelId !== undefined ? { modelId: patch.modelId } : {}),
      ...(patch.makeModel !== undefined ? { makeModel: patch.makeModel } : {}),
      ...(patch.registrationNumber !== undefined ? { registrationNumber: patch.registrationNumber } : {}),
      ...(patch.maxPayloadKg !== undefined ? { maxPayloadKg: patch.maxPayloadKg } : {}),
      ...(patch.bodyType !== undefined ? { bodyType: patch.bodyType } : {}),
      ...(patch.dimensionsFt !== undefined ? { dimensionsFt: patch.dimensionsFt } : {}),
      ...(patch.acceptedGoods !== undefined ? { acceptedGoods: patch.acceptedGoods } : {}),
      ...(patch.handlingSupported !== undefined ? { handlingSupported: patch.handlingSupported } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: at,
    };
    merged.imageKey = imageKeyFor(merged.vehicleClass, merged.modelId);
    if (newKey) {
      tx.delete(C.registrationIndex, regKey(v.registrationNumber));
      tx.create<RegistrationIndexDoc>(C.registrationIndex, newKey, { id: newKey, vehicleId: v.id, agencyId, createdAt: at });
    }
    tx.set(C.vehicles, v.id, merged);
    return merged;
  });
  return toVehicleDTO(next, active);
}

/** Soft delete; frees the registration number for reuse. */
export async function removeVehicle(session: SessionContext, vehicleId: string, now: Date): Promise<void> {
  const agencyId = agencyIdOf(session);
  const at = now.toISOString();
  await getDocStore().runTransaction(async (tx) => {
    const v = await tx.get<VehicleDoc>(C.vehicles, vehicleId);
    if (!v || v.agencyId !== agencyId || v.status === "removed") throw new DomainError("not_found");
    const live = await tx.query<TripDoc>(C.trips, { where: [["vehicleId", "==", vehicleId], ["status", "in", [...LIVE_TRIP_STATUSES]]], limit: 1 });
    if (live.length > 0) throw new DomainError("vehicle_has_active_trips", "This vehicle has upcoming or active trips. Cancel them or use another vehicle first.");
    const agency = await tx.get<AgencyDoc>(C.agencies, agencyId);
    tx.update(C.vehicles, v.id, { status: "removed", updatedAt: at });
    tx.delete(C.registrationIndex, regKey(v.registrationNumber));
    if (agency) tx.update(C.agencies, agencyId, { "stats.vehicles": Math.max(0, (agency.stats?.vehicles ?? 1) - 1), updatedAt: at });
  });
}

/** multipart `photo` → vehicle_photo upload (max 5 per vehicle). */
export async function addVehiclePhoto(session: SessionContext, vehicleId: string, form: FormData, now: Date): Promise<VehicleDTO> {
  const agencyId = agencyIdOf(session);
  const v = await ownedVehicle(agencyId, vehicleId);
  if (v.photos.length >= MAX_VEHICLE_PHOTOS) throw fieldError("invalid_request", "photo", `A vehicle can have at most ${MAX_VEHICLE_PHOTOS} photos.`);
  const file = formFile(form, "photo", true);
  const saved = await saveUpload({ file, kind: "vehicle_photo", ownerType: "vehicle", ownerId: vehicleId, uploadedBy: session.userId, now, field: "photo" });
  const next = await getDocStore().runTransaction(async (tx) => {
    const cur = await tx.get<VehicleDoc>(C.vehicles, vehicleId);
    if (!cur || cur.agencyId !== agencyId || cur.status === "removed") throw new DomainError("not_found");
    if (cur.photos.length >= MAX_VEHICLE_PHOTOS) throw fieldError("invalid_request", "photo", `A vehicle can have at most ${MAX_VEHICLE_PHOTOS} photos.`);
    const merged: VehicleDoc = { ...cur, photos: [...cur.photos, { fileId: saved.id }], updatedAt: now.toISOString() };
    tx.set(C.vehicles, vehicleId, merged);
    return merged;
  });
  return toVehicleDTO(next, await activeTripCount(vehicleId));
}

export async function removeVehiclePhoto(session: SessionContext, vehicleId: string, fileId: string, now: Date): Promise<VehicleDTO> {
  const agencyId = agencyIdOf(session);
  const next = await getDocStore().runTransaction(async (tx) => {
    const cur = await tx.get<VehicleDoc>(C.vehicles, vehicleId);
    if (!cur || cur.agencyId !== agencyId || cur.status === "removed") throw new DomainError("not_found");
    if (!cur.photos.some((p) => p.fileId === fileId)) throw new DomainError("not_found");
    const merged: VehicleDoc = { ...cur, photos: cur.photos.filter((p) => p.fileId !== fileId), updatedAt: now.toISOString() };
    tx.set(C.vehicles, vehicleId, merged);
    return merged;
  });
  await markReplaced(fileId, now).catch(() => undefined);
  return toVehicleDTO(next, await activeTripCount(vehicleId));
}
