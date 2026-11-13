import { expect, test, type Page } from "@playwright/test";
import { CUSTOMER_PHONE, PASSWORD, ROUTE, acceptAsAgency, createShipmentViaForm, dateWithOffers, loginCustomer, payWithDevGateway, requestBooking } from "./booking-flow";

/**
 * v2 customer journey (D3): login → dashboard (stats + quick ship + activity) → New Shipment →
 * Find Vehicles → Vehicle details → Request → agency accepts → pay (dev gateway, explicit Approve)
 * → confirmed → tracking. Plus: guest resume through login, ownership, navigation and 360px layout.
 * Needs `npm run seed` and PAYMENT_PROVIDER=dev. Auth form edge cases live in auth.spec.ts (D1).
 */

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("customer journey — happy path", () => {
  test("login → new shipment → request → accept → pay → confirmed → track", async ({ page, request, baseURL }, info) => {
    test.skip(info.project.name !== "desktop", "state-changing journey runs once");
    const date = await dateWithOffers(request);

    await page.goto("/auth/login?role=customer");
    await page.getByLabel(/Mobile number/).fill(CUSTOMER_PHONE);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole("button", { name: /^Log in/ }).click();
    await page.waitForURL(/\/customer\/dashboard/);
    await expect(page.getByRole("heading", { level: 1, name: /^Hi, / })).toBeVisible();
    for (const label of ["Active shipments", "Completed", "Pending bookings"]) await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();

    await createShipmentViaForm(page, date);
    await page.getByTestId("vehicle-card").first().getByRole("link", { name: /View details/ }).click();
    const id = await requestBooking(page);
    await expect(page.getByRole("list", { name: "Shipment progress" })).toContainText("Booking requested");
    await expect(page.getByRole("region", { name: "Driver" })).toContainText("shared after");

    await acceptAsAgency(request, baseURL!, id);
    await page.reload();
    await expect(page.getByTestId("tracking-status")).toContainText("Accepted · payment due");
    await page.getByRole("link", { name: "Pay now" }).click();
    await payWithDevGateway(page);
    await expect(page.getByTestId("booking-status")).toContainText("Confirmed");
    await page.getByRole("link", { name: "Track shipment" }).click();
    await expect(page.getByTestId("verification-codes")).toBeVisible();

    // Shows under Confirmed, with the payment in the history.
    await page.goto("/customer/shipments?tab=confirmed");
    await expect(page.getByTestId("shipment-row").filter({ hasText: id })).toBeVisible();
    await page.goto("/customer/payments");
    await expect(page.locator(`[data-booking-id="${id}"]`).filter({ visible: true }).first()).toContainText("Paid");
  });
});

test.describe("customer journey — guest resume and access", () => {
  test("guest vehicle → Log in to request → New Shipment carries the vehicle", async ({ page, request }) => {
    const date = await dateWithOffers(request);
    await page.goto(`/customer/vehicles?from=${ROUTE.from}&to=${ROUTE.to}&weight=${ROUTE.weightKg}&date=${date}`);
    await page.getByTestId("vehicle-card").first().getByRole("link", { name: /View details/ }).click();
    const tripId = new URL(page.url()).pathname.split("/").pop()!;
    await page.getByRole("link", { name: "Log in to request booking" }).filter({ visible: true }).first().click();
    await page.waitForURL(/\/auth\/login/);
    await page.getByLabel(/Mobile number/).fill(CUSTOMER_PHONE);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole("button", { name: /^Log in/ }).click();
    await page.waitForURL(new RegExp(`/customer/shipments/new\\?.*trip=${tripId}`));
    await expect(page.getByRole("button", { name: "Save and continue" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Pickup (Source)" }).getByLabel("District")).toHaveValue(ROUTE.from);
  });

  test("protected customer pages send guests to login with next", async ({ page }) => {
    await page.goto("/customer/shipments?tab=delivered");
    await page.waitForURL(/\/auth\/login\?.*next=/);
    expect(decodeURIComponent(page.url())).toContain("/customer/shipments?tab=delivered");
  });

  test("unknown or someone else's booking id → not found, never another customer's data", async ({ page, baseURL }) => {
    await loginCustomer(page, baseURL!);
    for (const path of ["/customer/tracking/TAKI000000", "/customer/payment?bookingId=TAKI000000", "/customer/receipt/TAKI000000"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: /not found|not ready/i })).toBeVisible();
    }
    const res = await page.request.get("/api/customer/bookings/TAKI000000");
    expect(res.status()).toBe(404);
  });
});

test.describe("customer journey — navigation and layout", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginCustomer(page, baseURL!);
  });

  test("sidebar items reach real pages without console errors or horizontal scroll", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    for (const [path, heading] of [
      ["/customer/dashboard", /^Hi, /],
      ["/customer/shipments/new", "New Shipment"],
      ["/customer/shipments", "My Shipments"],
      ["/customer/profile", "Profile"],
      ["/customer/payments", "Payments"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await noHorizontalScroll(page);
    }
    expect(errors).toEqual([]);
  });

  test("profile uses the shared account cards; no demo copy", async ({ page }) => {
    await page.goto("/customer/profile");
    await expect(page.getByRole("heading", { name: "Personal details" })).toBeVisible();
    await expect(page.getByLabel("Date of birth")).toHaveAttribute("readonly", "");
    await expect(page.getByRole("link", { name: /Payment history/ })).toHaveAttribute("href", "/customer/payments");
    await expect(page.getByText(/demo account/i)).toHaveCount(0);
  });

  test("customer visiting /agency or /driver is sent back to the customer area", async ({ page }) => {
    await page.goto("/agency/dashboard");
    await expect(page).toHaveURL(/\/customer\//);
  });
});
