import "server-only";
/**
 * Development seed (P2 §11). Builds a realistic dataset relative to `now` (IST):
 *  - 1 admin; 3 agencies (Coimbatore + Chennai verified, Kochi pending) with vehicles and drivers
 *    (invite-linked, request-linked, pending link);
 *  - 17 published trips over the next 14 days (TN, KL, KA; Coimbatore→Chennai on days 1/3/6/9/12),
 *    1 trip in progress today, 2 completed last week, 1 draft at the unverified agency;
 *  - 4 customers with bookings in every status, delivered ones reviewed and earning (with a
 *    delivery proof photo), one agency's earnings settled (reference SEED-UTR-0001), a cancelled
 *    booking refunded.
 *
 * Demo accounts (password `SEED_PASSWORD`, default "Taki@2026"; the e2e specs use these):
 *  - admin     9000000001  TAKI Ops (/admin)
 *  - customer  9876543210  Priya Raman: CONFIRMED pickups on the demo driver's active trip (Erode)
 *                          and next trip, a delivered + reviewed booking, a pending request, a rejection
 *  - driver    9876543211  Ravi Kumar, approved, linked to Kovai Freight Lines; trip in progress today
 *                          (picked-up / out-for-delivery / confirmed bookings), delivered history with proofs
 *  - agency    9876543220  Kovai Freight Lines (verified, Coimbatore); runs the Coimbatore→Chennai trips
 *  Other accounts (9000000xxx) are printed by `npm run seed` and written to .data/seed-accounts.txt.
 *
 * Accounts, fleet and trip drafts are written with the builders (the same shapes D1/D2 write).
 * EVERY business transition (publish, request, accept, pay, pickup, checkpoints, deliver,
 * review, cancel, settle) goes through `src/server/core` / payments with an explicit clock,
 * so the seed doubles as an end-to-end smoke test of the core.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BodyType, GoodsCategory, IsoDate, Mobile, SpecialHandling, StateCode, VehicleClass, VehicleCountRange } from "@/lib/domain/model";
import { cumulativeKm, estimateMinutes, getPlace } from "@/lib/domain/places";
import type { VehicleImageKey, VehicleModelId } from "@/lib/domain/types";
import { hashPassword } from "../auth/passwords";
import { bookings } from "../core/bookings";
import type { Ctx, SessionContext } from "../core/context";
import { recordSettlement } from "../core/earnings";
import { runDueJobs } from "../core/jobs";
import { nextStep, tripsLifecycle } from "../core/trips-lifecycle";
import { getDocStore } from "../db";
import { C } from "../db/collections";
import type { BatchOp } from "../db/docstore";
import type { AgencyDoc, BookingDoc, BookingSecretsDoc, CustomerDoc, DriverDoc, DriverInviteDoc, FileDoc, RegistrationIndexDoc, ShipmentDoc, TripDoc, UserDoc, VehicleDoc } from "../db/schema";
import { saveUpload } from "../files/uploads";
import { flushAfterTasks, queueAfterTasks } from "../http/after";
import { devTokenFor } from "../payments/dev";
import { payments } from "../payments/service";
import { accountOps, address, agencyDoc, customerDoc, driverDoc, shipmentDoc, tripDraft, vehicleDoc, type StopInput } from "./builders";

export const SEED_DEFAULT_PASSWORD = "Taki@2026";

export interface SeedAccount {
  role: UserDoc["role"];
  name: string;
  phone: string;
  note: string;
}

export interface SeedResult {
  accounts: SeedAccount[];
  counts: Record<string, number>;
}

export interface SeedOptions {
  now: Date;
  password: string;
  assetsDir: string;
  log?: (line: string) => void;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const IST_MS = 330 * MIN;

/** `dayOffset` days after `base` (IST calendar), at IST `hh:mm`. */
function istAt(base: Date, dayOffset: number, hhmm: string): Date {
  const ist = new Date(base.getTime() + IST_MS);
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + dayOffset, hh, mm) - IST_MS);
}

function istDate(d: Date | string): IsoDate {
  return new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
}

const plus = (d: Date | string, ms: number) => new Date(new Date(d).getTime() + ms);

/** Stops with arrival offsets from approx road km at average speed, plus `dwell` minutes per stop. */
function route(placeIds: string[], dwell = 30): StopInput[] {
  const km = cumulativeKm(placeIds);
  return placeIds.map((placeId, i) => (i === 0 ? { placeId } : { placeId, arriveAfterMin: estimateMinutes(km[i]!) + dwell * (i - 1), dwellMin: dwell }));
}

const phone = (n: string): Mobile => `+91${n}` as Mobile;
const ctx = (actor: SessionContext, now: Date): Ctx => ({ actor, now });

function session(user: UserDoc, name: string): SessionContext {
  return {
    userId: user.id,
    role: user.role,
    profileId: user.role === "agency" ? (user.agencyId ?? user.id) : user.id,
    agencyId: user.agencyId,
    sessionId: "seed",
    name,
    phone: user.phone,
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: user.createdAt,
  };
}

let keySeq = 0;
const key = () => `seed-${Date.now().toString(36)}-${++keySeq}`;

export async function runSeed(o: SeedOptions): Promise<SeedResult> {
  const log = o.log ?? (() => undefined);
  const store = getDocStore();
  const NOW = o.now;
  const created = NOW.getTime() - 60 * DAY;
  const T = (ms: number) => new Date(ms);
  const accounts: SeedAccount[] = [];
  queueAfterTasks(true);

  const [docPng, photoPng] = await Promise.all([readFile(path.join(o.assetsDir, "sample-doc.png")), readFile(path.join(o.assetsDir, "sample-photo.png"))]);
  const passwordHash = await hashPassword(o.password);
  const bootstrap = T(created);
  const ops: BatchOp[] = [];

  // ── Accounts ──────────────────────────────────────────────────────────────
  function account(role: UserDoc["role"], digits: string, displayName: string, note: string, agencyId: string | null = null): UserDoc {
    const { user, ops: o2 } = accountOps({ role, phone: phone(digits), displayName, passwordHash, now: bootstrap, agencyId });
    ops.push(...o2);
    accounts.push({ role, name: displayName, phone: digits, note });
    return user;
  }

  account("admin", "9000000001", "TAKI Ops", "Hidden /admin console");

  type AgencySpec = { key: string; id: string; digits: string; owner: string; name: string; district: string; states: StateCode[]; range: VehicleCountRange; status: "verified" | "pending" };
  const agencySpecs: AgencySpec[] = [
    { key: "kovai", id: "agc_seedkovaifreight01", digits: "9876543220", owner: "Kavitha Raman", name: "Kovai Freight Lines", district: "coimbatore", states: ["TN", "KL", "KA"], range: "6-10", status: "verified" },
    { key: "chennai", id: "agc_seedchennaicargo01", digits: "9000000201", owner: "Arjun Subramanian", name: "Chennai Cargo Movers", district: "chennai", states: ["TN", "KA"], range: "11-25", status: "verified" },
    { key: "kochi", id: "agc_seedkochicoastal01", digits: "9000000301", owner: "Anitha Joseph", name: "Kochi Coastal Logistics", district: "ernakulam", states: ["KL", "TN"], range: "1-5", status: "pending" },
  ];
  const owners = new Map<string, UserDoc>();
  for (const a of agencySpecs) owners.set(a.key, account("agency", a.digits, a.owner, `${a.name} (${a.status})`, a.id));

  type DriverSpec = { key: string; digits: string; name: string; agency: string; status: "active" | "pending"; via: "invite" | "request" };
  const driverSpecs: DriverSpec[] = [
    { key: "murugan", digits: "9000000111", name: "Murugan Selvam", agency: "kovai", status: "active", via: "invite" },
    { key: "ravi", digits: "9876543211", name: "Ravi Kumar", agency: "kovai", status: "active", via: "request" },
    { key: "ganesh", digits: "9000000115", name: "Ganesh Pandian", agency: "kovai", status: "active", via: "invite" },
    { key: "senthil", digits: "9000000113", name: "Senthil Nathan", agency: "kovai", status: "pending", via: "request" },
    { key: "imran", digits: "9000000211", name: "Imran Basha", agency: "chennai", status: "active", via: "invite" },
    { key: "prakash", digits: "9000000212", name: "Prakash Raj", agency: "chennai", status: "active", via: "request" },
    { key: "joby", digits: "9000000311", name: "Joby Thomas", agency: "kochi", status: "pending", via: "request" },
  ];
  const driverUsers = new Map<string, UserDoc>();
  for (const d of driverSpecs) driverUsers.set(d.key, account("driver", d.digits, d.name, `Driver, ${d.status === "active" ? "linked" : "awaiting approval"} (${d.agency})`));

  const customerSpecs = [
    { key: "priya", digits: "9876543210", name: "Priya Raman", dob: "1991-04-12" },
    { key: "karthik", digits: "9000000402", name: "Karthik Iyer", dob: "1987-09-30" },
    { key: "fathima", digits: "9000000403", name: "Fathima Beevi", dob: "1995-01-22" },
    { key: "suresh", digits: "9000000404", name: "Suresh Babu", dob: "1979-06-05" },
  ];
  const customerUsers = new Map<string, UserDoc>();
  for (const c of customerSpecs) customerUsers.set(c.key, account("customer", c.digits, c.name, "Customer"));
  await store.batchWrite(ops.splice(0));
  log(`accounts: ${accounts.length}`);

  // ── Sample files (sample: true) ─────────────────────────────────────────────
  const upload = async (bytes: Uint8Array, kind: FileDoc["kind"], ownerType: FileDoc["ownerType"], ownerId: string, by: string, at: Date) =>
    (await saveUpload({ file: bytes, kind, ownerType, ownerId, uploadedBy: by, now: at, sample: true })).id;

  // ── Agencies, drivers, vehicles, customers ──────────────────────────────────
  const agencies = new Map<string, AgencyDoc>();
  for (const a of agencySpecs) {
    const owner = owners.get(a.key)!;
    const fileId = await upload(docPng, "pan", "agency", a.id, owner.id, bootstrap);
    agencies.set(a.key, agencyDoc(owner, { id: a.id, agencyName: a.name, ownerName: a.owner, districtId: a.district, statesCovered: a.states, vehicleCountRange: a.range, identityFileId: fileId, verifiedStatus: a.status, now: bootstrap }));
  }

  const drivers = new Map<string, DriverDoc>();
  const driverSessions = new Map<string, SessionContext>();
  let dseq = 0;
  for (const d of driverSpecs) {
    const user = driverUsers.get(d.key)!;
    const [photo, dl, aa] = [await upload(photoPng, "profile_photo", "driver", user.id, user.id, bootstrap), await upload(docPng, "driving_license", "driver", user.id, user.id, bootstrap), await upload(docPng, "aadhaar", "driver", user.id, user.id, bootstrap)];
    const doc = driverDoc(user, { fullName: d.name, agency: agencies.get(d.agency)!, linkStatus: d.status, via: d.via, photoFileId: photo, licenseFileId: dl, aadhaarFileId: aa, now: bootstrap, seq: ++dseq });
    drivers.set(d.key, doc);
    driverSessions.set(d.key, session(user, d.name));
  }

  type VehicleSpec = { key: string; agency: string; cls: VehicleClass; model: VehicleModelId; makeModel: string; reg: string; kg: number; body: BodyType; goods: GoodsCategory[]; handling: SpecialHandling[]; image: VehicleImageKey };
  const ALL_GOODS: GoodsCategory[] = ["general_goods", "agriculture", "construction", "industrial", "electronics", "furniture", "textiles", "other"];
  const vehicleSpecs: VehicleSpec[] = [
    { key: "kv1", agency: "kovai", cls: "Light Truck", model: "tata_407", makeModel: "Tata 407", reg: "TN 37 BX 4587", kg: 3000, body: "tarpaulin", goods: ALL_GOODS, handling: ["fragile", "keep_dry", "this_side_up"], image: "light_cargo_lorry_taki" },
    { key: "kv2", agency: "kovai", cls: "Medium Truck", model: "eicher_pro", makeModel: "Eicher Pro 2049", reg: "TN 38 CK 2211", kg: 5000, body: "closed", goods: [...ALL_GOODS, "perishables"], handling: ["fragile", "keep_dry", "this_side_up", "temperature_sensitive"], image: "multi_axle_container_taki" },
    { key: "kv3", agency: "kovai", cls: "Pickup", model: "mahindra_bolero_pickup", makeModel: "Mahindra Bolero Pik-Up", reg: "TN 66 AZ 1190", kg: 1500, body: "open", goods: ["general_goods", "agriculture", "construction", "other"], handling: [], image: "medium_box_truck_generic" },
    { key: "kv4", agency: "kovai", cls: "Heavy Truck", model: "ashok_leyland_ecomet", makeModel: "Ashok Leyland Ecomet 1615", reg: "TN 37 DM 6620", kg: 7000, body: "closed", goods: ALL_GOODS, handling: ["fragile", "keep_dry", "this_side_up"], image: "large_curtainside_lorry_taki" },
    { key: "cv1", agency: "chennai", cls: "Heavy Truck", model: "ashok_leyland_ecomet", makeModel: "Ashok Leyland Ecomet 1615", reg: "TN 09 BW 7781", kg: 7000, body: "container", goods: ALL_GOODS, handling: ["fragile", "keep_dry", "this_side_up"], image: "large_curtainside_lorry_taki" },
    { key: "cv2", agency: "chennai", cls: "Mini Truck", model: "tata_ace", makeModel: "Tata Ace Gold", reg: "TN 22 DA 3104", kg: 750, body: "closed", goods: ["general_goods", "electronics", "textiles", "furniture", "other"], handling: ["fragile", "keep_dry"], image: "mini_delivery_truck_taki" },
    { key: "kc1", agency: "kochi", cls: "Light Truck", model: "tata_407", makeModel: "Tata 407", reg: "KL 07 CB 5520", kg: 3000, body: "tarpaulin", goods: ALL_GOODS, handling: ["keep_dry"], image: "green_tarpaulin_truck_taki" },
  ];
  const vehicles = new Map<string, VehicleDoc>();
  for (const v of vehicleSpecs) {
    const doc = vehicleDoc({ agencyId: agencies.get(v.agency)!.id, vehicleClass: v.cls, modelId: v.model, makeModel: v.makeModel, registrationNumber: v.reg, maxPayloadKg: v.kg, bodyType: v.body, acceptedGoods: v.goods, handlingSupported: v.handling, imageKey: v.image, now: bootstrap });
    vehicles.set(v.key, doc);
    const regKey = v.reg.replace(/\s+/g, "").toUpperCase();
    const idx: RegistrationIndexDoc = { id: regKey, vehicleId: doc.id, agencyId: doc.agencyId, createdAt: bootstrap.toISOString() };
    ops.push({ op: "create", col: C.vehicles, id: doc.id, data: doc }, { op: "create", col: C.registrationIndex, id: regKey, data: idx });
  }
  for (const [k, a] of agencies) {
    a.stats.vehicles = vehicleSpecs.filter((v) => v.agency === k).length;
    a.stats.drivers = driverSpecs.filter((d) => d.agency === k && d.status === "active").length;
    ops.push({ op: "create", col: C.agencies, id: a.id, data: a });
  }
  for (const d of drivers.values()) ops.push({ op: "create", col: C.drivers, id: d.id, data: d });

  const customers = new Map<string, CustomerDoc>();
  const customerSessions = new Map<string, SessionContext>();
  for (const c of customerSpecs) {
    const user = customerUsers.get(c.key)!;
    const doc = customerDoc(user, { fullName: c.name, dob: c.dob, now: bootstrap });
    customers.set(c.key, doc);
    customerSessions.set(c.key, session(user, c.name));
    ops.push({ op: "create", col: C.customers, id: doc.id, data: doc });
  }

  // A pending phone invite (shown on the agency's Drivers page).
  const kovai = agencies.get("kovai")!;
  const invite: DriverInviteDoc = {
    id: "inv_seedkovaiinvite0001",
    agencyId: kovai.id,
    agencyName: kovai.agencyName,
    phone: phone("9000000114"),
    fullName: "Balaji Krishnan",
    status: "pending",
    expiresAt: plus(NOW, 6 * DAY).toISOString(),
    driverId: null,
    createdAt: plus(NOW, -DAY).toISOString(),
    updatedAt: plus(NOW, -DAY).toISOString(),
  };
  ops.push({ op: "create", col: C.driverInvites, id: invite.id, data: invite });
  await store.batchWrite(ops.splice(0));
  log(`fleet: ${agencies.size} agencies, ${vehicles.size} vehicles, ${drivers.size} drivers, ${customers.size} customers`);

  const ownerSession = (k: string) => session(owners.get(k)!, agencySpecs.find((a) => a.key === k)!.owner);

  // ── Helpers over the core ───────────────────────────────────────────────────
  async function draft(agency: string, vehicle: string, driver: string, departureAt: Date, places: string[], offeredKg: number, rates: { perKmPaise: number; perKgPaise: number; handlingFeeRupees: number }, at: Date, notes: string | null = null): Promise<TripDoc> {
    const t = tripDraft({ agency: agencies.get(agency)!, vehicle: vehicles.get(vehicle)!, driver: drivers.get(driver)!, departureAt, stops: route(places), offeredKg, rates, goods: { notes }, now: at });
    await store.batchWrite([{ op: "create", col: C.trips, id: t.id, data: t }]);
    return t;
  }
  async function publish(agency: string, t: TripDoc, at: Date): Promise<TripDoc> {
    return tripsLifecycle.publish(ctx(ownerSession(agency), at), t.id);
  }

  async function shipment(customer: string, from: string, to: string, kg: number, date: IsoDate, at: Date, extra: Partial<{ goods: GoodsCategory; description: string; handling: SpecialHandling[]; pieces: number; line: [string, string]; receiver: [string, string] }> = {}): Promise<ShipmentDoc> {
    const pins: Record<string, string> = { coimbatore: "641018", tiruppur: "641604", erode: "638001", salem: "636007", chennai: "600032", kanchipuram: "631501", vellore: "632004", krishnagiri: "635001", "bengaluru-urban": "560058", tiruchirappalli: "620001", madurai: "625001", palakkad: "678001", thrissur: "680001", ernakulam: "682016", namakkal: "637001", dindigul: "624001", mysuru: "570001" };
    const s = shipmentDoc({
      customerId: customers.get(customer)!.id,
      source: address(from, extra.line?.[0] ?? "14, Mill Road, Industrial Estate", pins[from] ?? "600001"),
      destination: address(to, extra.line?.[1] ?? "7, Market Street", pins[to] ?? "600001"),
      receiver: { name: extra.receiver?.[0] ?? "Store Manager", phone: phone(extra.receiver?.[1] ?? "9876501234") },
      weightKg: kg,
      goodsCategory: extra.goods ?? "general_goods",
      description: extra.description ?? "Cartons of packaged goods",
      pieces: extra.pieces ?? Math.max(1, Math.round(kg / 40)),
      specialHandling: extra.handling ?? [],
      shippingDate: date,
      now: at,
    });
    await store.batchWrite([{ op: "create", col: C.shipments, id: s.id, data: s }]);
    return s;
  }

  async function request(customer: string, s: ShipmentDoc, t: TripDoc, at: Date): Promise<BookingDoc> {
    return (await bookings.request(ctx(customerSessions.get(customer)!, at), { shipmentId: s.id, tripId: t.id, idempotencyKey: key() })).booking;
  }
  const accept = (agency: string, b: BookingDoc, at: Date) => bookings.accept(ctx(ownerSession(agency), at), b.id);
  async function pay(customer: string, b: BookingDoc, at: Date, outcome: "success" | "failure" = "success") {
    const c = ctx(customerSessions.get(customer)!, at);
    const order = await payments.createOrder(c, b.id, key());
    return payments.devConfirm(c, { paymentId: order.paymentId, outcome, devToken: devTokenFor(order.paymentId) });
  }
  async function booked(agency: string, customer: string, t: TripDoc, from: string, to: string, kg: number, at: Date, extra: Parameters<typeof shipment>[6] = {}): Promise<BookingDoc> {
    const pickupIdx = t.checkpoints.findIndex((c) => c.districtId === from);
    const s = await shipment(customer, from, to, kg, istDate(t.checkpoints[pickupIdx]!.expectedDepartureAt ?? t.departureAt), plus(at, -30 * MIN), extra);
    const b = await request(customer, s, t, at);
    await accept(agency, b, plus(at, 20 * MIN));
    await pay(customer, b, plus(at, 30 * MIN));
    return (await store.get<BookingDoc>(C.bookings, b.id))!;
  }
  const secrets = async (b: BookingDoc) => (await store.get<BookingSecretsDoc>(C.bookingSecrets, b.id))!;
  async function pickup(driver: string, b: BookingDoc, at: Date, remarks?: string) {
    return bookings.pickup(ctx(driverSessions.get(driver)!, at), b.id, (await secrets(b)).pickupOtp, remarks);
  }
  async function deliver(driver: string, b: BookingDoc, at: Date, remarks: string) {
    const proof = await upload(photoPng, "delivery_proof", "booking", b.id, driverSessions.get(driver)!.userId, at);
    return bookings.deliver(ctx(driverSessions.get(driver)!, at), b.id, { otp: (await secrets(b)).deliveryOtp, proofFileIds: [proof], remarks });
  }
  /** Run the driver's checkpoint steps in order until `stop` returns true (before executing that step). */
  async function drive(driver: string, tripId: string, onStep: (step: { index: number; kind: "arrive" | "depart" }, trip: TripDoc) => Promise<Date | null>): Promise<TripDoc> {
    let trip = (await store.get<TripDoc>(C.trips, tripId))!;
    for (;;) {
      const step = nextStep(trip);
      if (!step) return trip;
      const at = await onStep(step, trip);
      if (!at) return trip;
      trip = await tripsLifecycle.checkpoint(ctx(driverSessions.get(driver)!, at), tripId, step.index, step.kind, { remarks: step.kind === "arrive" && step.index > 0 ? `Reached ${trip.checkpoints[step.index]!.placeName}` : undefined });
    }
  }
  const expectedAt = (t: TripDoc, step: { index: number; kind: "arrive" | "depart" }) => {
    const c = t.checkpoints[step.index]!;
    return new Date((step.kind === "arrive" ? c.expectedArrivalAt : c.expectedDepartureAt) ?? t.departureAt);
  };
  const review = (customer: string, b: BookingDoc, at: Date, rating: number, comment: string) => bookings.review(ctx(customerSessions.get(customer)!, at), b.id, { rating, comment });

  const KOVAI_RATES = { perKmPaise: 2400, perKgPaise: 160, handlingFeeRupees: 150 };
  const CHENNAI_RATES = { perKmPaise: 2800, perKgPaise: 140, handlingFeeRupees: 200 };

  // ── Completed trip A (Kovai, last week, demo driver): three deliveries, two reviews ─────
  {
    const dep = istAt(NOW, -7, "06:00");
    const t0 = await draft("kovai", "kv1", "ravi", dep, ["coimbatore", "tiruppur", "erode", "salem"], 2500, KOVAI_RATES, plus(dep, -3 * DAY));
    const t = await publish("kovai", t0, plus(dep, -3 * DAY));
    const reqAt = plus(dep, -DAY);
    const b1 = await booked("kovai", "priya", t, "coimbatore", "salem", 300, reqAt, { goods: "textiles", description: "Cotton yarn bales", receiver: ["Lakshmi Textiles", "9876501001"] });
    const b2 = await booked("kovai", "karthik", t, "tiruppur", "erode", 150, plus(reqAt, HOUR), { goods: "textiles", description: "Knitwear cartons", handling: ["keep_dry"] });
    const b3 = await booked("kovai", "fathima", t, "coimbatore", "erode", 200, plus(reqAt, 2 * HOUR), { goods: "industrial", description: "Pump spares", handling: ["fragile"] });
    await pickup("ravi", b1, plus(dep, -20 * MIN), "4 bales loaded");
    await pickup("ravi", b3, plus(dep, -15 * MIN));
    await drive("ravi", t.id, async (step, trip) => {
      const at = plus(expectedAt(trip, step), 5 * MIN);
      if (step.kind === "depart" && step.index === 1) await pickup("ravi", b2, plus(at, -10 * MIN));
      return at;
    });
    // Deliveries happen at the drop checkpoints (after the auto out_for_delivery).
    const tt = (await store.get<TripDoc>(C.trips, t.id))!;
    await deliver("ravi", b2, plus(tt.checkpoints[2]!.actualArrivalAt!, 25 * MIN), "Received by the godown supervisor");
    await deliver("ravi", b3, plus(tt.checkpoints[2]!.actualArrivalAt!, 40 * MIN), "Handed over at the gate");
    await deliver("ravi", b1, plus(tt.checkpoints[3]!.actualArrivalAt!, 20 * MIN), "All bales delivered");
    await tripsLifecycle.complete(ctx(driverSessions.get("ravi")!, plus(tt.checkpoints[3]!.actualArrivalAt!, HOUR)), t.id);
    await review("priya", b1, plus(dep, DAY), 5, "On time and the driver was very careful with the bales.");
    await review("karthik", b2, plus(dep, DAY + 3 * HOUR), 4, "Smooth pickup. Delivery was a little late.");
    log("completed trip A");
  }

  // ── Completed trip B (Chennai, last week): settled with SEED-UTR-0001 ──────
  {
    const dep = istAt(NOW, -5, "21:00");
    const t0 = await draft("chennai", "cv1", "imran", dep, ["chennai", "kanchipuram", "vellore", "krishnagiri", "bengaluru"], 6000, CHENNAI_RATES, plus(dep, -4 * DAY));
    const t = await publish("chennai", t0, plus(dep, -4 * DAY));
    const reqAt = plus(dep, -2 * DAY);
    const b1 = await booked("chennai", "suresh", t, "chennai", "bengaluru-urban", 500, reqAt, { goods: "electronics", description: "Boxed LED panels", handling: ["fragile", "this_side_up"], receiver: ["Brightline Electricals", "9876502002"] });
    const b2 = await booked("chennai", "priya", t, "vellore", "bengaluru-urban", 120, plus(reqAt, HOUR), { goods: "furniture", description: "Flat-pack study tables" });
    await pickup("imran", b1, plus(dep, -30 * MIN));
    await drive("imran", t.id, async (step, trip) => {
      const at = plus(expectedAt(trip, step), 10 * MIN);
      if (step.kind === "depart" && step.index === 2) await pickup("imran", b2, plus(at, -10 * MIN));
      return at;
    });
    const tt = (await store.get<TripDoc>(C.trips, t.id))!;
    const end = new Date(tt.checkpoints[4]!.actualArrivalAt!);
    await deliver("imran", b1, plus(end, 30 * MIN), "Unloaded at the warehouse dock");
    await deliver("imran", b2, plus(end, 55 * MIN), "Delivered to the receiver");
    await tripsLifecycle.complete(ctx(driverSessions.get("imran")!, plus(end, 2 * HOUR)), t.id);
    await review("suresh", b1, plus(end, 6 * HOUR), 5, "Panels arrived without a scratch.");
    await recordSettlement({ agencyId: agencies.get("chennai")!.id, through: istDate(plus(end, 3 * HOUR)), reference: "SEED-UTR-0001", recordedBy: "ops", now: plus(end, 2 * DAY) });
    log("completed trip B (settled)");
  }

  // ── Trip C in progress today (Kovai): in_transit, picked_up, out_for_delivery ──
  {
    const places = ["coimbatore", "tiruppur", "erode", "salem"];
    const firstLeg = estimateMinutes(cumulativeKm(places)[1]!);
    const dep = plus(NOW, -(firstLeg + 45) * MIN);
    const t0 = await draft("kovai", "kv2", "ravi", dep, places, 4000, KOVAI_RATES, plus(dep, -2 * DAY));
    const t = await publish("kovai", t0, plus(dep, -2 * DAY));
    const reqAt = plus(dep, -20 * HOUR);
    const a = await booked("kovai", "karthik", t, "coimbatore", "salem", 400, reqAt, { goods: "agriculture", description: "Turmeric sacks", receiver: ["Salem Spice Traders", "9876503003"] });
    const b = await booked("kovai", "fathima", t, "tiruppur", "salem", 250, plus(reqAt, HOUR), { goods: "textiles", description: "Garment cartons", handling: ["keep_dry"] });
    const c = await booked("kovai", "suresh", t, "coimbatore", "tiruppur", 150, plus(reqAt, 2 * HOUR), { goods: "industrial", description: "Motor parts", handling: ["fragile"] });
    // Demo customer, picked up later at Erode: CONFIRMED on the demo driver's active trip.
    await booked("kovai", "priya", t, "erode", "salem", 180, plus(reqAt, 3 * HOUR), { goods: "general_goods", description: "Boxed kitchen appliances", handling: ["fragile", "this_side_up"], line: ["22, Perundurai Road", "9, Cherry Road"], receiver: ["Ramesh Appliances", "9876504004"] });
    await pickup("ravi", a, plus(dep, -20 * MIN), "12 sacks loaded");
    await pickup("ravi", c, plus(dep, -10 * MIN));
    // Demo customer, picked up at Coimbatore: IN_TRANSIT once the truck departs.
    const p = await booked("kovai", "priya", t, "coimbatore", "erode", 140, plus(reqAt, 4 * HOUR), { goods: "textiles", description: "Cotton saree bundles", handling: ["keep_dry"], receiver: ["Erode Silk House", "9876506006"] });
    await pickup("ravi", p, plus(dep, -5 * MIN), "3 bundles loaded");
    await drive("ravi", t.id, async (step, trip) => {
      if (step.kind === "depart" && step.index === 0) return dep;
      if (step.kind === "arrive" && step.index === 1) return plus(expectedAt(trip, step), 5 * MIN);
      return null; // the truck is at Tiruppur now
    });
    const tt = (await store.get<TripDoc>(C.trips, t.id))!;
    await pickup("ravi", b, plus(tt.checkpoints[1]!.actualArrivalAt!, 10 * MIN), "Loaded at Tiruppur");
    log("in-progress trip C");
  }

  // ── Future published trips (12) ────────────────────────────────────────────
  const publishAt = plus(NOW, -2 * DAY);
  const future: Array<[string, string, string, number, string, string[], number, string | null]> = [
    ["kovai", "kv1", "murugan", 1, "06:00", ["coimbatore", "tiruppur", "erode", "salem"], 2500, "No liquids in open containers."],
    ["kovai", "kv2", "ravi", 2, "07:00", ["coimbatore", "palakkad", "thrissur", "kochi"], 4500, null],
    ["kovai", "kv3", "murugan", 3, "05:30", ["coimbatore", "pollachi", "palani", "dindigul", "madurai"], 1400, "Open body: tarpaulin cover available."],
    ["kovai", "kv1", "ravi", 5, "06:00", ["salem", "namakkal", "tiruchirappalli", "madurai"], 2800, null],
    ["kovai", "kv2", "murugan", 7, "22:00", ["coimbatore", "erode", "salem", "krishnagiri", "hosur", "bengaluru"], 5000, "Overnight run; cold storage on request."],
    ["kovai", "kv3", "ravi", 10, "06:00", ["kochi", "thrissur", "palakkad", "coimbatore"], 1500, null],
    ["kovai", "kv1", "murugan", 13, "06:00", ["coimbatore", "tiruppur", "erode"], 3000, null],
    ["kovai", "kv4", "ganesh", 1, "06:00", ["coimbatore", "erode", "salem", "krishnagiri", "vellore", "chennai"], 6000, "Closed body. Daily Coimbatore–Chennai service."],
    ["kovai", "kv4", "ganesh", 3, "06:00", ["coimbatore", "erode", "salem", "krishnagiri", "vellore", "chennai"], 6000, null],
    ["kovai", "kv4", "ganesh", 6, "06:00", ["coimbatore", "erode", "salem", "krishnagiri", "vellore", "chennai"], 6000, null],
    ["kovai", "kv4", "ganesh", 9, "06:00", ["coimbatore", "erode", "salem", "krishnagiri", "vellore", "chennai"], 6000, null],
    ["kovai", "kv4", "ganesh", 12, "06:00", ["coimbatore", "erode", "salem", "krishnagiri", "vellore", "chennai"], 6000, null],
    ["chennai", "cv1", "imran", 1, "21:00", ["chennai", "kanchipuram", "vellore", "krishnagiri", "bengaluru"], 7000, "Container: no loose bulk."],
    ["chennai", "cv2", "prakash", 2, "06:00", ["chennai", "tiruchirappalli", "madurai"], 750, null],
    ["chennai", "cv1", "imran", 4, "20:00", ["bengaluru", "mysuru"], 6500, null],
    ["chennai", "cv2", "prakash", 8, "06:00", ["chennai", "vellore", "krishnagiri", "salem", "coimbatore"], 700, null],
    ["chennai", "cv1", "imran", 12, "21:00", ["chennai", "kanchipuram", "vellore"], 6000, null],
  ];
  const trips: TripDoc[] = [];
  for (const [agency, vehicle, driver, day, hhmm, places, kg, notes] of future) {
    for (const p of places) if (!getPlace(p)) throw new Error(`Unknown place ${p}`);
    const t0 = await draft(agency, vehicle, driver, istAt(NOW, day, hhmm), places, kg, agency === "kovai" ? KOVAI_RATES : CHENNAI_RATES, publishAt, notes);
    trips.push(await publish(agency, t0, publishAt));
  }
  log(`future trips: ${trips.length}`);
  // Unverified agency: a draft it can't publish yet.
  await draft("kochi", "kc1", "joby", istAt(NOW, 4, "06:00"), ["kochi", "thrissur", "palakkad", "coimbatore"], 2500, { perKmPaise: 2600, perKgPaise: 150, handlingFeeRupees: 100 }, plus(NOW, -DAY));

  // ── Bookings on future trips in every pre-pickup status ─────────────────────
  // Indexes into `future`: 0 Kovai CBE→Salem (murugan), 1 Kovai CBE→Kochi (ravi, demo driver),
  // 3 Kovai Salem→Madurai, 12 Chennai MAA→BLR (imran).
  const [f1, f2, f4, f8] = [trips[0]!, trips[1]!, trips[3]!, trips[12]!];
  const shipDate = (t: TripDoc, district: string) => istDate(t.checkpoints.find((c) => c.districtId === district)!.expectedDepartureAt!);
  // awaiting_agency
  await request("priya", await shipment("priya", "coimbatore", "salem", 200, shipDate(f1, "coimbatore"), plus(NOW, -40 * MIN), { goods: "furniture", description: "Teak chairs", handling: ["fragile"] }), f1, plus(NOW, -30 * MIN));
  // pending_payment (window open)
  {
    const b = await request("karthik", await shipment("karthik", "tiruppur", "salem", 300, shipDate(f1, "tiruppur"), plus(NOW, -3 * HOUR), { goods: "textiles", description: "Bedsheet bundles" }), f1, plus(NOW, -2 * HOUR));
    await accept("kovai", b, plus(NOW, -10 * MIN));
  }
  // payment_failed
  {
    const b = await request("fathima", await shipment("fathima", "chennai", "bengaluru-urban", 250, shipDate(f8, "chennai"), plus(NOW, -4 * HOUR), { goods: "electronics", description: "Laptop cartons", handling: ["fragile"] }), f8, plus(NOW, -3 * HOUR));
    await accept("chennai", b, plus(NOW, -60 * MIN));
    await pay("fathima", b, plus(NOW, -50 * MIN), "failure");
  }
  // confirmed (×2)
  await booked("chennai", "suresh", f8, "kanchipuram", "bengaluru-urban", 400, plus(NOW, -20 * HOUR), { goods: "industrial", description: "Silk saree consignment", handling: ["keep_dry"] });
  await booked("kovai", "fathima", f2, "palakkad", "ernakulam", 220, plus(NOW, -18 * HOUR), { goods: "agriculture", description: "Rice bags" });
  // Demo customer on the demo driver's next trip (a second CONFIRMED pickup for the driver app).
  await booked("kovai", "priya", f2, "coimbatore", "palakkad", 120, plus(NOW, -16 * HOUR), { goods: "textiles", description: "Handloom saree boxes", handling: ["keep_dry"], receiver: ["Palakkad Silks", "9876505005"] });
  // rejected
  {
    const b = await request("priya", await shipment("priya", "coimbatore", "ernakulam", 500, shipDate(f2, "coimbatore"), plus(NOW, -6 * HOUR), { goods: "construction", description: "Tile boxes" }), f2, plus(NOW, -5 * HOUR));
    await bookings.reject(ctx(ownerSession("kovai"), plus(NOW, -4 * HOUR)), b.id, "Tiles exceed our per-package weight limit on this trip.");
  }
  // cancelled with a dev refund
  {
    const b = await booked("kovai", "karthik", f4, "salem", "madurai", 180, plus(NOW, -DAY), { goods: "general_goods", description: "Kitchenware cartons" });
    await bookings.cancelByCustomer(ctx(customerSessions.get("karthik")!, plus(NOW, -6 * HOUR)), b.id, "Found a closer pickup option.");
  }
  // An open shipment that isn't booked yet.
  await shipment("suresh", "coimbatore", "madurai", 350, istDate(istAt(NOW, 3, "06:00")), plus(NOW, -2 * HOUR), { goods: "agriculture", description: "Coconut sacks" });

  // ── Post-commit work (refund jobs) ─────────────────────────────────────────
  await flushAfterTasks();
  await runDueJobs(NOW);
  queueAfterTasks(false);

  const counts: Record<string, number> = {};
  for (const col of [C.users, C.agencies, C.drivers, C.vehicles, C.customers, C.trips, C.shipments, C.bookings, C.payments, C.reviews, C.earnings, C.settlements, C.notifications, C.files, C.jobs]) counts[col] = await store.count(col, {});
  const all = await store.query<BookingDoc>(C.bookings, {});
  for (const b of all) counts[`booking:${b.status}`] = (counts[`booking:${b.status}`] ?? 0) + 1;
  return { accounts, counts };
}
