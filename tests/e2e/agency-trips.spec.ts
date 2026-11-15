import { expect, test } from "@playwright/test";
import { istLocal, loginAgency } from "./agency-flow";

/**
 * v2 agency trips (D2), replaces the Phase 1 driver-routes spec: Trips tabs, trip details, and the
 * Add Trip flow (vehicle + driver, checkpoint editor, capacity & goods → pricing → publish).
 */
test.describe("agency trips", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAgency(page, baseURL!);
  });

  test("Trips: five tabs with counts, cards with capacity, details page", async ({ page }) => {
    await page.goto("/agency/trips");
    await expect(page.getByRole("heading", { level: 1, name: "Trips" })).toBeVisible();
    for (const name of ["Upcoming", "Active", "Completed", "Cancelled", "Drafts"]) await expect(page.getByRole("tab", { name: new RegExp(name) })).toBeVisible();
    const card = page.getByTestId("route-card").first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId("route-capacity")).toBeVisible();

    await card.getByRole("heading").getByRole("link").click();
    await page.waitForURL(/\/agency\/trips\/trp_/);
    await expect(page.getByRole("heading", { name: "Route & checkpoints" })).toBeVisible();
    await expect(page.getByTestId("trip-checkpoints").getByRole("listitem").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel trip" })).toBeVisible();

    await page.goto("/agency/trips?tab=completed");
    await expect(page.getByRole("tab", { name: /Completed/ })).toHaveAttribute("aria-selected", "true");
  });

  test("Add Trip: client validation and checkpoint editor", async ({ page }) => {
    await page.goto("/agency/trips/new");
    await expect(page.getByRole("heading", { level: 1, name: "Add Trip" })).toBeVisible();
    await page.getByRole("button", { name: "Next: Pricing" }).click();
    await expect(page.getByText("Select the vehicle for this trip")).toBeVisible();
    await expect(page.getByText("Enter the departure date and time.")).toBeVisible();

    const editor = page.getByTestId("checkpoint-editor");
    await expect(editor.getByRole("listitem")).toHaveCount(2);
    await page.getByRole("button", { name: "Add checkpoint" }).click();
    await expect(editor.getByRole("listitem")).toHaveCount(3);
    await page.getByRole("button", { name: /^Remove checkpoint 1$/ }).click();
    await expect(editor.getByRole("listitem")).toHaveCount(2);
  });

  test("Add Trip → pricing → publish", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "state-changing: desktop only");
    // Far enough ahead (day 40) not to overlap the seeded schedules.
    const start = 40 * 24;
    await page.goto("/agency/trips/new");
    await page.getByLabel("From", { exact: true }).selectOption("tiruppur");
    await page.getByLabel("Departure date & time").fill(istLocal(start));
    await page.getByRole("button", { name: "Add checkpoint" }).click();
    await page.getByLabel("Place", { exact: true }).selectOption("erode");
    await page.getByLabel("Expected arrival").fill(istLocal(start + 2));
    await page.getByLabel("Expected departure").fill(istLocal(start + 3));
    await page.getByLabel("To", { exact: true }).selectOption("salem");
    await page.getByLabel("Arrival date & time").fill(istLocal(start + 5));

    const vehicle = page.getByLabel("Vehicle", { exact: true });
    await expect(vehicle).toBeEnabled();
    const vehicleValue = await vehicle.locator("option:not([disabled]):not([value=''])").first().getAttribute("value");
    await vehicle.selectOption(vehicleValue!);
    const driver = page.getByLabel("Driver", { exact: true });
    const driverValue = await driver.locator("option:not([disabled]):not([value=''])").first().getAttribute("value");
    await driver.selectOption(driverValue!);
    await page.getByLabel("Capacity available for booking").fill("500");

    await page.getByRole("button", { name: "Next: Pricing" }).click();
    await page.waitForURL(/\/agency\/trips\/new\/pricing\?draft=trp_/);
    await expect(page.getByTestId("draft-path")).toContainText("Tiruppur → Erode → Salem");
    await page.getByLabel("Rate per km").fill("14");
    await page.getByLabel("Rate per kg").fill("0.75");
    await expect(page.getByTestId("preview-earnings")).not.toHaveText("—");
    await page.getByRole("button", { name: "Publish trip" }).click();
    await page.waitForURL(/\/agency\/trips\?tab=upcoming/);
    await expect(page.locator('[data-highlighted="true"]')).toContainText("Tiruppur → Salem");
  });
});
