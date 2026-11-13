import { expect, test } from "@playwright/test";
import { ROUTE, dateWithOffers } from "./booking-flow";

/**
 * v2 Find Vehicles (D3): guest quick ship → district-level search, filters and sorts in the URL,
 * vehicle cards from the server, guest vehicle details with "Log in to request booking".
 * Needs `npm run seed`. Read-only: safe in every viewport project.
 */
test.describe("customer search (guest)", () => {
  test("quick ship on the public dashboard searches vehicles by district", async ({ page, request }) => {
    const date = await dateWithOffers(request);
    await page.goto("/customer/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Hi there/);
    await expect(page.getByRole("heading", { name: "Quick ship" })).toBeVisible();
    // Guests don't see stats or activity.
    await expect(page.getByText("Active shipments")).toHaveCount(0);

    await page.getByLabel("Source", { exact: true }).selectOption(ROUTE.from);
    await page.getByLabel("Destination", { exact: true }).selectOption(ROUTE.to);
    await page.getByLabel("Cargo Weight", { exact: true }).fill(String(ROUTE.weightKg));
    await page.getByLabel("Shipping Date", { exact: true }).fill(date);
    await page.getByRole("button", { name: /Find Available Vehicles/ }).click();

    await expect(page).toHaveURL(new RegExp(`/customer/vehicles\\?from=${ROUTE.from}&to=${ROUTE.to}&weight=${ROUTE.weightKg}&date=${date}&cargo=general_goods`));
    const cards = page.getByTestId("vehicle-card");
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).toContainText("incl. TAKI fee");
    await expect(cards.first().getByRole("link", { name: /View details/ })).toHaveAttribute("href", /^\/customer\/booking\/trp_.+from=coimbatore/);
    // Pickup and drop are named in the route line.
    await expect(cards.first()).toContainText("(pickup)");
    await expect(cards.first()).toContainText("(drop)");
  });

  test("invalid quick-ship input shows errors and does not navigate", async ({ page }) => {
    await page.goto("/customer/dashboard");
    await page.getByLabel("Source", { exact: true }).selectOption(ROUTE.from);
    await page.getByLabel("Destination", { exact: true }).selectOption(ROUTE.from);
    await page.getByLabel("Cargo Weight", { exact: true }).fill("5");
    await page.getByRole("button", { name: /Find Available Vehicles/ }).click();
    await expect(page.getByText("Pickup and drop must be in different districts")).toBeVisible();
    await expect(page.getByText(/Weight must be between/)).toBeVisible();
    await expect(page).toHaveURL(/\/customer\/dashboard$/);
  });

  test("sort and filters live in the URL; filtered-empty offers Clear filters", async ({ page, request }) => {
    const date = await dateWithOffers(request);
    await page.goto(`/customer/vehicles?from=${ROUTE.from}&to=${ROUTE.to}&weight=${ROUTE.weightKg}&date=${date}`);
    await expect(page.getByTestId("vehicle-card").first()).toBeVisible();

    await page.getByLabel("Sort by").selectOption("departure_asc");
    await expect(page).toHaveURL(/sort=departure_asc/);
    await page.getByLabel("Sort by").selectOption("price_desc");
    await expect(page).toHaveURL(/sort=price_desc/);

    // A price cap nobody can meet → filter-applied empty state.
    const filters = page.getByRole("form", { name: "Filter vehicles" }).filter({ visible: true });
    if ((await filters.count()) === 0) await page.getByRole("button", { name: /^Filters/ }).click();
    const form = page.getByRole("form", { name: "Filter vehicles" }).filter({ visible: true });
    await form.getByLabel("Maximum price in rupees").fill("1");
    await form.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/maxPrice=1/);
    await expect(page.getByRole("heading", { name: "No vehicles match these filters" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/maxPrice/);
    await expect(page.getByTestId("vehicle-card").first()).toBeVisible();
  });

  test("incomplete search shows the empty state", async ({ page }) => {
    await page.goto("/customer/vehicles?from=coimbatore");
    await expect(page.getByRole("heading", { name: "Your search is incomplete" })).toBeVisible();
  });

  test("guest vehicle details: route, cost breakdown and a login CTA that keeps the vehicle", async ({ page, request }) => {
    const date = await dateWithOffers(request);
    await page.goto(`/customer/vehicles?from=${ROUTE.from}&to=${ROUTE.to}&weight=${ROUTE.weightKg}&date=${date}`);
    await page.getByTestId("vehicle-card").first().getByRole("link", { name: /View details/ }).click();
    await page.waitForURL(/\/customer\/booking\/trp_/);
    await expect(page.getByRole("heading", { level: 1, name: "Vehicle details" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Checkpoints" })).toContainText("Your pickup");
    await expect(page.getByRole("region", { name: "Your booking" })).toContainText("Distance charge");
    await expect(page.getByRole("region", { name: "Your booking" })).toContainText("TAKI service fee");
    await expect(page.getByText("Name and phone are shared after the agency accepts.")).toBeVisible();
    const tripId = new URL(page.url()).pathname.split("/").pop()!;
    const login = page.getByRole("link", { name: "Log in to request booking" }).filter({ visible: true }).first();
    await expect(login).toHaveAttribute("href", new RegExp(`/auth/login\\?role=customer&next=.*trip%3D${tripId}`));
  });
});
