import { expect, test, type Page } from "@playwright/test";

/** Injects the seeded demo customer (Arjun) session into the persisted demo store. */
async function signInAsCustomer(page: Page) {
  const now = Date.now();
  const session = {
    accountId: "usr_arjun",
    role: "customer",
    profileId: "cus_arjun",
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 7 * 864e5).toISOString(),
  };
  await page.addInitScript((value) => {
    try {
      const raw = localStorage.getItem("taki-demo-v1");
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 };
      if (!parsed.state?.session) {
        parsed.state = { ...(parsed.state ?? {}), session: value };
        localStorage.setItem("taki-demo-v1", JSON.stringify(parsed));
      }
    } catch {}
  }, session);
}

async function openDashboard(page: Page) {
  await page.goto("/customer/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hi, Arjun");
  await expect(page.getByRole("button", { name: /Find Available Vehicles/ })).toBeVisible();
}

test.describe("customer search", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsCustomer(page);
  });

  test("dashboard defaults find the three seeded vehicles", async ({ page }) => {
    await openDashboard(page);
    await expect(page.getByText("Where are we shipping today?")).toBeVisible();
    await expect(page.getByRole("heading", { name: "New Shipment" })).toBeVisible();
    await expect(page.getByLabel("Source", { exact: true })).toHaveValue("coimbatore");
    await expect(page.getByLabel("Destination", { exact: true })).toHaveValue("chennai");
    await expect(page.getByLabel("Cargo Weight", { exact: true })).toHaveValue("500");

    await page.getByRole("button", { name: /Find Available Vehicles/ }).click();
    await expect(page).toHaveURL(/\/customer\/vehicles\?from=coimbatore&to=chennai&weight=500&date=\d{4}-\d{2}-\d{2}&cargo=general_goods$/);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Available Vehicles (3)");
    const cards = page.getByTestId("vehicle-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText("Raj Transport");
    await expect(cards.nth(0)).toContainText("₹4,850");
    await expect(cards.nth(0)).toContainText("Best Price");
    await expect(cards.nth(1)).toContainText("₹5,200");
    await expect(cards.nth(1)).toContainText("Top Rated");
    await expect(cards.nth(2)).toContainText("₹5,450");
    await expect(cards.nth(2)).toContainText("More Capacity");
    await expect(cards.nth(0).getByText("incl. TAKI fee")).toBeVisible();
    await expect(cards.nth(0).getByRole("img")).toHaveAttribute("alt", /^Example .+ truck photo \(illustrative\)$/);

    const select = cards.nth(0).getByRole("link", { name: /View & Select/ });
    await expect(select).toHaveAttribute("href", /^\/customer\/booking\/rte_/);

    // Sort is reflected in the URL.
    await page.getByLabel("Sort by").selectOption("capacity");
    await expect(page).toHaveURL(/sort=capacity/);
    await expect(cards.nth(0)).toContainText("₹5,450");
  });

  test("tonnes are converted to kg in the search", async ({ page }) => {
    await openDashboard(page);
    await page.getByLabel("Weight unit").selectOption("t");
    await expect(page.getByLabel("Cargo Weight", { exact: true })).toHaveValue("0.5");
    await page.getByRole("button", { name: /Find Available Vehicles/ }).click();
    await expect(page).toHaveURL(/weight=500&/);
    await expect(page.getByTestId("vehicle-card")).toHaveCount(3);
  });

  test("invalid inputs show errors and do not navigate", async ({ page }) => {
    await openDashboard(page);
    await page.getByLabel("Destination", { exact: true }).selectOption("coimbatore");
    await page.getByLabel("Cargo Weight", { exact: true }).fill("5");
    await page.getByLabel("Pickup Date", { exact: true }).fill("2020-01-01");
    await page.getByRole("button", { name: /Find Available Vehicles/ }).click();

    await expect(page.getByText("Source and destination must be different")).toBeVisible();
    await expect(page.getByText(/Weight must be between 10 kg and 25,000 kg/)).toBeVisible();
    await expect(page.getByText("Pickup date can't be in the past")).toBeVisible();
    await expect(page.getByLabel("Destination", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/customer\/dashboard$/);

    await page.getByLabel("Cargo Weight", { exact: true }).fill("abc");
    await expect(page.getByText("Enter a number, e.g. 500")).toBeVisible();
    await page.getByLabel("Cargo Weight", { exact: true }).fill("");
    await expect(page.getByText("Enter the cargo weight")).toBeVisible();
  });

  test("vehicles page without a valid search shows an empty state", async ({ page }) => {
    await page.goto("/customer/vehicles?from=coimbatore&to=coimbatore&weight=abc");
    await expect(page.getByRole("heading", { name: "Your search is incomplete" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit search" })).toHaveAttribute("href", "/customer/dashboard");
  });

  test("weight above every vehicle's capacity explains why", async ({ page }) => {
    await openDashboard(page);
    await page.getByLabel("Cargo Weight", { exact: true }).fill("20000");
    await page.getByRole("button", { name: /Find Available Vehicles/ }).click();
    await expect(page.getByRole("heading", { name: "No vehicles on this route yet" })).toBeVisible();
    await expect(page.getByText(/don't have space for 20,000 kg|doesn't have space for 20,000 kg/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Change search" })).toBeVisible();
  });

  test("my shipments lists bookings by tab", async ({ page }) => {
    await page.goto("/customer/shipments");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My Shipments");
    await expect(page.getByRole("tab", { name: /Active/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("link", { name: /TAKI874523/ })).toHaveAttribute("href", "/customer/tracking/TAKI874523");
    await page.getByRole("tab", { name: /Completed/ }).click();
    await expect(page).toHaveURL(/tab=completed/);
    await expect(page.getByRole("link", { name: /TAKI874391/ })).toBeVisible();
  });
});
