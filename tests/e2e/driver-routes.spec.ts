import { expect, test, type Page } from "@playwright/test";

/** Driver session injected before the app boots (db absent → the store seeds fresh data). */
function driverState() {
  const now = Date.now();
  return JSON.stringify({
    state: {
      session: {
        accountId: "usr_ravi",
        role: "driver",
        profileId: "drv_ravi",
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 7 * 864e5).toISOString(),
      },
    },
    version: 1,
  });
}

async function signInAsDriver(page: Page) {
  await page.addInitScript((value) => {
    // Only on the first load of the test: later navigations/reloads keep the app's own state (e.g. the route draft).
    if (!sessionStorage.getItem("driver-spec-seeded")) {
      localStorage.setItem("taki-demo-v1", value);
      sessionStorage.setItem("driver-spec-seeded", "1");
    }
  }, driverState());
}

test.describe("Driver dashboard", () => {
  test("shows earnings and stats from the seeded store", async ({ page }) => {
    await signInAsDriver(page);
    await page.goto("/driver/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: /Hi, Ravi/ })).toBeVisible();
    await expect(page.getByText("Your journey, your earnings.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    const hero = page.getByTestId("earnings-hero");
    await expect(hero).toHaveAttribute("href", "/driver/earnings");
    await expect(page.getByTestId("earnings-amount")).toHaveText("₹28,500");
    await expect(page.getByTestId("earnings-trend")).toHaveText("+12% vs last month");

    const stats = page.getByTestId("driver-stats");
    await expect(stats.getByRole("link", { name: /Active Routes/ })).toContainText("03");
    await expect(stats.getByRole("link", { name: /Booking Requests/ })).toContainText("05");
    await expect(stats.getByRole("link", { name: /Completed Trips/ })).toContainText("18");
    await expect(stats.getByRole("link", { name: /Available Capacity/ })).toContainText(/2,000\s*kg/);
    await expect(stats.getByRole("link", { name: /Completed Trips/ })).toHaveAttribute("href", "/driver/routes?status=completed");

    await page.getByRole("link", { name: "Post a New Route" }).click();
    await page.waitForURL("**/driver/routes/new");
    await expect(page.getByRole("heading", { level: 1, name: "Add New Route" })).toBeVisible();
  });
});

test.describe("My Routes", () => {
  test("lists the driver's routes with capacity, rates and tabs", async ({ page }) => {
    await signInAsDriver(page);
    await page.goto("/driver/routes");
    await expect(page.getByRole("heading", { level: 1, name: "My Routes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add New Route" })).toHaveAttribute("href", "/driver/routes/new");

    const cards = page.getByTestId("route-card");
    await expect(cards).toHaveCount(3);
    const r1 = page.locator('[data-route-id="rte_r1"]');
    await expect(r1.getByRole("heading", { name: "Coimbatore → Salem → Vellore → Chennai" })).toBeVisible();
    await expect(r1.getByTestId("route-capacity")).toHaveText("2,000 kg available of 3,000 kg");
    await expect(r1).toContainText("₹7.50/km · ₹1.53/kg");
    await expect(r1).toContainText("TN 37 XX 4587");
    await expect(r1).toContainText("Active");

    await page.getByRole("tab", { name: /Completed/ }).click();
    await page.waitForURL("**/driver/routes?status=completed");
    await expect(page.getByTestId("route-card").first()).toContainText("Completed");
  });

  test("?published highlights the route, toasts once and drops the param", async ({ page }) => {
    await signInAsDriver(page);
    await page.goto("/driver/routes?published=rte_r2");
    await expect(page.getByText("Route published", { exact: true })).toBeVisible();
    await expect(page.locator('[data-route-id="rte_r2"]')).toHaveAttribute("data-highlighted", "true");
    await expect(page).toHaveURL(/\/driver\/routes$/);
  });
});

test.describe("Add New Route", () => {
  test("shows errors for From = To and available > total", async ({ page }) => {
    await signInAsDriver(page);
    await page.goto("/driver/routes/new");
    const from = page.getByLabel("From", { exact: true });
    await expect(from).toHaveValue("coimbatore");
    await expect(page.getByTestId("route-distance")).toContainText("Route distance ≈ 498 km");

    await from.selectOption("chennai");
    await page.getByLabel("Available Capacity").fill("4000");
    await page.getByRole("button", { name: "Next: Set Pricing" }).click();

    await expect(page.getByText("From and To must be different cities")).toBeVisible();
    await expect(page.getByText("Available capacity can't exceed total capacity")).toBeVisible();
    await expect(page.getByLabel("Available Capacity")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/driver\/routes\/new$/);

    await page.getByLabel("Total Capacity").fill("5000");
    await expect(page.getByText("Total capacity can't exceed this vehicle's 3,000 kg limit")).toBeVisible();
  });

  test("valid submit goes to pricing and the draft survives a reload", async ({ page }) => {
    await signInAsDriver(page);
    await page.goto("/driver/routes/new");
    await expect(page.getByRole("button", { name: "Remove Salem" })).toBeVisible();

    await page.getByRole("button", { name: "Remove Vellore" }).click();
    await expect(page.getByTestId("route-distance")).toContainText("Coimbatore → Salem → Chennai");
    await page.getByLabel("Available Capacity").fill("1500");
    await page.getByRole("button", { name: "Next: Set Pricing" }).click();
    await page.waitForURL("**/driver/routes/new/pricing");

    await page.goto("/driver/routes/new");
    await page.reload();
    await expect(page.getByLabel("Available Capacity")).toHaveValue("1500");
    await expect(page.getByRole("button", { name: "Remove Salem" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove Vellore" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Discard draft" })).toBeVisible();
  });
});
