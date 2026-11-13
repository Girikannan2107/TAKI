import "server-only";
/**
 * Document builders for accounts, fleet and trip drafts — the same shapes D1's signup and
 * D2's vehicle/trip services write. Used by the seed (`src/server/seed/index.ts`) and by the
 * core test fixtures. Business transitions (publish, request, accept, pay, pickup, checkpoints,
 * deliver, review, settle) never use these: they go through `src/server/core/*`.
 */
import { newId } from "@/lib/domain/ids";
import type { Address, BodyType, GoodsCategory, IsoDate, Mobile, PackageType, SpecialHandling, StateCode, VehicleClass, VehicleCountRange } from "@/lib/domain/model";
import { cumulativeKm, getDistrict, getPlace } from "@/lib/domain/places";
import type { VehicleImageKey, VehicleModelId } from "@/lib/domain/types";
import type { AgencyDoc, CustomerDoc, DriverDoc, PhoneIndexDoc, ShipmentDoc, TripDoc, UserDoc, VehicleDoc } from "../db/schema";
import type { BatchOp } from "../db/docstore";
import { C } from "../db/collections";

const verified = (at: string, by = "seed") => ({ status: "verified" as const, submittedAt: at, reviewedAt: at, reviewedBy: by, reason: null });
const pending = (at: string) => ({ status: "pending" as const, submittedAt: at, reviewedAt: null, reviewedBy: null, reason: null });

export interface AccountInput {
  role: UserDoc["role"];
  phone: Mobile;
  displayName: string;
  passwordHash: string;
  now: Date;
  agencyId?: string | null;
  id?: string;
}

/** users/{id} + phoneIndex/{e164}. */
export function accountOps(i: AccountInput): { user: UserDoc; ops: BatchOp[] } {
  const at = i.now.toISOString();
  const user: UserDoc = {
    id: i.id ?? newId("usr"),
    role: i.role,
    phone: i.phone,
    phoneVerifiedAt: at,
    passwordHash: i.passwordHash,
    passwordChangedAt: at,
    status: "active",
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    agencyId: i.agencyId ?? null,
    displayName: i.displayName,
    createdAt: at,
    updatedAt: at,
  };
  const idx: PhoneIndexDoc = { id: i.phone, userId: user.id, role: user.role, createdAt: at };
  return { user, ops: [{ op: "create", col: C.users, id: user.id, data: user }, { op: "create", col: C.phoneIndex, id: idx.id, data: idx }] };
}

export function customerDoc(user: UserDoc, i: { fullName: string; dob: IsoDate; now: Date }): CustomerDoc {
  const at = i.now.toISOString();
  return { id: user.id, fullName: i.fullName, dob: i.dob, phone: user.phone, photo: null, stats: { bookings: 0, delivered: 0 }, createdAt: at, updatedAt: at };
}

function tokens(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const w of t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) for (let k = 2; k <= Math.min(w.length, 15); k++) out.add(w.slice(0, k));
  return [...out].slice(0, 60);
}

export function agencyDoc(
  owner: UserDoc,
  i: {
    id: string;
    agencyName: string;
    ownerName: string;
    districtId: string;
    statesCovered?: StateCode[];
    vehicleCountRange?: VehicleCountRange;
    identityFileId: string;
    verifiedStatus: "verified" | "pending";
    now: Date;
  },
): AgencyDoc {
  const d = getDistrict(i.districtId);
  if (!d) throw new Error(`Unknown district ${i.districtId}`);
  const at = i.now.toISOString();
  return {
    id: i.id,
    ownerUserId: owner.id,
    ownerName: i.ownerName,
    agencyName: i.agencyName,
    nameLower: i.agencyName.toLowerCase(),
    searchTokens: tokens(i.agencyName, d.name),
    districtId: d.id,
    state: d.state,
    statesCovered: [...new Set([d.state, ...(i.statesCovered ?? [])])],
    vehicleCountRange: i.vehicleCountRange ?? "1-5",
    phone: owner.phone,
    photo: null,
    identityDocument: { kind: "pan", numberMasked: "XXXXXX001F", numberHmac: `seed-${i.id}`, file: { fileId: i.identityFileId } },
    verification: i.verifiedStatus === "verified" ? verified(at) : pending(at),
    stats: { vehicles: 0, drivers: 0, ratingAvg: 0, ratingCount: 0, delivered: 0 },
    createdAt: at,
    updatedAt: at,
  };
}

export function driverDoc(
  user: UserDoc,
  i: {
    fullName: string;
    agency: Pick<AgencyDoc, "id" | "agencyName"> | null;
    linkStatus: "active" | "pending";
    via: "invite" | "request";
    photoFileId: string;
    licenseFileId: string;
    aadhaarFileId: string;
    now: Date;
    seq: number;
  },
): DriverDoc {
  const at = i.now.toISOString();
  const n = String(i.seq).padStart(4, "0");
  return {
    id: user.id,
    fullName: i.fullName,
    phone: user.phone,
    photo: { fileId: i.photoFileId },
    license: { numberMasked: `XXXXXXXXXXXX${n}`, numberHmac: `seed-dl-${user.id}`, file: { fileId: i.licenseFileId }, validUntil: "2031-12-31" },
    aadhaar: { numberMasked: `XXXX XXXX ${n}`, numberHmac: `seed-aa-${user.id}`, file: { fileId: i.aadhaarFileId } },
    agencyLink: i.agency
      ? { agencyId: i.agency.id, agencyName: i.agency.agencyName, status: i.linkStatus, via: i.via, requestedAt: at, decidedAt: i.linkStatus === "active" ? at : null }
      : null,
    availability: "available",
    verification: i.linkStatus === "active" ? verified(at) : pending(at),
    stats: { ratingAvg: 0, ratingCount: 0, delivered: 0 },
    createdAt: at,
    updatedAt: at,
  };
}

export function vehicleDoc(i: {
  agencyId: string;
  vehicleClass: VehicleClass;
  modelId: VehicleModelId | null;
  makeModel: string;
  registrationNumber: string;
  maxPayloadKg: number;
  bodyType: BodyType;
  acceptedGoods: GoodsCategory[];
  handlingSupported?: SpecialHandling[];
  imageKey: VehicleImageKey;
  now: Date;
  id?: string;
}): VehicleDoc {
  const at = i.now.toISOString();
  return {
    id: i.id ?? newId("veh"),
    agencyId: i.agencyId,
    vehicleClass: i.vehicleClass,
    modelId: i.modelId,
    makeModel: i.makeModel,
    registrationNumber: i.registrationNumber,
    maxPayloadKg: i.maxPayloadKg,
    bodyType: i.bodyType,
    dimensionsFt: null,
    acceptedGoods: i.acceptedGoods,
    handlingSupported: i.handlingSupported ?? [],
    photos: [],
    imageKey: i.imageKey,
    status: "active",
    createdAt: at,
    updatedAt: at,
  };
}

export interface StopInput {
  placeId: string;
  /** Minutes after the trip departure. Origin: arrive omitted. */
  arriveAfterMin?: number;
  /** Dwell before leaving (default 30); ignored for the destination. */
  dwellMin?: number;
}

/**
 * Draft trip (status "draft") with checkpoints computed from places: approx road km
 * (cumulativeKm) and times from `arriveAfterMin`.
 */
export function tripDraft(i: {
  agency: Pick<AgencyDoc, "id" | "agencyName">;
  vehicle: VehicleDoc;
  driver: Pick<DriverDoc, "id" | "fullName" | "photo" | "stats">;
  departureAt: Date;
  stops: StopInput[];
  offeredKg: number;
  rates?: { perKmPaise: number; perKgPaise: number; handlingFeeRupees: number };
  goods?: { accepted?: GoodsCategory[]; handlingSupported?: SpecialHandling[]; maxPackageKg?: number | null; notes?: string | null };
  now: Date;
  id?: string;
}): TripDoc {
  const at = i.now.toISOString();
  const km = cumulativeKm(i.stops.map((s) => s.placeId));
  const dep = i.departureAt.getTime();
  const last = i.stops.length - 1;
  const checkpoints = i.stops.map((s, idx) => {
    const p = getPlace(s.placeId);
    if (!p) throw new Error(`Unknown place ${s.placeId}`);
    const d = getDistrict(p.districtId)!;
    const arrive = idx === 0 ? null : dep + (s.arriveAfterMin ?? 60 * idx) * 60_000;
    const depart = idx === last ? null : idx === 0 ? dep : arrive! + (s.dwellMin ?? 30) * 60_000;
    return {
      index: idx,
      placeId: p.id,
      placeName: p.name,
      districtId: p.districtId,
      districtName: d.name,
      state: p.state,
      kmFromOrigin: km[idx]!,
      expectedArrivalAt: arrive === null ? null : new Date(arrive).toISOString(),
      expectedDepartureAt: depart === null ? null : new Date(depart).toISOString(),
      actualArrivalAt: null,
      actualDepartureAt: null,
    };
  });
  return {
    id: i.id ?? newId("trp"),
    agencyId: i.agency.id,
    agencyName: i.agency.agencyName,
    vehicleId: i.vehicle.id,
    vehicle: {
      vehicleClass: i.vehicle.vehicleClass,
      makeModel: i.vehicle.makeModel,
      registrationNumber: i.vehicle.registrationNumber,
      bodyType: i.vehicle.bodyType,
      photo: null,
      imageKey: i.vehicle.imageKey,
    },
    driverId: i.driver.id,
    driver: { fullName: i.driver.fullName, photo: i.driver.photo ?? null, ratingAvg: i.driver.stats.ratingAvg, ratingCount: i.driver.stats.ratingCount },
    status: "draft",
    checkpoints,
    departureAt: checkpoints[0]!.expectedDepartureAt!,
    arrivalAt: checkpoints[last]!.expectedArrivalAt!,
    distanceKm: km[last]!,
    capacity: { vehicleMaxKg: i.vehicle.maxPayloadKg, offeredKg: i.offeredKg },
    holds: {},
    goods: {
      accepted: i.goods?.accepted ?? i.vehicle.acceptedGoods,
      handlingSupported: i.goods?.handlingSupported ?? i.vehicle.handlingSupported,
      maxPackageKg: i.goods?.maxPackageKg ?? null,
      notes: i.goods?.notes ?? null,
    },
    rates: i.rates ?? { perKmPaise: 2500, perKgPaise: 150, handlingFeeRupees: 200 },
    pickupKeys: [],
    progress: { lastCheckpointIndex: null, lastEventAt: null },
    counts: { awaiting: 0, held: 0, delivered: 0 },
    publishedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: at,
    updatedAt: at,
    version: 1,
  };
}

export function address(districtId: string, line1: string, pincode: string): Address {
  const d = getDistrict(districtId);
  if (!d) throw new Error(`Unknown district ${districtId}`);
  return { line1, districtId: d.id, districtName: d.name, state: d.state, pincode, source: "manual" };
}

export function shipmentDoc(i: {
  customerId: string;
  source: Address;
  destination: Address;
  receiver: { name: string; phone: Mobile };
  weightKg: number;
  goodsCategory?: GoodsCategory;
  packageType?: PackageType;
  description?: string;
  pieces?: number;
  specialHandling?: SpecialHandling[];
  shippingDate: IsoDate;
  now: Date;
  id?: string;
}): ShipmentDoc {
  const at = i.now.toISOString();
  return {
    id: i.id ?? newId("shp"),
    customerId: i.customerId,
    source: i.source,
    destination: i.destination,
    receiver: i.receiver,
    package: {
      weightKg: i.weightKg,
      goodsCategory: i.goodsCategory ?? "general_goods",
      packageType: i.packageType ?? "box",
      description: i.description ?? "Cartons of general goods",
      pieces: i.pieces ?? 4,
      specialHandling: i.specialHandling ?? [],
      declaredValueRupees: null,
    },
    shippingDate: i.shippingDate,
    status: "open",
    currentBookingId: null,
    bookingIds: [],
    createdAt: at,
    updatedAt: at,
  };
}
