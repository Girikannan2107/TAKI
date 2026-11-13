/** Driver-module test fixtures on the MemoryDocStore (D4). Plain documents, no core calls. */
import type { BookingStatus, TripCheckpoint, TripStatus } from "@/lib/domain/model";
import type { SessionContext } from "@/server/auth/guards";
import type { AgencyDoc, BookingDoc, CustomerDoc, DriverDoc, ShipmentDoc, TripDoc, UserDoc } from "@/server/db/schema";
import { MemoryDocStore } from "../../../support/memory-docstore";

export const NOW = new Date("2026-11-20T04:30:00.000Z");
const T = NOW.toISOString();

export const DRIVER_ID = "usr_driveraaaaaaaaaaaaaaa";
export const OTHER_DRIVER_ID = "usr_drivebbbbbbbbbbbbbbbb";
export const AGENCY_ID = "agc_aaaaaaaaaaaaaaaaaaaa";
export const AGENCY_USER_ID = "usr_agencyaaaaaaaaaaaaaa";
export const CUSTOMER_ID = "usr_customeraaaaaaaaaaaa";
export const TRIP_ID = "trp_aaaaaaaaaaaaaaaaaaaa";

export function session(userId = DRIVER_ID): SessionContext {
  return {
    userId,
    role: "driver",
    sessionId: "sess",
    phone: "+919800000001",
    profileId: userId,
    agencyId: null,
    expiresAt: "2026-12-01T00:00:00.000Z",
    createdAt: T,
  };
}

const verification = { status: "verified" as const, submittedAt: T, reviewedAt: T, reviewedBy: "ops", reason: null };

export function driverDoc(id = DRIVER_ID, linkStatus: "active" | "pending" | "rejected" | null = "active"): DriverDoc {
  return {
    id,
    fullName: id === DRIVER_ID ? "Ravi Kumar" : "Other Driver",
    phone: "+919800000001",
    photo: { fileId: "fil_photoaaaaaaaaaaaaaaa" },
    license: { numberMasked: "XXXX1234", numberHmac: "h", file: { fileId: "fil_licaaaaaaaaaaaaaaaaa" }, validUntil: null },
    aadhaar: { numberMasked: "XXXX XXXX 1234", numberHmac: "h", file: { fileId: "fil_aadaaaaaaaaaaaaaaaaa" } },
    agencyLink: linkStatus
      ? { agencyId: AGENCY_ID, agencyName: "Kovai Travels", status: linkStatus, via: "request", requestedAt: T, decidedAt: linkStatus === "pending" ? null : T }
      : null,
    availability: "available",
    verification,
    stats: { ratingAvg: 4.5, ratingCount: 2, delivered: 1 },
    createdAt: T,
    updatedAt: T,
  };
}

export function agencyDoc(id = AGENCY_ID, status: "verified" | "pending" = "verified"): AgencyDoc {
  return {
    id,
    ownerUserId: AGENCY_USER_ID,
    ownerName: "Owner",
    agencyName: id === AGENCY_ID ? "Kovai Travels" : "Madurai Movers",
    nameLower: "kovai travels",
    searchTokens: [],
    districtId: "coimbatore",
    state: "TN",
    statesCovered: ["TN"],
    vehicleCountRange: "1-5",
    phone: "+919800000009",
    photo: null,
    identityDocument: { kind: "pan", numberMasked: "XXXXX1234X", numberHmac: "h", file: { fileId: "fil_panaaaaaaaaaaaaaaaaa" } },
    verification: { ...verification, status },
    stats: { vehicles: 1, drivers: 1, ratingAvg: 0, ratingCount: 0, delivered: 0 },
    createdAt: T,
    updatedAt: T,
  };
}

function cp(index: number, placeName: string, districtId: string, km: number, arr: string | null, dep: string | null): TripCheckpoint {
  return {
    index,
    placeId: districtId,
    placeName,
    districtId,
    districtName: placeName,
    state: "TN",
    kmFromOrigin: km,
    expectedArrivalAt: arr,
    expectedDepartureAt: dep,
    actualArrivalAt: null,
    actualDepartureAt: null,
  };
}

export function tripDoc(over: Partial<TripDoc> = {}, status: TripStatus = "published"): TripDoc {
  return {
    id: TRIP_ID,
    agencyId: AGENCY_ID,
    agencyName: "Kovai Travels",
    vehicleId: "veh_aaaaaaaaaaaaaaaaaaaa",
    vehicle: { vehicleClass: "Light Truck", makeModel: "Tata 407", registrationNumber: "TN 37 AB 1234", bodyType: "closed", photo: null, imageKey: "light-truck" as TripDoc["vehicle"]["imageKey"] },
    driverId: DRIVER_ID,
    driver: { fullName: "Ravi Kumar", photo: null, ratingAvg: 4.5, ratingCount: 2 },
    status,
    checkpoints: [
      cp(0, "Coimbatore", "coimbatore", 0, null, "2026-11-20T06:00:00.000Z"),
      cp(1, "Erode", "erode", 100, "2026-11-20T08:00:00.000Z", "2026-11-20T08:30:00.000Z"),
      cp(2, "Salem", "salem", 165, "2026-11-20T10:00:00.000Z", null),
    ],
    departureAt: "2026-11-20T06:00:00.000Z",
    arrivalAt: "2026-11-20T10:00:00.000Z",
    distanceKm: 165,
    capacity: { vehicleMaxKg: 2000, offeredKg: 1000 },
    holds: {},
    goods: { accepted: ["general_goods"], handlingSupported: [], maxPackageKg: null, notes: null },
    rates: { perKmPaise: 500, perKgPaise: 200, handlingFeeRupees: 0 },
    pickupKeys: [],
    progress: { lastCheckpointIndex: null, lastEventAt: null },
    counts: { awaiting: 0, held: 0, delivered: 0 },
    publishedAt: T,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    version: 1,
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

export function shipmentDoc(id: string): ShipmentDoc {
  return {
    id,
    customerId: CUSTOMER_ID,
    source: { line1: "12 Market Road", districtId: "coimbatore", districtName: "Coimbatore", state: "TN", pincode: "641001", source: "manual" },
    destination: { line1: "4 Bus Stand Street", landmark: "Near temple", districtId: "salem", districtName: "Salem", state: "TN", pincode: "636001", source: "manual" },
    receiver: { name: "Meena", phone: "+919811111111" },
    package: { weightKg: 50, goodsCategory: "general_goods", packageType: "box", description: "Kitchen utensils", pieces: 2, specialHandling: ["fragile"], declaredValueRupees: null },
    shippingDate: "2026-11-20",
    status: "booked",
    currentBookingId: null,
    bookingIds: [],
    createdAt: T,
    updatedAt: T,
  };
}

let seq = 0;
export function bookingDoc(id: string, status: BookingStatus, over: Partial<BookingDoc> = {}): BookingDoc {
  seq += 1;
  const history: BookingDoc["statusHistory"] = [{ status: "awaiting_agency", at: T, by: { role: "customer", userId: CUSTOMER_ID } }];
  const chain: BookingStatus[] = ["pending_payment", "confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"];
  const upto = chain.indexOf(status);
  for (let i = 0; i <= upto; i++) history.push({ status: chain[i]!, at: T, by: { role: "system", userId: null } });
  if (status === "cancelled") history.push({ status: "pending_payment", at: T, by: { role: "agency", userId: AGENCY_USER_ID } }, { status: "confirmed", at: T, by: { role: "system", userId: null } }, { status: "cancelled", at: T, by: { role: "driver", userId: DRIVER_ID } });
  return {
    id,
    shipmentId: `shp_${id.slice(4).padEnd(20, "a")}`,
    tripId: TRIP_ID,
    customerId: CUSTOMER_ID,
    agencyId: AGENCY_ID,
    driverId: DRIVER_ID,
    vehicleId: "veh_aaaaaaaaaaaaaaaaaaaa",
    status,
    tab: "confirmed",
    pickup: { checkpointIndex: 0, districtId: "coimbatore", placeName: "Coimbatore", expectedDepartureAt: "2026-11-20T06:00:00.000Z" },
    drop: { checkpointIndex: 2, districtId: "salem", placeName: "Salem", expectedArrivalAt: "2026-11-20T10:00:00.000Z" },
    weightKg: 50,
    goodsCategory: "general_goods",
    specialHandling: ["fragile"],
    pricing: {
      pricingVersion: 2,
      distanceKm: 165,
      weightKg: 50,
      ratePerKmPaise: 500,
      ratePerKgPaise: 200,
      distanceCharge: 825,
      weightCharge: 100,
      transportationCharge: 925,
      handlingFee: 0,
      serviceFee: 30,
      totalPayable: 955,
      lines: [],
    },
    respondBy: "2026-11-20T05:00:00.000Z",
    acceptedAt: T,
    paymentDueAt: null,
    paidAt: T,
    paymentId: null,
    statusHistory: history,
    rejection: null,
    cancellation: status === "cancelled" ? { reason: "pickup_refused", note: "Prohibited goods", at: T, by: { role: "driver", userId: DRIVER_ID } } : null,
    reviewed: false,
    display: { customerName: "Asha", agencyName: "Kovai Travels", routeLabel: "Coimbatore → Salem", tripDepartureAt: "2026-11-20T06:00:00.000Z", vehicleReg: "TN 37 AB 1234", driverName: "Ravi Kumar" },
    searchTokens: [],
    version: 1,
    createdAt: T,
    updatedAt: new Date(NOW.getTime() - seq * 60_000).toISOString(),
    ...over,
  };
}

export function customerDoc(): CustomerDoc {
  return { id: CUSTOMER_ID, fullName: "Asha", dob: "1990-01-01", phone: "+919822222222", photo: null, stats: { bookings: 1, delivered: 0 }, createdAt: T, updatedAt: T };
}

export function userDoc(id = DRIVER_ID): UserDoc {
  return {
    id,
    role: "driver",
    phone: "+919800000001",
    phoneVerifiedAt: T,
    passwordHash: "x",
    passwordChangedAt: T,
    status: "active",
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    agencyId: null,
    displayName: "Ravi Kumar",
    createdAt: T,
    updatedAt: T,
  };
}

/** Store with a linked driver, agency, customer and one published trip. */
export function baseStore(linkStatus: "active" | "pending" | "rejected" | null = "active"): MemoryDocStore {
  const s = new MemoryDocStore();
  s.put("drivers", DRIVER_ID, driverDoc(DRIVER_ID, linkStatus));
  s.put("drivers", OTHER_DRIVER_ID, driverDoc(OTHER_DRIVER_ID));
  s.put("users", DRIVER_ID, userDoc(DRIVER_ID));
  s.put("agencies", AGENCY_ID, agencyDoc());
  s.put("customers", CUSTOMER_ID, customerDoc());
  s.put("trips", TRIP_ID, tripDoc());
  return s;
}

/** Put a booking and its shipment. */
export function addBooking(s: MemoryDocStore, b: BookingDoc): BookingDoc {
  s.put("bookings", b.id, b);
  s.put("shipments", b.shipmentId, shipmentDoc(b.shipmentId));
  return b;
}
