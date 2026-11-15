import { expect, test } from "@playwright/test";
import { acceptAsAgency, createShipmentViaForm, dateWithOffers, loginCustomer, payWithDevGateway, requestBooking } from "./booking-flow";

/**
 * v2 payment + tracking (D3): payment only after the agency accepts, the dev gateway needs an
 * explicit Approve, tracking shows only real events (no "simulate"), OTPs are shown to the
 * customer only, 7 status tabs. Needs `npm run seed` and PAYMENT_PROVIDER=dev.
 */
test.describe("payment and tracking", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginCustomer(page, baseURL!);
  });

  test("My Shipments has the 7 status tabs with counts and keeps the tab in the URL", async ({ page }) => {
    await page.goto("/customer/shipments");
    const tabs = page.getByRole("tablist", { name: "Filter shipments by status" });
    for (const name of ["Pending", "Confirmed", "Picked Up", "In Transit", "Delivered", "Rejected", "Cancelled"]) {
      await expect(tabs.getByRole("tab", { name: new RegExp(`^${name}`) })).toBeVisible();
    }
    await tabs.getByRole("tab", { name: /^Delivered/ }).click();
    await expect(page).toHaveURL(/tab=delivered/);
  });

  test("tracking never offers a simulate control", async ({ page }) => {
    await page.goto("/customer/shipments?tab=in_transit");
    const row = page.getByTestId("shipment-row").first();
    test.skip((await row.count()) === 0, "seed has no in-transit booking for this customer");
    await row.getByRole("link").first().click();
    await page.waitForURL(/\/customer\/tracking\/TAKI\d{6}/);
    await expect(page.getByRole("list", { name: "Shipment progress" })).toBeVisible();
    await expect(page.getByRole("button", { name: /simulate/i })).toHaveCount(0);
    await expect(page.getByTestId("verification-codes")).toBeVisible();
  });

  test("request → agency accepts → decline then approve on the dev gateway → confirmed with OTPs", async ({ page, request, baseURL }, info) => {
    test.skip(info.project.name !== "desktop", "state-changing journey runs once");
    const date = await dateWithOffers(request);
    await createShipmentViaForm(page, date);
    await page.getByTestId("vehicle-card").first().getByRole("link", { name: /View details/ }).click();
    const id = await requestBooking(page);

    // Nothing to pay before acceptance.
    await page.goto(`/customer/payment?bookingId=${id}`);
    await expect(page.getByRole("heading", { name: "Waiting for the agency to accept" })).toBeVisible();

    await acceptAsAgency(request, baseURL!, id);
    await page.goto(`/customer/tracking/${id}`);
    await expect(page.getByTestId("tracking-status")).toContainText("Accepted · payment due");
    await page.getByRole("link", { name: "Pay now" }).click();
    await page.waitForURL(new RegExp(`/customer/payment\\?bookingId=${id}`));

    await payWithDevGateway(page, "decline");
    await payWithDevGateway(page, "approve");

    await page.getByRole("link", { name: "Track shipment" }).click();
    await page.waitForURL(`**/customer/tracking/${id}`);
    await expect(page.getByTestId("tracking-status")).toContainText("Confirmed");
    await expect(page.getByTestId("pickup-otp")).toHaveText(/^\d{4,6}/);
    await expect(page.getByTestId("delivery-otp")).toHaveText(/^\d{4,6}/);
    await expect(page.getByRole("region", { name: "Driver" })).not.toContainText("shared after");
    // Cancelling a paid booking is still allowed before pickup.
    await expect(page.getByRole("button", { name: "Cancel booking" })).toBeVisible();
  });

  test("delivered booking: receipt and one-time feedback", async ({ page }) => {
    await page.goto("/customer/shipments?tab=delivered");
    const row = page.getByTestId("shipment-row").first();
    test.skip((await row.count()) === 0, "seed has no delivered booking for this customer");
    await row.getByRole("link").first().click();
    await page.waitForURL(/\/customer\/tracking\/TAKI\d{6}/);
    await expect(page.getByRole("link", { name: "View receipt" })).toBeVisible();
    const feedback = page.locator("#feedback");
    await expect(feedback).toBeVisible();
    await page.getByRole("link", { name: "View receipt" }).click();
    await expect(page.getByTestId("receipt-details")).toBeVisible();
    await expect(page.getByTestId("receipt-amount")).toHaveText(/₹/);
  });
});
