import { expect, test } from "@playwright/test";
import { customerRequestsAgencyTrip, loginAgency } from "./agency-flow";

/**
 * v2 agency bookings (D2), replaces the Phase 1 driver-requests spec: tabs, accept (reserves capacity,
 * reveals customer contact), reject with a reason. Pickup/delivery actions live in the driver app now.
 */
test.describe("agency bookings", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAgency(page, baseURL!);
  });

  test("tabs and read-only cards; no pickup/delivery buttons on the agency side", async ({ page }) => {
    await page.goto("/agency/bookings");
    await expect(page.getByRole("heading", { level: 1, name: "Bookings" })).toBeVisible();
    for (const name of ["Pending", "Awaiting payment", "Confirmed", "Rejected", "Cancelled / Expired"]) {
      await expect(page.getByRole("tab", { name: new RegExp(name) })).toBeVisible();
    }
    await page.getByRole("tab", { name: /Confirmed/ }).click();
    await expect(page).toHaveURL(/tab=confirmed/);
    await expect(page.getByRole("button", { name: /Mark picked up|Mark delivered/ })).toHaveCount(0);
    // Unknown legacy tab values fall back to Pending.
    await page.goto("/agency/bookings?tab=declined");
    await expect(page.getByRole("tab", { name: /Pending/ })).toHaveAttribute("aria-selected", "true");
  });

  test("accept a new request: capacity reserved, contact shared", async ({ page, browser, baseURL }, info) => {
    test.skip(info.project.name !== "desktop", "state-changing: desktop only");
    const id = await customerRequestsAgencyTrip(browser, baseURL!);

    await page.goto(`/agency/bookings/${id}`);
    await expect(page.getByText("Shared after you accept").first()).toBeVisible();
    await page.goto("/agency/bookings?tab=pending");
    const card = page.locator(`[data-booking-id="${id}"]`);
    await expect(card).toContainText(/capacity after accepting/i);
    await card.getByRole("button", { name: new RegExp(`Accept .* ${id}`) }).click();
    const dialog = page.getByRole("dialog", { name: /Reserve .* on / });
    await dialog.getByRole("button", { name: "Accept booking" }).click();
    await expect(page.getByText("Booking accepted")).toBeVisible();
    await expect(card).toHaveCount(0);

    await page.goto(`/agency/bookings/${id}`);
    await expect(page.getByText("Accepted · awaiting payment").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^\+91 / }).first()).toBeVisible(); // customer phone now visible
  });

  test("reject a new request with a reason", async ({ page, browser, baseURL }, info) => {
    test.skip(info.project.name !== "desktop", "state-changing: desktop only");
    const id = await customerRequestsAgencyTrip(browser, baseURL!);

    await page.goto(`/agency/bookings/${id}`);
    await page.getByRole("button", { name: "Reject" }).click();
    const dialog = page.getByRole("dialog", { name: "Reject this request?" });
    await dialog.getByRole("button", { name: "Reject request" }).click();
    await expect(dialog.getByText("Select why you're rejecting this request")).toBeVisible();
    await dialog.getByLabel("Reason").selectOption("Schedule change");
    await dialog.getByRole("button", { name: "Reject request" }).click();
    await expect(page.getByText("Booking rejected")).toBeVisible();
    await expect(page.getByText(/Rejected .*Schedule change/)).toBeVisible();
  });
});
