/**
 * T1 e2e fixtures, built on an EMPTY database through the real FastAPI (v3) and the Firebase Auth emulator.
 *
 * - Phone OTP: Identity Toolkit `accounts:sendVerificationCode` → code from the emulator's
 *   `/emulator/v1/projects/demo-taki/verificationCodes` → `accounts:signInWithPhoneNumber` (phone-proof ID token).
 * - Sessions: `POST /api/v1/auth/login` → custom token → `accounts:signInWithCustomToken` → Bearer ID token.
 * - Admin: created once per run by `backend/scripts/create_admin.py --force` (global setup).
 *
 * Never wipes the emulators (other testers share them). Every account uses a fresh +9170010xxxxx number.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

export const API = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:8010";
export const AUTH_EMU = process.env.E2E_AUTH_EMULATOR ?? "http://127.0.0.1:9099";
const PROJECT = "demo-taki";
const KEY = "demo-api-key";
const IDT = `${AUTH_EMU}/identitytoolkit.googleapis.com/v1`;

export const PASSWORD = "Taki2026pass";
export const ADMIN_PHONE = process.env.E2E_ADMIN_PHONE ?? "7001099901";
export const ADMIN_PASSWORD = "Admin2026pass";

/** 1×1 PNG (valid magic bytes for photo/document uploads). */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, where: string) {
    super(`${where} → ${status} ${JSON.stringify(body).slice(0, 400)}`);
  }
}

/** A fresh, unique 10-digit mobile in the T1 range 70010xxxxx. */
export function freshMobile(): string {
  return `70010${String(Math.floor(Math.random() * 100_000)).padStart(5, "0")}`;
}

type Init = { method?: string; token?: string; json?: unknown; form?: FormData; idem?: boolean; ok?: number[] };

export async function api<T = any>(p: string, init: Init = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.idem) headers["Idempotency-Key"] = crypto.randomUUID();
  const res = await fetch(`${API}/api/v1${p}`, {
    method: init.method ?? (init.json !== undefined || init.form ? "POST" : "GET"),
    headers,
    body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
  });
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok && !(init.ok ?? []).includes(res.status)) throw new ApiError(res.status, body, `${init.method ?? "GET/POST"} ${p}`);
  return body as T;
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

async function idt<T = any>(method: string, json: unknown): Promise<T> {
  const res = await fetch(`${IDT}/${method}?key=${KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) });
  const body = await res.json();
  if (!res.ok) throw new ApiError(res.status, body, `identitytoolkit ${method}`);
  return body as T;
}

/** Latest emulator OTP for a session (or, without sessionInfo, for a phone). */
export async function emulatorCode(opts: { sessionInfo?: string; phone?: string }): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${AUTH_EMU}/emulator/v1/projects/${PROJECT}/verificationCodes`);
    const { verificationCodes = [] } = (await res.json()) as { verificationCodes?: { phoneNumber: string; code: string; sessionInfo: string }[] };
    const hit = [...verificationCodes].reverse().find((v) => (opts.sessionInfo ? v.sessionInfo === opts.sessionInfo : v.phoneNumber === opts.phone));
    if (hit) return hit.code;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No emulator OTP for ${opts.phone ?? opts.sessionInfo}`);
}

/** Phone OTP sign-in → phone-proof ID token. `mobile` is 10 digits. */
export async function phoneProof(mobile: string): Promise<string> {
  const phoneNumber = `+91${mobile}`;
  const { sessionInfo } = await idt<{ sessionInfo: string }>("accounts:sendVerificationCode", { phoneNumber, recaptchaToken: "e2e" });
  const code = await emulatorCode({ sessionInfo });
  const r = await idt<{ idToken: string }>("accounts:signInWithPhoneNumber", { sessionInfo, code });
  return r.idToken;
}

async function exchange(customToken: string): Promise<string> {
  return (await idt<{ idToken: string }>("accounts:signInWithCustomToken", { token: customToken, returnSecureToken: true })).idToken;
}

export type Role = "customer" | "agency" | "driver" | "admin";
export type Account = { role: Role; mobile: string; password: string; uid: string; name: string; token: string; agencyId?: string };

export async function login(role: Role, mobile: string, password = PASSWORD): Promise<Account> {
  const r = await api<{ customToken: string; user: { id: string; name: string; agency?: { id: string } | null } }>("/auth/login", { json: { role, phone: mobile, password } });
  return { role, mobile, password, uid: r.user.id, name: r.user.name, token: await exchange(r.customToken), agencyId: r.user.agency?.id };
}

async function signup(role: "customer" | "agency" | "driver", details: Record<string, unknown>, mobile = freshMobile()): Promise<Account> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const proof = await phoneProof(mobile);
    try {
      const r = await api<{ customToken: string; user: { id: string; name: string; agency?: { id: string } | null } }>(`/auth/signup/${role}`, {
        token: proof,
        json: { ...details, password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true },
      });
      return { role, mobile, password: PASSWORD, uid: r.user.id, name: r.user.name, token: await exchange(r.customToken), agencyId: r.user.agency?.id };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        mobile = freshMobile();
        continue;
      }
      throw e;
    }
  }
  throw new Error("Could not find a free phone number");
}

export const signupCustomer = (name = "Ravi Kumar", mobile?: string) => signup("customer", { fullName: name, dob: "1990-05-17" }, mobile);

export const signupAgency = (agencyName = `T1 Transports ${Math.floor(Math.random() * 1e4)}`, mobile?: string) =>
  signup("agency", { ownerName: "Arun Kumar", agencyName, base: { placeId: "fake_coimbatore" }, vehicleCountRange: "1-5", statesCovered: ["TN", "KL"] }, mobile);

export const signupDriver = (name: string, opts: { inviteId?: string; agencyId?: string; mobile?: string } = {}) =>
  signup("driver", { fullName: name, inviteId: opts.inviteId ?? null, agencyId: opts.agencyId ?? null }, opts.mobile);

// ── admin ──────────────────────────────────────────────────────────────────────
let adminCache: Account | null = null;

/** Idempotent (create_admin --force reuses the same phone). Called from global setup. */
export function ensureAdmin(): void {
  const repo = path.resolve(__dirname, "../../../..");
  const py = path.join(repo, "backend", process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
  execFileSync(py, ["-m", "scripts.create_admin", "--phone", `+91${ADMIN_PHONE}`, "--name", "T1 Admin", "--force", "--password-env", "T1_ADMIN_PW"], {
    cwd: path.join(repo, "backend"),
    env: {
      ...process.env,
      T1_ADMIN_PW: ADMIN_PASSWORD,
      FIREBASE_PROJECT_ID: PROJECT,
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
      APP_ENV: "development",
    },
    stdio: "pipe",
  });
}

export async function admin(): Promise<Account> {
  adminCache ??= await login("admin", ADMIN_PHONE, ADMIN_PASSWORD);
  return adminCache;
}

function fileForm(fields: Record<string, string>, files: Record<string, [Buffer, string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const [k, [buf, name, type]] of Object.entries(files)) f.append(k, new Blob([new Uint8Array(buf)], { type }), name);
  return f;
}

export async function uploadPhoto(acct: Account) {
  return api("/me/photo", { method: "PUT", token: acct.token, form: fileForm({}, { photo: [PNG, "me.png", "image/png"] }) });
}

export async function uploadDocument(acct: Account, kind: "pan" | "aadhaar" | "driving_license", number: string, validUntil?: string) {
  const fields: Record<string, string> = { number };
  if (validUntil) fields.validUntil = validUntil;
  return api(`/me/documents/${kind}`, { method: "PUT", token: acct.token, form: fileForm(fields, { file: [PNG, `${kind}.png`, "image/png"] }) });
}

/** Agency: photo + PAN → submit → admin verifies. */
export async function verifyAgency(agency: Account, { submitOnly = false } = {}) {
  await uploadPhoto(agency);
  await uploadDocument(agency, "pan", "ABCDE1234F");
  await api("/agency/verification", { token: agency.token, json: {}, ok: [409] });
  if (!submitOnly) await api(`/admin/agencies/${agency.agencyId}/verify`, { token: (await admin()).token, json: {}, ok: [409] });
}

/** Agency invites → driver signs up with the invite → documents → admin verifies. */
export async function addDriver(agency: Account, name = "Selvam Driver", { verify = true } = {}): Promise<Account> {
  const mobile = freshMobile();
  const invite = await api<{ id: string }>("/agency/driver-invites", { token: agency.token, json: { fullName: name, phone: mobile } });
  const driver = await signupDriver(name, { inviteId: invite.id, mobile });
  await uploadPhoto(driver);
  await uploadDocument(driver, "driving_license", "TN3820190001234", "2035-01-01");
  await uploadDocument(driver, "aadhaar", "234123412346");
  if (verify) await api(`/admin/drivers/${driver.uid}/verify`, { token: (await admin()).token, json: {}, ok: [409] });
  return driver;
}

let regSeq = Math.floor(Math.random() * 9000);
export async function addVehicle(agency: Account, over: Record<string, unknown> = {}) {
  regSeq++;
  const reg = `TN${String(10 + (regSeq % 89)).padStart(2, "0")}T${String.fromCharCode(65 + (regSeq % 26))}${String(1000 + (Math.floor(Math.random() * 8999))).padStart(4, "0")}`;
  const v = await api<{ id: string; registrationNumber: string }>("/agency/vehicles", {
    token: agency.token,
    json: {
      vehicleClass: "Light Truck",
      modelId: "tata_407",
      makeModel: "Tata 407",
      registrationNumber: reg,
      maxPayloadKg: 3000,
      bodyType: "closed",
      dimensionsFt: null,
      acceptedGoods: ["general_goods", "textiles", "agriculture"],
      handlingSupported: ["fragile"],
      ...over,
    },
  });
  await api(`/agency/vehicles/${v.id}/documents/rc`, { method: "PUT", token: agency.token, form: fileForm({}, { file: [PDF, "rc.pdf", "application/pdf"] }) });
  return v;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export function checkpoints(stops: string[], start: Date, hoursPerLeg = 2, dwellMin = 15) {
  const out: Record<string, unknown>[] = [];
  let t = start.getTime();
  stops.forEach((placeId, i) => {
    const last = i === stops.length - 1;
    const arr = i === 0 ? null : t;
    const dep = last ? null : i === 0 ? t : t + dwellMin * 60_000;
    out.push({ placeId, serviceRadiusKm: 10, expectedArrivalAt: arr ? iso(new Date(arr)) : null, expectedDepartureAt: dep ? iso(new Date(dep)) : null });
    if (dep) t = dep + hoursPerLeg * 3_600_000;
  });
  return out;
}

export const STOPS = ["fake_coimbatore", "fake_tiruppur", "fake_erode", "fake_salem"];

/** Tomorrow 09:00 IST + `dayOffset` days (as a UTC Date). */
export function departure(dayOffset = 1, hourIst = 9): Date {
  const now = new Date(Date.now() + 5.5 * 3_600_000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, hourIst, 0));
  return new Date(d.getTime() - 5.5 * 3_600_000);
}

export function istDay(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

export async function publishTrip(agency: Account, vehicleId: string, driverId: string, opts: { stops?: string[]; start?: Date; offeredKg?: number; publish?: boolean } = {}) {
  return api<{ id: string; status: string }>("/agency/trips", {
    token: agency.token,
    json: {
      vehicleId,
      driverId,
      offeredKg: opts.offeredKg ?? 1000,
      checkpoints: checkpoints(opts.stops ?? STOPS, opts.start ?? departure(1)),
      acceptedGoods: ["general_goods", "textiles"],
      handlingSupported: [],
      maxPackageKg: null,
      goodsNotes: "No liquids",
      ratePerKmPaise: 1500,
      ratePerKgPaise: 100,
      additionalCharges: [{ label: "Loading", amountRupees: 200, basis: "per_booking" }],
      publish: opts.publish ?? true,
    },
  });
}

// ── customer side ─────────────────────────────────────────────────────────────
export function address(placeId: string, line1 = "12 Market Road") {
  return { line1, pincode: "641001", state: "TN", source: "autocomplete", placeId };
}

export async function createShipment(customer: Account, src: string, dst: string, day: string, weightKg = 200) {
  return api<{ id: string }>("/customer/shipments", {
    token: customer.token,
    json: {
      source: address(src),
      destination: address(dst, "4 Bazaar Street"),
      receiver: { name: "Meena Devi", phone: "9876543210" },
      package: { weightKg, goodsCategory: "general_goods", packageType: "box", description: "Cotton bales", pieces: 4, specialHandling: [], declaredValueRupees: 25000, prohibitedItemsDeclaration: true },
      shippingDate: day,
    },
  });
}

export async function requestBooking(customer: Account, shipmentId: string, tripId: string) {
  return api<{ id: string; status: string }>("/customer/bookings", { token: customer.token, json: { shipmentId, tripId }, idem: true });
}

export const acceptBooking = (agency: Account, bookingId: string) => api(`/agency/bookings/${bookingId}/accept`, { token: agency.token, json: {} });

/** Dev gateway: order → approve. */
export async function payBooking(customer: Account, bookingId: string) {
  const order = await api<any>("/payments/orders", { token: customer.token, json: { bookingId }, idem: true });
  const co = order.checkout ?? {};
  return api(`/payments/dev/confirm`, { token: customer.token, json: { paymentId: order.paymentId ?? order.payment?.id ?? co.paymentId, outcome: "success", devToken: co.devToken } });
}

export const customerBooking = (customer: Account, id: string) => api<any>(`/customer/bookings/${id}`, { token: customer.token });

// ── worlds ────────────────────────────────────────────────────────────────────
export type World = { agency: Account; driver: Account; vehicle: { id: string; registrationNumber: string }; trip: { id: string }; customer: Account; start: Date };

/** Verified agency + verified driver + RC'd vehicle + published Coimbatore→Salem trip + a customer. */
export async function makeWorld(opts: { start?: Date } = {}): Promise<World> {
  const agency = await signupAgency();
  await verifyAgency(agency);
  const driver = await addDriver(agency);
  const vehicle = await addVehicle(agency);
  const start = opts.start ?? departure(1);
  const trip = await publishTrip(agency, vehicle.id, driver.uid, { start });
  const customer = await signupCustomer();
  return { agency, driver, vehicle, trip, customer, start };
}

/** World + a confirmed (paid) booking Coimbatore → Erode. */
export async function makeConfirmedBooking(world?: World) {
  const w = world ?? (await makeWorld());
  const shipment = await createShipment(w.customer, "fake_coimbatore", "fake_erode", istDay(w.start));
  const booking = await requestBooking(w.customer, shipment.id, w.trip.id);
  await acceptBooking(w.agency, booking.id);
  await payBooking(w.customer, booking.id);
  return { ...w, shipmentId: shipment.id, bookingId: booking.id };
}
