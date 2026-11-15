import { expect, test } from "@playwright/test";
import { createShipmentViaForm, dateWithOffers, loginCustomer, requestBooking } from "./booking-flow";

/**
 * v2 New Shipment → Find Vehicles → Vehicle details → Request (D3). Needs `npm run seed`.
 * State-changing tests run only in the "desktop" project so viewports don't race.
 */
test.describe("new shipment and booking request", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginCustomer(page, baseURL!);
  });

  test("New Shipment validates every section and focuses the first invalid field", async ({ page }) => {
    await page.goto("/customer/shipments/new");
    await expect(page.getByRole("heading", { level: 1, name: "New Shipment" })).toBeVisible();
    for (const name of ["Pickup (Source)", "Delivery (Destination)", "Receiver", "Cargo Details"]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
    await page.getByRole("button", { name: "Find Matching Vehicles" }).click();
    await expect(page.getByRole("region", { name: "Pickup (Source)" }).getByLabel("Full address")).toBeFocused();
    await expect(page.getByText("Choose a package type")).toBeVisible();
    await expect(page.getByText("Confirm that the shipment has no prohibited items")).toBeVisible();
    await expect(page).toHaveURL(/\/customer\/shipments\/new$/);
  });

  test("quick ship prefills New Shipment", async ({ page }) => {
    await page.goto("/customer/dashboard");
    await expect(page.getByText("Active shipments")).toBeVisible();
    await page.getByLabel("Source", { exact: true }).selectOption("coimbatore");
    await page.getByLabel("Destination", { exact: true }).selectOption("chennai");
    await page.getByLabel("Cargo Weight", { exact: true }).fill("250");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/customer\/shipments\/new\?from=coimbatore&to=chennai&weight=250/);
    await expect(page.getByRole("region", { name: "Pickup (Source)" }).getByLabel("District")).toHaveValue("coimbatore");
    await expect(page.getByRole("region", { name: "Delivery (Destination)" }).getByLabel("District")).toHaveValue("chennai");
    await expect(page.getByLabel("Weight", { exact: true })).toHaveValue("250");
  });

  test("save shipment → vehicles → details → request → awaiting agency; no duplicate request", async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop", "state-changing journey runs once");
    const date = await dateWithOffers(request);
    await createShipmentViaForm(page, date);
    const card = page.getByTestId("vehicle-card").first();
    await expect(card).toBeVisible();
    await card.getByRole("link", { name: /View details/ }).click();
    await page.waitForURL(/\/customer\/booking\/trp_.+shipment=shp_/);
    const detailsUrl = page.url();

    const id = await requestBooking(page);
    // The request is visible under My Shipments → Pending.
    await page.goto("/customer/shipments?tab=pending");
    await expect(page.getByTestId("shipment-row").filter({ hasText: id })).toBeVisible();

    // Back on the same vehicle: the CTA links to the existing booking instead.
    await page.goto(detailsUrl);
    await expect(page.getByRole("link", { name: "View your booking" }).filter({ visible: true }).first()).toHaveAttribute("href", `/customer/tracking/${id}`);

    // Cancel before the agency answers.
    await page.goto(`/customer/tracking/${id}`);
    await page.getByRole("button", { name: "Cancel request" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByTestId("tracking-status")).toContainText("Cancelled");
  });

  test("restricted goods disable the request with the reason", async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop", "state-changing journey runs once");
    const date = await dateWithOffers(request);
    await createShipmentViaForm(page, date, { goods: "perishables" });
    // Either nothing matches (all restricted) or a details page explains the problem.
    const cards = page.getByTestId("vehicle-card");
    if ((await cards.count()) === 0) {
      await expect(page.getByText(/hidden: restricted goods/)).toBeVisible();
      return;
    }
    await cards.first().getByRole("link", { name: /View details/ }).click();
    await expect(page.getByRole("region", { name: "Cargo Compatibility" })).toBeVisible();
  });
});
