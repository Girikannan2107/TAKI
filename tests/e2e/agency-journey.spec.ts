import { expect, test } from "@playwright/test";
import { loginAgency, runTag } from "./agency-flow";

/**
 * v2 agency app (D2), replaces the Phase 1 driver-journey spec: dashboard, navigation, legacy
 * /driver redirects, vehicles, drivers, history, earnings (read-only), profile, verification, help.
 * Read-only checks run in every viewport project; state-changing ones only in "desktop".
 */
const NAV = ["Dashboard", "Vehicles", "Drivers", "Add Trip", "Trips", "Bookings", "History", "Earnings", "Profile", "Help"];

test.describe("agency app", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAgency(page, baseURL!);
  });

  test("dashboard: greeting, live stats, revenue card and Add Trip", async ({ page }) => {
    await page.goto("/agency");
    await expect(page).toHaveURL(/\/agency\/dashboard/);
    await expect(page.getByRole("heading", { level: 1, name: /^Hi, / })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByTestId("verification-banner")).toHaveCount(0); // seeded agency is verified
    const stats = page.getByTestId("agency-stats");
    for (const label of ["Vehicles", "Active Trips", "Upcoming Trips", "Pending Bookings", "Completed Shipments"]) {
      await expect(stats.getByRole("link", { name: new RegExp(label) })).toBeVisible();
    }
    await expect(page.getByTestId("earnings-hero")).toHaveAttribute("href", "/agency/earnings");
    await page.getByRole("link", { name: "Add Trip" }).filter({ visible: true }).last().click();
    await page.waitForURL("**/agency/trips/new");
    await expect(page.getByRole("heading", { level: 1, name: "Add Trip" })).toBeVisible();
  });

  test("navigation reaches all 10 agency items (top bar + More + account menu, or the drawer)", async ({ page }, info) => {
    await page.goto("/agency/dashboard");
    // The agency top bar needs xl (1280px); below that the whole nav lives in the drawer.
    const narrow = (info.project.use.viewport?.width ?? 1440) < 1280;
    if (narrow) {
      await page.getByRole("button", { name: "Open menu" }).click();
      const drawer = page.getByRole("dialog", { name: "Menu" });
      for (const name of NAV) await expect(drawer.getByRole("link", { name, exact: true })).toBeVisible();
      return;
    }
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["Dashboard", "Vehicles", "Drivers", "Trips", "Bookings"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    await nav.getByRole("button", { name: "More" }).click();
    for (const name of ["Add Trip", "Earnings", "History", "Help"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Account menu/ }).click();
    await expect(page.getByRole("menuitem", { name: "Profile" })).toBeVisible();
  });

  test("legacy operator URLs redirect to /agency", async ({ page }) => {
    for (const [from, to] of [
      ["/driver/routes", "/agency/trips"],
      ["/driver/routes/new", "/agency/trips/new"],
      ["/driver/bookings", "/agency/bookings"],
      ["/driver/earnings", "/agency/earnings"],
      ["/driver/help", "/agency/help"],
    ] as const) {
      await page.goto(from);
      await expect(page).toHaveURL(new RegExp(`${to.replace(/\//g, "\\/")}(\\?|$)`));
    }
  });

  test("vehicles list shows the fleet with status and actions", async ({ page }) => {
    await page.goto("/agency/vehicles");
    await expect(page.getByRole("heading", { level: 1, name: /Vehicles/ })).toBeVisible();
    const cards = page.getByTestId("vehicle-card");
    await expect(cards.first()).toBeVisible();
    await expect(cards.first().getByRole("link", { name: /Edit/ })).toBeVisible();
  });

  test("add a vehicle: validation, normalised registration, duplicate refused", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "state-changing: desktop only");
    const reg = `TN 99 E ${String(Date.now()).slice(-4)}`;
    await page.goto("/agency/vehicles/new");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByText("Choose the vehicle type")).toBeVisible();
    await expect(page.getByText("Add a photo of the vehicle")).toBeVisible();

    await page.getByLabel("Vehicle type").selectOption("Light Truck");
    await page.getByLabel("Make & model").fill("Tata 407 Gold");
    await page.getByLabel("Registration number").fill(reg.replace(/\s/g, "").toLowerCase());
    await page.getByLabel("Max load").fill("3000");
    await page.getByRole("radio", { name: "Closed" }).check();
    await page.getByLabel("Vehicle photo").setInputFiles({ name: "truck.png", mimeType: "image/png", buffer: PNG_1PX });
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await page.waitForURL("**/agency/vehicles");
    await expect(page.getByText(reg)).toBeVisible();

    // Same registration again → field error from the server (409).
    await page.goto("/agency/vehicles/new");
    await page.getByLabel("Vehicle type").selectOption("Light Truck");
    await page.getByLabel("Make & model").fill("Duplicate");
    await page.getByLabel("Registration number").fill(reg);
    await page.getByLabel("Max load").fill("3000");
    await page.getByRole("radio", { name: "Open" }).check();
    await page.getByLabel("Vehicle photo").setInputFiles({ name: "truck.png", mimeType: "image/png", buffer: PNG_1PX });
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByLabel("Registration number")).toHaveAttribute("aria-invalid", "true");
  });

  test("drivers: tabs, invite by phone", async ({ page }, info) => {
    await page.goto("/agency/drivers");
    await expect(page.getByRole("tab", { name: /Active/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("driver-row").first()).toBeVisible();
    await page.getByRole("tab", { name: /Pending requests/ }).click();
    await expect(page).toHaveURL(/tab=pending/);

    test.skip(info.project.name !== "desktop", "state-changing: desktop only");
    const tag = runTag();
    const phone = `98${String(Date.now()).slice(-8)}`;
    await page.goto("/agency/drivers/new");
    await page.getByLabel("Driver's name").fill(`E2E Driver ${tag}`);
    await page.getByLabel("Mobile number").fill(phone);
    await page.getByRole("button", { name: "Send invite" }).click();
    await page.waitForURL("**/agency/drivers");
    await expect(page.getByTestId("invite-list")).toContainText(`E2E Driver ${tag}`);
    // Same number again is refused.
    await page.goto("/agency/drivers/new");
    await page.getByLabel("Driver's name").fill(`E2E Driver ${tag}`);
    await page.getByLabel("Mobile number").fill(phone);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText("You've already invited this number.")).toBeVisible();
  });

  test("history search, earnings (read-only), profile, verification and help", async ({ page }) => {
    await page.goto("/agency/history?type=vehicles");
    await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
    await page.getByLabel("Search").fill("zzzz-no-match");
    await expect(page.getByText("No results for 'zzzz-no-match'")).toBeVisible();

    await page.goto("/agency/earnings");
    await expect(page.getByTestId("earnings-total")).toBeVisible();
    await expect(page.getByRole("button", { name: /Withdraw/ })).toHaveCount(0);
    await page.getByRole("tab", { name: /Settlements/ }).click();
    await expect(page).toHaveURL(/tab=settlements/);

    await page.goto("/agency/profile");
    await expect(page.getByRole("heading", { name: "Agency details" })).toBeVisible();
    await expect(page.getByLabel("Agency name")).not.toHaveValue("");
    await expect(page.getByRole("link", { name: /View documents|Update documents/ })).toBeVisible();

    await page.goto("/agency/profile/verification");
    await expect(page.getByRole("heading", { level: 1, name: "Agency verification" })).toBeVisible();

    await page.goto("/agency/help");
    await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
    await expect(page.getByText("Why can't I publish trips yet?")).toBeVisible();
  });
});

test("landing \"List a Route\" leads to agency signup", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "List a Route" }).first().click();
  await page.waitForURL("**/signup/agency");
});

test("guests and other roles are kept out of /agency", async ({ page }) => {
  await page.goto("/agency/dashboard");
  await expect(page).toHaveURL(/\/auth\/login/);
});

/** 1×1 transparent PNG (magic bytes pass the upload sniffing). */
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
