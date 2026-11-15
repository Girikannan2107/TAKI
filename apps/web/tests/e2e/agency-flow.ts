import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { AGENCY_PHONE, apiLogin, CUSTOMER_PHONE, createShipmentViaForm, dateWithOffers, loginCustomer } from "./booking-flow";

/**
 * Shared v2 agency helpers (D2). Needs `npm run seed`: the demo agency Kovai Freight Lines
 * (9876543220, verified, Coimbatore) runs the Coimbatore→Chennai trips the customer helpers search.
 */
export const AGENCY_NAME = process.env.E2E_AGENCY_NAME ?? "Kovai Freight Lines";

export async function loginAgency(page: Page, baseURL: string): Promise<void> {
  await apiLogin(page.request, baseURL, "agency", AGENCY_PHONE);
}

/** Unique-ish suffix so state-changing specs can re-run against the same seed. */
export function runTag(): string {
  return Date.now().toString(36).slice(-4).toUpperCase();
}

/**
 * As the demo customer in a separate browser context: New Shipment (UI) → request the demo agency's
 * first matching trip (API, Idempotency-Key). Returns the new booking id (status awaiting_agency).
 */
export async function customerRequestsAgencyTrip(browser: Browser, baseURL: string): Promise<string> {
  const ctx = await browser.newContext({ baseURL });
  try {
    const page = await ctx.newPage();
    await loginCustomer(page, baseURL);
    const date = await dateWithOffers(page.request);
    const shipmentId = await createShipmentViaForm(page, date);
    return await requestOnAgencyTrip(page.request, baseURL, shipmentId);
  } finally {
    await ctx.close();
  }
}

async function requestOnAgencyTrip(request: APIRequestContext, baseURL: string, shipmentId: string): Promise<string> {
  const offers = await request.get(`/api/customer/shipments/${shipmentId}/offers`);
  expect(offers.ok(), await offers.text()).toBeTruthy();
  const body = (await offers.json()) as { items: Array<{ tripId: string; agency: { name: string } }> };
  const offer = body.items.find((o) => o.agency.name === AGENCY_NAME);
  expect(offer, `no ${AGENCY_NAME} offer for ${CUSTOMER_PHONE}'s shipment`).toBeTruthy();
  const res = await request.post("/api/customer/bookings", {
    headers: { origin: baseURL, "Idempotency-Key": `e2e_agency_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` },
    data: { shipmentId, tripId: offer!.tripId },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

/** IST "YYYY-MM-DDTHH:mm" for a datetime-local input, `hours` from now (rounded to the hour). */
export function istLocal(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000 + 330 * 60_000);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().slice(0, 16);
}
