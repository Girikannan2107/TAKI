/** Customer-module test fixtures on the MemoryDocStore (D3). Plain documents; core is only used where noted. */
import { pickupKeysFor } from "@/lib/domain/segments";
import type { BookingStatus, TripCheckpoint } from "@/lib/domain/model";
import { tabOf } from "@/lib/domain/booking-machine";
import type { SessionContext } from "@/server/auth/guards";
import type { AgencyDoc, BookingDoc, BookingSecretsDoc, CustomerDoc, DriverDoc, PaymentDoc, ShipmentDoc, TripDoc } from "@/server/db/schema";
import type { CreateShipmentValues } from "@/lib/api/contracts/customer";
import { MemoryDocStore } from "../../../support/memory-docstore";

/** 2026-11-20 10:00 IST. */
export const NOW = new Date("2026-11-20T04:30:00.000Z");
const T = NOW.toISOString();
export const TODAY = "2026-11-20";
export const TOMORROW = "2026-11-21";

export const CUSTOMER_ID = "usr_custaaaaaaaaaaaaaaaa";
export const OTHER_CUSTOMER_ID = "usr_custbbbbbbbbbbbbbbbb";
export const AGENCY_ID = "agc_aaaaaaaaaaaaaaaaaaaa";
export const UNVERIFIED_AGENCY_ID = "agc_bbbbbbbbbbbbbbbbbbbb";
export const DRIVER_ID = "usr_drivaaaaaaaaaaaaaaaa";

export function customerSession(userId = CUSTOMER_ID): SessionContext {
  return {
    userId,
    role: "customer",
    sessionId: "sess",
    phone: "+919800000001",
    profileId: userId,
    agencyId: null,
    expiresAt: "2026-12-01T00:00:00.000Z",
    createdAt: T,
    name: userId === CUSTOMER_ID ? "Priya Raman" : "Other Customer",
  } as SessionContext;
}

export function customerDoc(id = CUSTOMER_ID): CustomerDoc {
  return {
    id,
    fullName: id === CUSTOMER_ID ? "Priya Raman" : "Other Customer",
    dob: "1990-01-01",
    phone: "+919800000001",
    photo: null,
    stats: { bookings: 0, delivered: 0 },
    createdAt: T,
    updatedAt: T,
  };
}

const verification = (status: "verified" | "pending") => ({ status, submittedAt: T, reviewedAt: T, reviewedBy: "ops", reason: null });

export function agencyDoc(id = AGENCY_ID, status: "verified" | "pending" = "verified", ratingAvg = 4.2): AgencyDoc {
  return {
    id,
    ownerUserId: "usr_ownraaaaaaaaaaaaaaaa",
    ownerName: "Owner",
    agencyName: id === AGENCY_ID ? "Kovai Travels" : "Unverified Movers",
    nameLower: "kovai travels",
    searchTokens: [],
    districtId: "coimbatore",
    state: "TN",
    statesCovered: ["TN", "KL"],
    vehicleCountRange: "1-5",
    phone: "+919800000009",
    photo: null,
    identityDocument: { kind: "pan", numberMasked: "XXXXXX234F", numberHmac: "h", file: { fileId: "fil_panaaaaaaaaaaaaaaaaa" } },
    verification: verification(status),
    stats: { vehicles: 1, drivers: 1, ratingAvg, ratingCount: 3, delivered: 7 },
    createdAt: "2025-06-01T00:00:00.000Z",
    updatedAt: T,
  };
}

export function driverDoc(id = DRIVER_ID): DriverDoc {
  return {
    id,
    fullName: "Ravi Kumar",
    phone: "+919811111111",
    photo: { fileId: "fil_photoaaaaaaaaaaaaaaa" },
    license: { numberMasked: "XXXX1234", numberHmac: "h", file: { fileId: "fil_licaaaaaaaaaaaaaaaaa" } , validUntil: null },
    aadhaar: { numberMasked: "XXXX XXXX 1234", numberHmac: "h", file: { fileId: "fil_aadaaaaaaaaaaaaaaaaa" } },
    agencyLink: { agencyId: AGENCY_ID, agencyName: "Kovai Travels", status: "active", via: "request", requestedAt: T, decidedAt: T },
    availability: "available",
    verification: verification("verified"),
    stats: { ratingAvg: 4.6, ratingCount: 5, delivered: 12 },
    createdAt: T,
    updatedAt: T,
  };
}

function cp(index: number, id: string, name: string, km: number, arr: string | null, dep: string | null): TripCheckpoint {
  return {
    index,
    placeId: id,
    placeName: name,
    districtId: id,
    districtName: name,
    state: "TN",
    kmFromOrigin: km,
    expectedArrivalAt: arr,
    expectedDepartureAt: dep,
    actualArrivalAt: null,
    actualDepartureAt: null,
  };
}

/** Coimbatore 08:00 → Salem 11:00/11:30 → Vellore 15:00/15:30 → Chennai 18:00 on `date` (IST). */
export function tripDoc(over: Partial<TripDoc> & { id: string; date?: string } = { id: "trp_aaaaaaaaaaaaaaaaaaaa" }): TripDoc {
  const date = over.date ?? TOMORROW;
  const at = (hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();
  const checkpoints = over.checkpoints ?? [
    cp(0, "coimbatore", "Coimbatore", 0, null, at("08:00")),
    cp(1, "salem", "Salem", 165, at("11:00"), at("11:30")),
    cp(2, "vellore", "Vellore", 370, at("15:00"), at("15:30")),
    cp(3, "chennai", "Chennai", 498, at("18:00"), null),
  ];
  const departureAt = over.departureAt ?? at("08:00");
  const { date: _d, ...rest } = over;
  void _d;
  const base: TripDoc = {
    id: over.id,
    agencyId: AGENCY_ID,
    agencyName: "Kovai Travels",
    vehicleId: "veh_aaaaaaaaaaaaaaaaaaaa",
    vehicle: { vehicleClass: "Light Truck", makeModel: "Tata 407", registrationNumber: "TN 37 AB 1234", bodyType: "closed", photo: { fileId: "fil_vehaaaaaaaaaaaaaaaaa" }, imageKey: "light_cargo_lorry_taki" },
    driverId: DRIVER_ID,
    driver: { fullName: "Ravi Kumar", photo: { fileId: "fil_photoaaaaaaaaaaaaaaa" }, ratingAvg: 4.6, ratingCount: 5 },
    status: "published",
    checkpoints,
    departureAt,
    arrivalAt: at("18:00"),
    distanceKm: 498,
    capacity: { vehicleMaxKg: 3000, offeredKg: 2000 },
    holds: {},
    goods: { accepted: ["general_goods", "agriculture", "textiles"], handlingSupported: ["fragile"], maxPackageKg: null, notes: null },
    rates: { perKmPaise: 1200, perKgPaise: 50, handlingFeeRupees: 150 },
    pickupKeys: [],
    progress: { lastCheckpointIndex: null, lastEventAt: null },
    counts: { awaiting: 0, held: 0, delivered: 0 },
    publishedAt: T,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: T,
    updatedAt: T,
    version: 1,
  };
  const trip = { ...base, ...rest } as TripDoc;
  trip.pickupKeys = over.pickupKeys ?? (trip.status === "draft" ? [] : pickupKeysFor(trip.checkpoints, trip.departureAt));
  return trip;
}

export function shipmentInput(over: { from?: string; to?: string; weightKg?: number; date?: string; goods?: CreateShipmentValues["package"]["goodsCategory"]; handling?: CreateShipmentValues["package"]["specialHandling"] } = {}): CreateShipmentValues {
  const from = over.from ?? "coimbatore";
  const to = over.to ?? "chennai";
  return {
    source: { line1: "12 Avinashi Road", districtId: from, state: "TN", pincode: "641018", source: "manual" },
    destination: { line1: "4 Anna Salai", districtId: to, state: "TN", pincode: "600002", source: "manual" },
    receiver: { name: "Arun", phone: "+919822222222" },
    package: {
      weightKg: over.weightKg ?? 500,
      goodsCategory: over.goods ?? "general_goods",
      packageType: "box",
      description: "Cotton fabric rolls",
      pieces: 4,
      specialHandling: over.handling ?? [],
      declaredValueRupees: null,
      prohibitedItemsDeclaration: true,
    },
    shippingDate: over.date ?? TOMORROW,
  };
}

export function shipmentDoc(over: Partial<ShipmentDoc> & { id: string }): ShipmentDoc {
  const i = shipmentInput();
  return {
    customerId: CUSTOMER_ID,
    source: { ...i.source, districtName: "Coimbatore" },
    destination: { ...i.destination, districtName: "Chennai" },
    receiver: i.receiver,
    package: { ...i.package, declaredValueRupees: null },
    shippingDate: TOMORROW,
    status: "open",
    currentBookingId: null,
    bookingIds: [],
    createdAt: T,
    updatedAt: T,
    ...over,
  } as ShipmentDoc;
}

export function bookingDoc(over: Partial<BookingDoc> & { id: string; status: BookingStatus; shipmentId: string; tripId?: string }): BookingDoc {
  const trip = tripDoc({ id: over.tripId ?? "trp_aaaaaaaaaaaaaaaaaaaa" });
  return {
    tripId: trip.id,
    customerId: CUSTOMER_ID,
    agencyId: AGENCY_ID,
    driverId: DRIVER_ID,
    vehicleId: trip.vehicleId,
    tab: tabOf(over.status),
    pickup: { checkpointIndex: 0, districtId: "coimbatore", placeName: "Coimbatore", expectedDepartureAt: trip.checkpoints[0]!.expectedDepartureAt! },
    drop: { checkpointIndex: 3, districtId: "chennai", placeName: "Chennai", expectedArrivalAt: trip.checkpoints[3]!.expectedArrivalAt! },
    weightKg: 500,
    goodsCategory: "general_goods",
    specialHandling: [],
    pricing: {
      pricingVersion: 2,
      distanceKm: 498,
      weightKg: 500,
      ratePerKmPaise: 1200,
      ratePerKgPaise: 50,
      distanceCharge: 5976,
      weightCharge: 250,
      transportationCharge: 6226,
      handlingFee: 0,
      serviceFee: 350,
      totalPayable: 6576,
      lines: [],
    },
    respondBy: new Date(Date.parse(trip.checkpoints[0]!.expectedDepartureAt!) - 3600_000).toISOString(),
    acceptedAt: null,
    paymentDueAt: null,
    paidAt: null,
    paymentId: null,
    statusHistory: [{ status: over.status, at: T, by: { role: "system", userId: null } }],
    rejection: null,
    cancellation: null,
    reviewed: false,
    display: { customerName: "Priya Raman", agencyName: "Kovai Travels", routeLabel: "Coimbatore → Chennai", tripDepartureAt: trip.departureAt, vehicleReg: "TN 37 AB 1234", driverName: "Ravi Kumar" },
    searchTokens: [],
    createdAt: T,
    updatedAt: T,
    version: 1,
    ...over,
  } as BookingDoc;
}

export function secretsDoc(id: string, over: Partial<BookingSecretsDoc> = {}): BookingSecretsDoc {
  return { id, pickupOtp: "123456", deliveryOtp: "654321", pickupAttempts: 0, deliveryAttempts: 0, pickupUsedAt: null, deliveryUsedAt: null, issuedAt: T, updatedAt: T, ...over };
}

export function paymentDoc(id: string, bookingId: string, over: Partial<PaymentDoc> = {}): PaymentDoc {
  return {
    id,
    bookingId,
    customerId: CUSTOMER_ID,
    agencyId: AGENCY_ID,
    provider: "dev",
    providerEnv: "dev",
    amountPaise: 657600,
    currency: "INR",
    status: "succeeded",
    idempotencyKey: "k_1",
    providerOrderId: id,
    checkout: {},
    expiresAt: T,
    providerPaymentId: "dev_1",
    methodLabel: "UPI",
    confirmation: { source: "dev_confirm", at: T, providerStatus: "PAID" },
    failureReason: null,
    refund: null,
    createdAt: T,
    updatedAt: T,
    version: 1,
    ...over,
  };
}

/** Store with a customer, a verified agency, its driver. */
export function seededStore(): MemoryDocStore {
  const s = new MemoryDocStore();
  s.put("customers", CUSTOMER_ID, customerDoc());
  s.put("customers", OTHER_CUSTOMER_ID, customerDoc(OTHER_CUSTOMER_ID));
  s.put("agencies", AGENCY_ID, agencyDoc());
  s.put("agencies", UNVERIFIED_AGENCY_ID, agencyDoc(UNVERIFIED_AGENCY_ID, "pending", 5));
  s.put("drivers", DRIVER_ID, driverDoc());
  return s;
}
