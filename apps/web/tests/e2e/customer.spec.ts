/**
 * T1 — customer journey in the browser on fixtures built through the API:
 * new shipment with typed addresses (no Maps browser key → E23 server geocode fallback), offers with sort and
 * filters, transport details with line-item pricing, request booking, test payment (dev gateway), tracking,
 * cancel before pickup, review after delivery.
 */
import type { Page } from "@playwright/test";
import * as A from "../support/e2e-api";
import { expect, isMobile, loginUI, settle, test } from "../support/e2e-fixtures";

const rupees = (s: string) => Number(s.replace(/[^\d.]/g, ""));

async function fillAddress(page: Page, region: string, query: string, line1: string, pincode: string) {
  const r = page.getByRole("region", { name: region });
  await r.getByLabel("Find the address").fill(query);
  await r.getByRole("button", { name: "Find" }).click();
  await expect(r.getByLabel("Place found")).toBeVisible();
  await r.getByLabel("Full address").fill(line1);
  await r.getByLabel("State").selectOption({ label: "Tamil Nadu" });
  await r.getByLabel("Pincode").fill(pincode);
}

/** Prices on the offers list, top to bottom. */
async function offerPrices(page: Page): Promise<number[]> {
  const list = page.getByRole("list", { name: "Available vehicles" });
  await expect(list).toBeVisible();
  const texts = await list.getByRole("article").locator("p", { hasText: /^₹[\d,]+$/ }).allInnerTexts();
  return texts.map(rupees);
}

test.describe("customer", () => {
  test("new shipment (typed address, E23) → offers sort/filter → details → request booking", async ({ page }) => {
    const w = await A.makeWorld();
    const agencyName = w.agency.agencyName!;
    await loginUI(page, w.customer);

    // Dashboard CTA → new shipment form.
    await page.getByRole("region", { name: "Quick ship" }).getByRole("link", { name: "New Shipment" }).click();
    await expect(page).toHaveURL(/\/customer\/shipments\/new/);
    await expect(page.getByRole("heading", { level: 1, name: "New Shipment" })).toBeVisible();

    await fillAddress(page, "Pickup (Source)", "Coimbatore", "12 Market Road", "641001");
    await fillAddress(page, "Delivery (Destination)", "Erode", "4 Bazaar Street", "638001");
    const receiver = page.getByRole("region", { name: "Receiver" });
    await receiver.getByLabel("Receiver name").fill("Meena Devi");
    await receiver.getByLabel("Receiver phone").fill("9876543210");
    const cargo = page.getByRole("region", { name: "Cargo Details" });
    await cargo.getByLabel("Weight", { exact: true }).fill("200");
    await cargo.getByLabel("Package type").selectOption({ label: "Box / carton" });
    await cargo.getByLabel("Goods description").fill("Cotton bales, 4 cartons");
    await cargo.getByLabel("Shipping date").fill(A.istDay(w.start));
    await page.getByLabel("My shipment has no prohibited or hazardous items").check();
    await page.getByRole("button", { name: "Find Matching Vehicles" }).click();

    await expect(page).toHaveURL(/\/customer\/vehicles\?shipment=shp_/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: /Coimbatore to Erode/ })).toBeVisible();
    const myCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: new RegExp(agencyName) }) });
    await expect(myCard).toBeVisible();

    // Sort: lowest first, then highest first.
    const asc = await offerPrices(page);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    if (isMobile()) await page.getByLabel("Sort results").selectOption({ label: "Highest price" });
    else await page.getByRole("group", { name: "Sort by" }).getByText("Highest price").click();
    await expect(page.getByText(/sorted by Highest price/i)).toBeVisible();
    const desc = await offerPrices(page);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));

    // Filter: vehicle type "Pickup" hides our Light Truck; "Clear all" brings it back.
    // Desktop: filters in the left column; mobile: behind the "Filters" button (sheet).
    const openFilters = async () => {
      if (isMobile()) await page.getByRole("button", { name: /^Filters/ }).click();
    };
    const filters = page.getByRole("form", { name: "Filter vehicles" }).filter({ visible: true });
    await openFilters();
    await filters.getByText("Pickup", { exact: true }).click();
    await filters.getByRole("button", { name: "Apply" }).click();
    await expect(myCard).toHaveCount(0);
    await openFilters();
    await filters.getByRole("button", { name: "Clear all" }).click();
    if (isMobile() && (await filters.count())) await page.keyboard.press("Escape");
    await expect(myCard).toBeVisible();

    // Transport details: line items add up to the total.
    await page.getByRole("link", { name: `View details for ${agencyName}` }).click();
    await expect(page).toHaveURL(new RegExp(`/customer/booking/${w.trip.id}\\?shipment=shp_`));
    await expect(page.getByRole("heading", { level: 1, name: "Transport Details" })).toBeVisible();
    const pricing = page.getByRole("region", { name: "Pricing" });
    await expect(pricing.getByText("Loading")).toBeVisible(); // the agency's additional charge
    const amounts = (await pricing.getByRole("definition").allInnerTexts()).map(rupees);
    const total = amounts.pop()!;
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(total);

    await page.getByRole("button", { name: "Request booking" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm).toContainText(/you pay only after they accept/i);
    await confirm.getByRole("button", { name: "Send request" }).click();
    await expect(page).toHaveURL(/\/customer\/(tracking|shipments)/, { timeout: 30_000 });
    await expect(page.getByText(/waiting for the agency/i).first()).toBeVisible();
  });

  test("guest search → details → Request booking sends to login with next", async ({ page }) => {
    const w = await A.makeWorld();
    const day = A.istDay(w.start);
    await page.goto(`/customer/vehicles?from=fake_coimbatore&to=fake_erode&weight=200&date=${day}`);
    await settle(page);
    await expect(page).toHaveURL(/\/customer\/vehicles/);
    await page.getByRole("link", { name: `View details for ${w.agency.agencyName}` }).click();
    await expect(page).toHaveURL(new RegExp(`/customer/booking/${w.trip.id}`));
    await page.getByRole("link", { name: "Log in to request booking" }).click();
    // Guests log in, then continue on the new-shipment form prefilled for this trip.
    await expect(page).toHaveURL(/\/auth\/login\?role=customer&next=%2Fcustomer%2Fshipments%2Fnew/);
    expect(decodeURIComponent(page.url())).toContain(`trip=${w.trip.id}`);
    await page.getByLabel("Mobile number").fill(w.customer.mobile);
    await page.getByLabel("Password", { exact: true }).fill(w.customer.password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await expect(page).toHaveURL(/\/customer\/shipments\/new\?.*trip=/);
    await expect(page.getByRole("heading", { level: 1, name: "New Shipment" })).toBeVisible();
  });

  test("guest quick ship on the dashboard → log in → new shipment prefilled", async ({ page }) => {
    const c = await A.signupCustomer();
    await page.goto("/customer/dashboard");
    const qs = page.getByRole("form", { name: "Quick ship" });
    await qs.getByRole("textbox", { name: "Source" }).fill("Coimbatore");
    await qs.getByRole("textbox", { name: "Destination" }).fill("Erode");
    await qs.getByLabel("Cargo Weight").fill("200");
    await qs.getByRole("button", { name: /^(Continue|Find Available Vehicles)$/ }).click();
    await expect(page).toHaveURL(/\/auth\/login\?role=customer&next=%2Fcustomer%2Fshipments%2Fnew/);
    await page.getByLabel("Mobile number").fill(c.mobile);
    await page.getByLabel("Password", { exact: true }).fill(c.password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await expect(page).toHaveURL(/\/customer\/shipments\/new\?.*fromLabel=Coimbatore/);
    await expect(page.getByRole("region", { name: "Cargo Details" }).getByLabel("Weight", { exact: true })).toHaveValue("200");
  });

  test("accepted booking → Test payment (dev gateway) → confirmation → tracking codes → cancel before pickup", async ({ page }) => {
    const w = await A.makeWorld();
    const sh = await A.createShipment(w.customer, "fake_coimbatore", "fake_erode", A.istDay(w.start));
    const b = await A.requestBooking(w.customer, sh.id, w.trip.id);
    await A.acceptBooking(w.agency, b.id);
    await loginUI(page, w.customer);

    await page.goto(`/customer/tracking/${b.id}`);
    await page.getByRole("link", { name: /pay/i }).first().click();
    await expect(page).toHaveURL(new RegExp(`/customer/payment\\?bookingId=${b.id}`));
    await expect(page.getByRole("heading", { level: 1, name: "Payment" })).toBeVisible();
    const total = page.getByRole("definition").last();
    await expect(total).toHaveText(/₹/);
    await page.getByRole("button", { name: /^Pay ₹/ }).click();

    await expect(page).toHaveURL(/\/customer\/payment\/dev-gateway\?paymentId=pay_/);
    await expect(page.getByRole("heading", { level: 1, name: "Test payment" })).toBeVisible();
    await expect(page.getByText(/no money moves/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Approve payment" }).click();
    await expect(page).toHaveURL(new RegExp(`/customer/booking-confirmation\\?bookingId=${b.id}`), { timeout: 30_000 });

    await page.goto(`/customer/tracking/${b.id}`);
    const codes = page.getByTestId("verification-codes");
    await expect(codes).toBeVisible();
    const otps = (await A.customerBooking(w.customer, b.id)).otps;
    await expect(codes).toContainText(otps.pickup);

    await page.getByRole("button", { name: "Cancel booking" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel this booking?" });
    await expect(dialog).toContainText(/refunded/);
    await dialog.getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByText(/cancelled/i).first()).toBeVisible({ timeout: 20_000 });
    const after = await A.customerBooking(w.customer, b.id);
    expect(after.status).toMatch(/cancelled/);
    expect(after.state.paymentStatus).toMatch(/refund/);

    // Payment history lists the payment.
    await page.goto("/customer/payments");
    await expect(page.getByText(b.id).filter({ visible: true }).first()).toBeVisible();
  });

  test("declined test payment → retry page", async ({ page }) => {
    const w = await A.makeWorld();
    const sh = await A.createShipment(w.customer, "fake_coimbatore", "fake_tiruppur", A.istDay(w.start));
    const b = await A.requestBooking(w.customer, sh.id, w.trip.id);
    await A.acceptBooking(w.agency, b.id);
    await loginUI(page, w.customer);
    await page.goto(`/customer/payment?bookingId=${b.id}`);
    await page.getByRole("button", { name: /^Pay ₹/ }).click();
    await page.getByRole("button", { name: "Decline" }).click();
    await expect(page).toHaveURL(new RegExp(`/customer/payment\\?bookingId=${b.id}.*failed=1`), { timeout: 30_000 });
    await expect(page.getByRole("button", { name: /^Pay ₹|try again/i }).first()).toBeVisible();
  });

  test("delivered booking: tracking timeline, receipt and review", async ({ page }) => {
    const w = await A.makeWorld({ start: A.soonDeparture(90) });
    const { bookingId } = await A.makeConfirmedBooking(w);
    await A.driveToDelivered(w, bookingId);
    await loginUI(page, w.customer);

    await page.goto("/customer/shipments?tab=delivered");
    await page.getByRole("link", { name: new RegExp(`booking ${bookingId}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/customer/tracking/${bookingId}`));
    await expect(page.getByText(/delivered/i).first()).toBeVisible();

    const feedback = page.locator("#feedback");
    await expect(feedback).toContainText("How was your delivery?");
    await feedback.getByText("5 stars").click({ force: true });
    await feedback.getByLabel("Comment (optional)").fill("On time, careful handling.");
    await feedback.getByRole("button", { name: "Submit feedback" }).click();
    await expect(feedback).toContainText(/thank|your review|on time/i);
    const d = await A.customerBooking(w.customer, bookingId);
    expect(d.review?.rating).toBe(5);

    await page.getByRole("link", { name: /receipt/i }).first().click();
    await expect(page).toHaveURL(new RegExp(`/customer/receipt/${bookingId}`));
    await expect(page.getByText(/TAKI service fee/).first()).toBeVisible();
  });
});
