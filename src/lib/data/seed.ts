/**
 * Demo seed data (data-contract.md §11). All dates are relative to `now`, so the
 * demo never shows stale dates. Prices are never stored by hand: every booking's
 * pricing comes from quote() with the route's rates, reproducing the board
 * numbers (Raj ₹4,850 · Sree ₹5,200 · Kavin ₹5,450 · preview ₹6,226 …).
 */
import { SEED_VERSION } from "@/lib/domain/constants";
import { addDaysIso, firstOfMonth, istInstantMs, isoDateFromInstant, monthKey, shiftMonth, timeOfDayFromInstant, todayIst } from "@/lib/domain/dates";
import type { Db } from "@/lib/domain/db";
import { estimateDurationMins, quote } from "@/lib/domain/pricing";
import { routePath } from "@/lib/domain/search";
import type {
  ArchivedEarningsMonth,
  Booking,
  BookingStatus,
  BookingStatusEvent,
  CityId,
  Customer,
  Driver,
  EarningEntry,
  IsoDate,
  Notification,
  Payment,
  Payout,
  Route,
  UserAccount,
  Vehicle,
  VehicleModelId,
} from "@/lib/domain/types";
import { getVehicleModel } from "@/lib/domain/vehicles";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Demo accounts (password "Taki@2025", salted SHA-256 — demo only). */
export const DEMO_ACCOUNTS = {
  customer: { mobile: "+919876543210", name: "Arjun Kumar" },
  driver: { mobile: "+919876543211", name: "Ravi Kumar", business: "Raj Transport" },
} as const;

export function buildSeed(nowInput: Date | number = Date.now()): Db {
  const now = typeof nowInput === "number" ? nowInput : nowInput.getTime();
  const T = todayIst(now);
  const D = (n: number): IsoDate => addDaysIso(T, n);
  const at = (date: IsoDate, time: string) => istInstantMs(date, time);
  const past = (ms: number) => Math.min(ms, now - MIN);
  const isoMs = (ms: number) => new Date(ms).toISOString();
  const monthStart = firstOfMonth(T);
  const clampMonth = (d: IsoDate) => (d < monthStart ? monthStart : d);
  const created = isoMs(now - 120 * 24 * HOUR);

  // ── Customers ──
  const customerRows: Array<[string, string, string]> = [
    ["cus_arjun", "Arjun Kumar", DEMO_ACCOUNTS.customer.mobile],
    ["cus_meera", "Meera Sundaram", "+919000000001"],
    ["cus_karthik", "Karthik Raman", "+919000000002"],
    ["cus_senthil", "Senthil Prakash", "+919000000003"],
    ["cus_divya", "Divya Mohan", "+919000000004"],
    ["cus_lakshmi", "Lakshmi Venkat", "+919000000005"],
    ["cus_priya", "Priya Natarajan", "+919000000006"],
    ["cus_anand", "Anand Rao", "+919000000007"],
    ["cus_gopal", "Gopal Ramesh", "+919000000008"],
    ["cus_fathima", "Fathima Begum", "+919000000009"],
    ["cus_suresh", "Suresh Varma", "+919000000010"],
    ["cus_kalpana", "Kalpana Devi", "+919000000011"],
    ["cus_imran", "Imran Shaikh", "+919000000012"],
  ];
  const customers: Record<string, Customer> = {};
  for (const [id, fullName, mobile] of customerRows) customers[id] = { id, fullName, mobile, createdAt: created };

  // ── Drivers ──
  const driverRows: Array<[string, string, string, string, number, number]> = [
    ["drv_ravi", "Ravi Kumar", "Raj Transport", DEMO_ACCOUNTS.driver.mobile, 4.8, 124],
    ["drv_sree", "Sridhar M.", "Sree Travels", "+919000000021", 4.9, 208],
    ["drv_kavin", "Kavin R.", "Kavin Logistics", "+919000000022", 4.7, 89],
    ["drv_murugan", "Murugan S.", "Murugan Carriers", "+919000000023", 4.6, 41],
    ["drv_velan", "Velan P.", "Velan Roadways", "+919000000024", 4.5, 63],
    ["drv_selvam", "Selvam K.", "Selvam Logistics", "+919000000025", 4.4, 37],
  ];
  const drivers: Record<string, Driver> = {};
  for (const [id, fullName, businessName, mobile, ratingAvg, ratingCount] of driverRows) {
    drivers[id] = {
      id,
      fullName,
      businessName,
      mobile,
      isVerified: true,
      ratingAvg,
      ratingCount,
      defaultRatePerKmPaise: 1200,
      defaultRatePerKgPaise: 50,
      createdAt: created,
      ...(id === "drv_ravi" ? { payoutAccount: { bankName: "HDFC Bank", accountLast4: "4321" } } : {}),
    };
  }

  // ── Accounts (only the two demo logins) ──
  const accounts: Record<string, UserAccount> = {
    usr_arjun: {
      id: "usr_arjun",
      role: "customer",
      mobile: DEMO_ACCOUNTS.customer.mobile,
      profileId: "cus_arjun",
      passwordSalt: "demo-salt-arjun",
      passwordHash: "7130f294f967d3c55f1044de7ee30be2fb86d0613805e1e89b654a9c20ac56b3",
      failedLoginCount: 0,
      createdAt: created,
    },
    usr_ravi: {
      id: "usr_ravi",
      role: "driver",
      mobile: DEMO_ACCOUNTS.driver.mobile,
      profileId: "drv_ravi",
      passwordSalt: "demo-salt-ravi",
      passwordHash: "3515158178bcd5a1a8bf9ad4fb02cdf4954ef1784238413a12909e046205f850",
      failedLoginCount: 0,
      createdAt: created,
    },
  };

  // ── Vehicles ──
  const vehicleRows: Array<[string, string, VehicleModelId, string, Vehicle["capacity"]["bodyType"]]> = [
    ["veh_raj", "drv_ravi", "tata_407", "TN 37 XX 4587", "tarpaulin"],
    ["veh_raj2", "drv_ravi", "tata_407", "TN 37 BZ 1190", "tarpaulin"],
    ["veh_sree", "drv_sree", "eicher_pro", "TN 38 BK 2211", "closed"],
    ["veh_kavin", "drv_kavin", "ashok_leyland_ecomet", "TN 66 AL 9034", "tarpaulin"],
    ["veh_murugan", "drv_murugan", "mahindra_bolero_pickup", "TN 37 CQ 7712", "open"],
    ["veh_velan", "drv_velan", "tata_407", "TN 33 BV 5520", "tarpaulin"],
    ["veh_selvam", "drv_selvam", "eicher_pro", "TN 30 AZ 1180", "closed"],
  ];
  const vehicles: Record<string, Vehicle> = {};
  for (const [id, driverId, modelId, registrationNumber, bodyType] of vehicleRows) {
    const m = getVehicleModel(modelId)!;
    vehicles[id] = { id, driverId, modelId, registrationNumber, capacity: { maxPayloadKg: m.maxPayloadKg, bodyType }, imageKey: m.imageKey };
  }

  // ── Tracking booking timestamps (offsets from now, never in the future) ──
  const t523 = {
    paid: now - 15 * HOUR - 20 * MIN,
    confirmed: now - 4 * HOUR - 48 * MIN,
    pickedUp: now - 2 * HOUR - 30 * MIN,
    inTransit: now - 2 * HOUR - 15 * MIN,
    outForDelivery: now + 5 * HOUR,
  };

  // ── Routes ──
  type Stop = [CityId, number];
  const mkRoute = (
    id: string,
    driverId: string,
    vehicleId: string,
    origin: CityId,
    stops: Stop[],
    dest: CityId,
    distanceKm: number,
    travelDate: IsoDate,
    departureTime: string,
    kmRate: number,
    kgRate: number,
    total: number,
    offered: number,
    status: Route["status"],
  ): Route => ({
    id,
    driverId,
    vehicleId,
    originCityId: origin,
    destinationCityId: dest,
    stops: stops.map(([cityId, kmFromOrigin]) => ({ cityId, kmFromOrigin })),
    distanceKm,
    durationMins: estimateDurationMins(distanceKm),
    travelDate,
    departureTime,
    ratePerKmPaise: kmRate,
    ratePerKgPaise: kgRate,
    totalCapacityKg: total,
    offeredCapacityKg: offered,
    availableCapacityKg: offered,
    status,
    createdAt: isoMs(now - 7 * 24 * HOUR),
    publishedAt: isoMs(now - 7 * 24 * HOUR),
    ...(status === "completed" ? { completedAt: isoMs(past(at(travelDate, "21:00"))) } : {}),
  });
  const CSVC: Stop[] = [["salem", 165], ["vellore", 370]];
  const h1Date = clampMonth(D(-3));
  const h2Date = clampMonth(D(-6));
  const routeList: Route[] = [
    mkRoute("rte_r0", "drv_ravi", "veh_raj2", "coimbatore", CSVC, "chennai", 498, isoDateFromInstant(t523.pickedUp), timeOfDayFromInstant(t523.pickedUp), 750, 153, 3000, 3000, "published"),
    mkRoute("rte_r1", "drv_ravi", "veh_raj", "coimbatore", CSVC, "chennai", 498, D(1), "08:00", 750, 153, 3000, 3000, "published"),
    mkRoute("rte_r2", "drv_ravi", "veh_raj", "chennai", [["vellore", 128], ["salem", 333]], "coimbatore", 498, D(2), "06:00", 600, 100, 3000, 3000, "published"),
    mkRoute("rte_s1", "drv_sree", "veh_sree", "coimbatore", [["tiruppur", 52], ["salem", 168], ["vellore", 372]], "chennai", 500, D(1), "07:00", 850, 120, 5000, 1500, "published"),
    mkRoute("rte_k1", "drv_kavin", "veh_kavin", "coimbatore", [["erode", 102], ["salem", 167], ["kanchipuram", 447]], "chennai", 520, D(1), "21:30", 875, 110, 7000, 3000, "published"),
    mkRoute("rte_m1", "drv_murugan", "veh_murugan", "coimbatore", [["salem", 165]], "chennai", 498, D(1), "09:00", 900, 100, 1500, 400, "published"),
    mkRoute("rte_v1", "drv_velan", "veh_velan", "coimbatore", [["salem", 165]], "chennai", 498, D(3), "08:00", 800, 100, 3000, 2500, "published"),
    mkRoute("rte_sl1", "drv_selvam", "veh_selvam", "coimbatore", [], "bengaluru", 365, D(1), "10:00", 900, 100, 5000, 2000, "published"),
    mkRoute("rte_h1", "drv_ravi", "veh_raj", "coimbatore", CSVC, "chennai", 498, h1Date, "08:00", 1200, 50, 3000, 3000, "completed"),
    mkRoute("rte_h2", "drv_ravi", "veh_raj", "chennai", [["vellore", 128], ["salem", 333]], "coimbatore", 498, h2Date, "06:00", 1200, 50, 3000, 3000, "completed"),
  ];
  const routes: Record<string, Route> = {};
  for (const r of routeList) routes[r.id] = r;

  // ── Bookings ──
  const bookings: Record<string, Booking> = {};
  const payments: Record<string, Payment> = {};
  const earnings: Record<string, EarningEntry> = {};

  const mkBooking = (
    id: string,
    customerId: string,
    routeId: string,
    src: CityId,
    dst: CityId,
    kg: number,
    timeline: Array<[BookingStatus, number, BookingStatusEvent["by"]]>,
    extra: Partial<Booking> = {},
  ) => {
    const route = routes[routeId]!;
    const path = routePath(route);
    const km = path.find((p) => p.cityId === dst)!.km - path.find((p) => p.cityId === src)!.km;
    const pricing = quote({ distanceKm: km, weightKg: kg, ratePerKmPaise: route.ratePerKmPaise, ratePerKgPaise: route.ratePerKgPaise });
    const firstMs = past(timeline[0]![1]);
    const history: BookingStatusEvent[] = [
      { status: "draft", at: isoMs(firstMs), by: "customer" },
      { status: "pending_payment", at: isoMs(firstMs), by: "customer" },
      ...timeline.map(([status, ms, by]) => ({ status, at: isoMs(past(ms)), by, ...(status === "awaiting_driver" ? { note: "Demo payment" } : {}) })),
    ];
    const last = history[history.length - 1]!;
    bookings[id] = {
      id,
      customerId,
      driverId: route.driverId,
      routeId,
      vehicleId: route.vehicleId,
      shipment: { sourceCityId: src, destinationCityId: dst, weightKg: kg, pickupDate: route.travelDate, cargoType: "general_goods" },
      pricing,
      status: last.status,
      statusHistory: history,
      createdAt: isoMs(firstMs),
      updatedAt: last.at,
      ...extra,
    };
    const paidAt = history.find((e) => e.status === "awaiting_driver")!.at;
    const pid = `pay_${id.toLowerCase()}`;
    payments[pid] = {
      id: pid,
      bookingId: id,
      customerId,
      amount: pricing.totalPayable,
      method: "upi",
      status: "succeeded",
      mode: "demo",
      idempotencyKey: `seed_${id}`,
      methodLabel: "UPI",
      createdAt: paidAt,
      completedAt: paidAt,
    };
    if (last.status === "delivered") {
      const eid = `ern_${id.toLowerCase()}`;
      earnings[eid] = {
        id: eid,
        driverId: route.driverId,
        bookingId: id,
        routeId,
        sourceCityId: src,
        destinationCityId: dst,
        amount: pricing.transportationCharge,
        status: "paid",
        creditedAt: last.at,
      };
    }
  };

  // In transit (tracking screen)
  mkBooking("TAKI874523", "cus_arjun", "rte_r0", "coimbatore", "chennai", 500, [
    ["awaiting_driver", t523.paid, "system"],
    ["confirmed", t523.confirmed, "driver"],
    ["picked_up", t523.pickedUp, "driver"],
    ["in_transit", t523.inTransit, "driver"],
  ], { expectedOutForDeliveryAt: isoMs(t523.outForDelivery) });

  // Accepted on upcoming routes
  const confirmedAt = (h: string) => at(D(-1), h);
  const placedAt = (h: string) => at(D(-2), h);
  mkBooking("TAKI874611", "cus_lakshmi", "rte_r1", "coimbatore", "chennai", 600, [["awaiting_driver", placedAt("10:15"), "system"], ["confirmed", confirmedAt("09:30"), "driver"]]);
  mkBooking("TAKI874608", "cus_priya", "rte_r1", "coimbatore", "vellore", 400, [["awaiting_driver", placedAt("09:40"), "system"], ["confirmed", confirmedAt("09:20"), "driver"]]);
  mkBooking("TAKI874604", "cus_anand", "rte_r2", "chennai", "coimbatore", 1000, [["awaiting_driver", placedAt("08:50"), "system"], ["confirmed", confirmedAt("09:10"), "driver"]]);

  // Pending requests (created yesterday, oldest → newest by id)
  const req = (h: string) => at(D(-1), h);
  mkBooking("TAKI874622", "cus_divya", "rte_r2", "vellore", "coimbatore", 800, [["awaiting_driver", req("10:05"), "system"]]);
  mkBooking("TAKI874627", "cus_senthil", "rte_r2", "chennai", "salem", 450, [["awaiting_driver", req("11:20"), "system"]]);
  mkBooking("TAKI874631", "cus_karthik", "rte_r1", "coimbatore", "vellore", 1200, [["awaiting_driver", req("13:40"), "system"]]);
  mkBooking("TAKI874636", "cus_meera", "rte_r1", "salem", "chennai", 1000, [["awaiting_driver", req("16:15"), "system"]]);
  mkBooking("TAKI874640", "cus_arjun", "rte_r1", "coimbatore", "chennai", 300, [["awaiting_driver", req("18:30"), "system"]]);

  // Delivered history (credited this month)
  const hist = (date: IsoDate, delivered: string, customerId: string, id: string, routeId: string, src: CityId, dst: CityId, kg: number) => {
    const dMs = at(date, delivered);
    mkBooking(id, customerId, routeId, src, dst, kg, [
      ["awaiting_driver", at(addDaysIso(date, -2), "11:00"), "system"],
      ["confirmed", at(addDaysIso(date, -1), "10:00"), "driver"],
      ["picked_up", at(date, routes[routeId]!.departureTime), "driver"],
      ["in_transit", at(date, routes[routeId]!.departureTime) + 15 * MIN, "driver"],
      ["out_for_delivery", dMs - HOUR, "driver"],
      ["delivered", dMs, "driver"],
    ]);
  };
  hist(h1Date, "20:05", "cus_arjun", "TAKI874391", "rte_h1", "coimbatore", "chennai", 500);
  hist(h1Date, "19:10", "cus_gopal", "TAKI874394", "rte_h1", "salem", "chennai", 600);
  hist(h1Date, "19:35", "cus_fathima", "TAKI874397", "rte_h1", "vellore", "chennai", 1260);
  hist(h2Date, "15:40", "cus_suresh", "TAKI874362", "rte_h2", "chennai", "coimbatore", 800);
  hist(h2Date, "12:10", "cus_kalpana", "TAKI874365", "rte_h2", "chennai", "salem", 1000);
  hist(h2Date, "15:05", "cus_imran", "TAKI874368", "rte_h2", "vellore", "coimbatore", 1000);

  // Capacity invariant: available = offered − Σ capacity-consuming bookings.
  for (const r of Object.values(routes)) {
    const used = Object.values(bookings)
      .filter((b) => b.routeId === r.id && ["confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"].includes(b.status))
      .reduce((s, b) => s + b.shipment.weightKg, 0);
    routes[r.id] = { ...r, availableCapacityKg: r.offeredCapacityKg - used };
  }

  // ── Earnings archive & payouts (drv_ravi) ──
  const M = monthKey(now);
  const archivedMonths: ArchivedEarningsMonth[] = [
    { driverId: "drv_ravi", month: shiftMonth(M, -1), amount: 25_400, deliveries: 18, completedRoutes: 3 },
    { driverId: "drv_ravi", month: shiftMonth(M, -2), amount: 30_100, deliveries: 24, completedRoutes: 3 },
    { driverId: "drv_ravi", month: shiftMonth(M, -3), amount: 34_800, deliveries: 27, completedRoutes: 4 },
    { driverId: "drv_ravi", month: shiftMonth(M, -4), amount: 36_200, deliveries: 26, completedRoutes: 3 },
    { driverId: "drv_ravi", month: shiftMonth(M, -5), amount: 31_200, deliveries: 23, completedRoutes: 3 },
  ];
  const payouts: Record<string, Payout> = {};
  const payoutRows: Array<[number, number]> = [
    [-4, 31_200],
    [-3, 36_200],
    [-2, 34_800],
    [-1, 30_100],
    [0, 25_400],
  ];
  for (const [delta, amount] of payoutRows) {
    const ms = past(at(`${shiftMonth(M, delta)}-01`, "10:00"));
    const id = `pyo_seed_${delta + 4}`;
    payouts[id] = {
      id,
      driverId: "drv_ravi",
      amount,
      status: "completed",
      mode: "demo",
      idempotencyKey: `seed_${id}`,
      destinationLabel: "HDFC Bank ••••4321",
      requestedAt: isoMs(ms),
      completedAt: isoMs(ms),
    };
  }

  // ── Notifications ──
  const notifications: Record<string, Notification> = {};
  const addNote = (id: string, n: Omit<Notification, "id">) => (notifications[id] = { id, ...n });
  addNote("ntf_seed_1", {
    recipientRole: "customer",
    recipientId: "cus_arjun",
    kind: "booking_status_changed",
    title: "Your shipment TAKI874523 is in transit",
    body: "On the way to Chennai.",
    bookingId: "TAKI874523",
    createdAt: isoMs(t523.inTransit),
  });
  addNote("ntf_seed_2", {
    recipientRole: "customer",
    recipientId: "cus_arjun",
    kind: "booking_status_changed",
    title: "Ravi (Raj Transport) picked up TAKI874523",
    body: "Coimbatore → Chennai",
    bookingId: "TAKI874523",
    createdAt: isoMs(t523.pickedUp),
    readAt: isoMs(t523.inTransit),
  });
  addNote("ntf_seed_3", {
    recipientRole: "driver",
    recipientId: "drv_ravi",
    kind: "booking_requested",
    title: "New booking request from Arjun K.",
    body: "Coimbatore → Chennai · 300 kg",
    bookingId: "TAKI874640",
    createdAt: isoMs(past(req("18:30"))),
  });
  addNote("ntf_seed_4", {
    recipientRole: "driver",
    recipientId: "drv_ravi",
    kind: "booking_requested",
    title: "New booking request from Meera S.",
    body: "Salem → Chennai · 1,000 kg",
    bookingId: "TAKI874636",
    createdAt: isoMs(past(req("16:15"))),
  });
  addNote("ntf_seed_5", {
    recipientRole: "driver",
    recipientId: "drv_ravi",
    kind: "payout_completed",
    title: "₹25,400 payout completed (demo)",
    body: "HDFC Bank ••••4321",
    createdAt: payouts["pyo_seed_4"]!.requestedAt,
    readAt: payouts["pyo_seed_4"]!.requestedAt,
  });

  return {
    accounts,
    customers,
    drivers,
    vehicles,
    routes,
    bookings,
    payments,
    earnings,
    archivedMonths,
    payouts,
    notifications,
    demoMeta: { seedVersion: SEED_VERSION, seededOn: T },
  };
}
