import { expect, test, type Page } from "@playwright/test";
import { acceptAsDemoDriver, requestBooking } from "./booking-flow";

/** Demo state injected before the app boots (db absent → the store seeds fresh data). */
function seedState(search: Record<string, unknown> | null) {
  const now = Date.now();
  const tomorrowIst = new Date(now + 5.5 * 3600e3 + 864e5).toISOString().slice(0, 10);
  const state: Record<string, unknown> = {
    session: {
      accountId: "usr_arjun",
      role: "customer",
      profileId: "cus_arjun",
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 864e5).toISOString(),
    },
  };
  if (search) state.search = { ...search, pickupDate: tomorrowIst };
  return JSON.stringify({ state, version: 1 });
}

async function openBooking(page: Page, search: Record<string, unknown> | null, routeId = "rte_r1") {
  await page.addInitScript((value) => {
    // Only on the first load of the test: later navigations keep the app's own state.
    if (!sessionStorage.getItem("booking-spec-seeded")) {
      localStorage.setItem("taki-demo-v1", value);
      sessionStorage.setItem("booking-spec-seeded", "1");
    }
  }, seedState(search));
  await page.goto(`/customer/booking/${routeId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Route & Booking Details" })).toBeVisible();
}

const SEARCH = { sourceCityId: "coimbatore", destinationCityId: "chennai", weightKg: 500 };

test.describe("Route & Booking Details", () => {
  test("shows provider, route, stats and the computed price", async ({ page }) => {
    await openBooking(page, SEARCH);
    await expect(page.getByRole("heading", { name: "Raj Transport" })).toBeVisible();
    await expect(page.getByText("Tata 407")).toBeVisible();
    await expect(page.getByRole("img", { name: /Illustrative route map from Coimbatore to Chennai/ })).toBeVisible();

    const stats = page.getByTestId("route-stats");
    await expect(stats).toContainText("498 km");
    await expect(stats).toContainText("~9 hr");
    await expect(stats).toContainText("3 Stops");
    await expect(page.getByTestId("route-line")).toHaveText("Route: Coimbatore → Salem → Vellore → Chennai");

    await expect(page.getByText("₹4,500", { exact: true })).toBeVisible();
    await expect(page.getByText("₹350", { exact: true })).toBeVisible();
    await expect(page.getByTestId("price-total")).toHaveText("₹4,850");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("Request Booking sends a request; payment opens only after the driver accepts", async ({ page }) => {
    await openBooking(page, SEARCH);
    await expect(page.getByRole("button", { name: "Request Booking", exact: true })).toBeEnabled();
    const id = await requestBooking(page);
    await expect(page.getByRole("link", { name: "Complete payment" })).toHaveCount(0);
    await page.goto(`/customer/payment?bookingId=${id}`);
    await expect(page.getByRole("heading", { name: "Waiting for the driver to accept" })).toBeVisible();
    await page.goto(`/customer/tracking/${id}`);
    await acceptAsDemoDriver(page);
    await page.getByRole("link", { name: "Complete payment" }).click();
    await page.waitForURL(/\/customer\/payment\?bookingId=TAKI\w+/);
    await expect(page.getByTestId("price-total")).toHaveText("₹4,850");
  });

  test("over-capacity shipment cannot be booked", async ({ page }) => {
    await openBooking(page, { ...SEARCH, weightKg: 2500 });
    await expect(page.getByTestId("offer-problem")).toContainText("Not enough space left on this vehicle");
    await expect(page.getByRole("link", { name: "Choose another vehicle" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Request Booking/ })).toBeDisabled();
  });

  test("deep link without a search asks for shipment details", async ({ page }) => {
    await openBooking(page, null);
    await expect(page.getByTestId("booking-no-search")).toContainText("Enter your shipment details to see the price for this vehicle");
    await expect(page.getByRole("button", { name: /Request Booking/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Raj Transport" })).toBeVisible();
  });

  test("unknown route shows an empty state", async ({ page }) => {
    await openBooking(page, SEARCH, "rte_missing");
    await expect(page.getByRole("heading", { name: "Vehicle no longer available" })).toBeVisible();
  });
});
