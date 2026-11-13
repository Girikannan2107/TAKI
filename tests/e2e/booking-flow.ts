import { expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Shared v2 customer-flow helpers (D3). Needs `npm run seed` (verified Coimbatore/Chennai
 * agencies with published trips over the next 14 days, demo accounts). Override the demo
 * credentials with E2E_* env vars if the seed changes.
 */
export const PASSWORD = process.env.E2E_PASSWORD ?? "Taki@2026";
export const CUSTOMER_PHONE = process.env.E2E_CUSTOMER_PHONE ?? "9876543210";
export const AGENCY_PHONE = process.env.E2E_AGENCY_PHONE ?? "9876543220";

/** A route the seed always serves (both districts have verified agencies). */
export const ROUTE = { from: "coimbatore", to: "chennai", weightKg: 100 } as const;

/** Signs a request context in through the API (sets the httpOnly session cookie). */
export async function apiLogin(request: APIRequestContext, baseURL: string, role: "customer" | "agency", phone: string): Promise<void> {
  const res = await request.post("/api/auth/login", { headers: { origin: baseURL }, data: { role, phone, password: PASSWORD } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function loginCustomer(page: Page, baseURL: string): Promise<void> {
  await apiLogin(page.request, baseURL, "customer", CUSTOMER_PHONE);
}

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** First IST date in the next 14 days with at least one bookable trip on ROUTE (guest search API). */
export async function dateWithOffers(request: APIRequestContext, route: { from: string; to: string; weightKg: number } = ROUTE): Promise<string> {
  const today = istToday();
  for (let i = 0; i <= 14; i++) {
    const date = addDays(today, i);
    const res = await request.get(`/api/customer/search?from=${route.from}&to=${route.to}&weightKg=${route.weightKg}&date=${date}`);
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()) as { items: unknown[] };
    if (body.items.length > 0) return date;
  }
  throw new Error(`The seed has no trips ${route.from} → ${route.to} in the next 14 days`);
}

/** Fills New Shipment (signed in) for ROUTE on `date` and submits. Ends on Find Vehicles for the saved shipment. */
export async function createShipmentViaForm(page: Page, date: string, opts: { goods?: string } = {}): Promise<string> {
  await page.goto(`/customer/shipments/new?from=${ROUTE.from}&to=${ROUTE.to}&weight=${ROUTE.weightKg}&date=${date}`);
  await expect(page.getByRole("heading", { level: 1, name: "New Shipment" })).toBeVisible();
  const pickup = page.getByRole("region", { name: "Pickup (Source)" });
  await pickup.getByLabel("Full address").fill("12 Avinashi Road, Peelamedu");
  await pickup.getByLabel("Pincode").fill("641004");
  const drop = page.getByRole("region", { name: "Delivery (Destination)" });
  await drop.getByLabel("Full address").fill("45 Anna Salai, Teynampet");
  await drop.getByLabel("Pincode").fill("600018");
  await page.getByLabel("Receiver name").fill("Meena Raman");
  await page.getByLabel("Receiver phone").fill("9876501234");
  await page.getByLabel("Package type").selectOption("box");
  if (opts.goods) await page.getByLabel("Goods category").selectOption(opts.goods);
  await page.getByLabel("Goods description").fill("Cartons of packaged snacks");
  await page.getByLabel("My shipment has no prohibited or hazardous items").check();
  await page.getByRole("button", { name: "Find vehicles" }).click();
  await page.waitForURL(/\/customer\/vehicles\?shipment=shp_/);
  return new URL(page.url()).searchParams.get("shipment")!;
}

/** On vehicle details for a saved shipment: Request booking → confirm → tracking page (awaiting agency). Returns the booking id. */
export async function requestBooking(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Request booking" }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Request this vehicle?" });
  await dialog.getByRole("button", { name: "Send request" }).click();
  await page.waitForURL(/\/customer\/tracking\/TAKI\d{6}/);
  await expect(page.getByTestId("tracking-status")).toContainText("Awaiting agency approval");
  return decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
}

/** Accepts a booking as the seeded agency, through the agency API (core.bookings.accept). */
export async function acceptAsAgency(request: APIRequestContext, baseURL: string, bookingId: string): Promise<void> {
  await apiLogin(request, baseURL, "agency", AGENCY_PHONE);
  const res = await request.post(`/api/agency/bookings/${bookingId}/accept`, { headers: { origin: baseURL } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/**
 * Compatibility helper (kept for responsive-a11y.spec.ts and visual.spec.ts). On vehicle details
 * for a saved shipment, signed in as the customer: Request booking → the seeded agency accepts
 * (own API context, so the page keeps its customer session) → Pay now → payment page.
 * Returns the booking id.
 */
export async function requestAcceptAndOpenPayment(page: Page): Promise<string> {
  const baseURL = new URL(page.url()).origin;
  const id = await requestBooking(page);
  const agency = await playwrightRequest.newContext({ baseURL });
  try {
    await acceptAsAgency(agency, baseURL, id);
  } finally {
    await agency.dispose();
  }
  await page.reload();
  await expect(page.getByTestId("tracking-status")).toContainText("Accepted · payment due");
  await page.getByRole("link", { name: "Pay now" }).click();
  await page.waitForURL(/\/customer\/payment\?bookingId=TAKI\d{6}/);
  await expect(page.getByRole("heading", { level: 1, name: "Payment" })).toBeVisible();
  return id;
}

/** On the payment page: Pay → dev gateway → Approve → confirmation (server-confirmed). */
export async function payWithDevGateway(page: Page, outcome: "approve" | "decline" = "approve"): Promise<void> {
  await page.getByTestId("pay-button").click();
  await page.waitForURL(/\/customer\/payment\/dev-gateway\?paymentId=pay_/);
  await expect(page.getByText("Development gateway: no money moves.")).toBeVisible();
  if (outcome === "approve") {
    await page.getByRole("button", { name: "Approve payment" }).click();
    await page.waitForURL(/\/customer\/booking-confirmation\?bookingId=TAKI\d{6}/);
    await expect(page.getByRole("heading", { level: 1, name: "Booking confirmed!" })).toBeVisible();
  } else {
    await page.getByRole("button", { name: "Decline" }).click();
    await page.waitForURL(/\/customer\/payment\?bookingId=TAKI\d{6}&failed=1/);
    await expect(page.getByTestId("payment-error")).toContainText("didn't go through");
  }
}
