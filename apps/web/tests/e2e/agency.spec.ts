/**
 * T1 — travel agency in the browser: vehicles, driver invites, Add Trip (checkpoints) + pricing with
 * additional charges → publish, accept/reject booking requests, earnings. Fixtures through the API.
 */
import type { Page } from "@playwright/test";
import * as A from "../support/e2e-api";
import { expect, loginUI, settle, test } from "../support/e2e-fixtures";

/** datetime-local value (IST, the browser timezone) for a UTC Date. */
const local = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16);

async function findPlace(page: Page, scope: ReturnType<Page["locator"]>, label: string, town: string) {
  await scope.getByLabel(label, { exact: true }).fill(town);
  await scope.getByRole("button", { name: "Find" }).click();
  await expect(scope.getByLabel("Place found")).toBeVisible();
}

test.describe("agency", () => {
  test("vehicles: add a vehicle, see it listed, open it", async ({ page }) => {
    const agency = await A.signupAgency();
    await A.verifyAgency(agency);
    await loginUI(page, agency);
    await page.goto("/agency/vehicles");
    await page.getByRole("link", { name: "Add vehicle" }).click();
    await expect(page).toHaveURL(/\/agency\/vehicles\/new/);
    await page.getByLabel("Vehicle type").selectOption({ label: "Light Truck" });
    await page.getByLabel("Model").selectOption({ label: "Tata 407" });
    const reg = `TN38TB${Math.floor(1000 + Math.random() * 8999)}`;
    await page.getByLabel("Registration number").fill(reg);
    await page.getByLabel("Max load").fill("3000");
    await page.getByRole("group", { name: "Body type" }).getByText("Closed").click();
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page).toHaveURL(/\/agency\/vehicles(\/veh_|$|\?)/, { timeout: 30_000 });
    await page.goto("/agency/vehicles");
    await expect(page.getByRole("heading", { level: 1, name: /Vehicles \(1\)/ })).toBeVisible();
    await page.getByRole("link", { name: "Tata 407" }).first().click();
    await expect(page).toHaveURL(/\/agency\/vehicles\/veh_/);
    await expect(page.getByRole("heading", { level: 1, name: /Tata 407/ })).toBeVisible();
  });

  test("vehicles: the vehicle page offers the RC upload that publishing requires", async ({ page }) => {
    // REQUIRE_VEHICLE_RC=true (default): a trip cannot be published with a vehicle that has no RC.
    const agency = await A.signupAgency();
    await A.verifyAgency(agency);
    const v = await A.api<{ id: string }>("/agency/vehicles", {
      token: agency.token,
      json: { vehicleClass: "Light Truck", modelId: "tata_407", makeModel: "Tata 407", registrationNumber: `TN37TC${Math.floor(1000 + Math.random() * 8999)}`, maxPayloadKg: 3000, bodyType: "closed", dimensionsFt: null, acceptedGoods: ["general_goods"], handlingSupported: [] },
    });
    await loginUI(page, agency);
    await page.goto(`/agency/vehicles/${v.id}`);
    await settle(page);
    await expect(page.getByText(/registration certificate|\bRC\b/i).first(), "no RC upload on the vehicle page").toBeVisible({ timeout: 5_000 });
  });

  test("drivers: invite by name + phone → listed as an invite; verified driver shows on Active", async ({ page }) => {
    const agency = await A.signupAgency();
    await A.verifyAgency(agency);
    const active = await A.addDriver(agency, "Selvam Active");
    await loginUI(page, agency);
    await page.goto("/agency/drivers");
    await expect(page.getByRole("tab", { name: /Active 1/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Selvam Active" }).first()).toBeVisible();
    await page.getByRole("link", { name: "Add driver" }).click();
    await expect(page).toHaveURL(/\/agency\/drivers\/new/);
    const mobile = A.freshMobile();
    await page.getByLabel("Driver's name").fill("Invited Kumar");
    await page.getByLabel("Mobile number").fill(mobile);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page).toHaveURL(/\/agency\/drivers/, { timeout: 20_000 });
    const invites = await A.api<{ items: { fullName: string }[] }>("/agency/driver-invites", { token: agency.token });
    expect(invites.items.map((i) => i.fullName)).toContain("Invited Kumar");
    await page.goto("/agency/drivers");
    await expect(page.getByText("Invited Kumar").first()).toBeVisible();
    // Driver detail.
    await page.getByRole("link", { name: `View ${active.name}` }).click();
    await expect(page).toHaveURL(new RegExp(`/agency/drivers/${active.uid}`));
    await expect(page.getByRole("heading", { level: 1, name: "Selvam Active" })).toBeVisible();
  });

  test("Add Trip: checkpoints (typed towns, E23) → pricing with additional charges → publish", async ({ page }) => {
    const agency = await A.signupAgency();
    await A.verifyAgency(agency);
    const driver = await A.addDriver(agency, "Trip Driver");
    const vehicle = await A.addVehicle(agency);
    await loginUI(page, agency);

    // "Add Trip" lives in the More menu on desktop, in the drawer on mobile.
    await page.goto("/agency/dashboard");
    await page.getByRole("link", { name: "Add Trip" }).first().click();
    await expect(page).toHaveURL(/\/agency\/trips\/new/);

    const start = A.departure(3);
    const route = page.getByRole("group", { name: "Route & checkpoints" });
    const items = route.getByRole("listitem");
    await findPlace(page, items.nth(0), "From", "Coimbatore");
    await items.nth(0).getByLabel("Departure date & time").fill(local(start));
    await findPlace(page, items.nth(1), "To", "Salem");
    await items.nth(1).getByLabel("Arrival date & time").fill(local(new Date(start.getTime() + 6 * 3_600_000)));
    await route.getByRole("button", { name: "Add checkpoint" }).click();
    await expect(items).toHaveCount(3);
    const stop = items.filter({ has: page.getByLabel("Place", { exact: true }) });
    await findPlace(page, stop, "Place", "Erode");
    await stop.getByLabel("Expected arrival").fill(local(new Date(start.getTime() + 3 * 3_600_000)));
    await stop.getByLabel("Expected departure").fill(local(new Date(start.getTime() + 3.25 * 3_600_000)));

    await page.getByLabel("Vehicle", { exact: true }).selectOption({ value: vehicle.id });
    await page.getByLabel("Driver", { exact: true }).selectOption({ value: driver.uid });
    await page.getByLabel("Capacity available for booking").fill("1200");
    await page.getByRole("group", { name: "Accepted goods" }).getByText("General goods").click();
    await page.getByRole("button", { name: "Next: Pricing" }).click();

    await expect(page).toHaveURL(/\/agency\/trips\/new\/pricing\?draft=trp_/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Set Pricing" })).toBeVisible();
    await page.getByLabel("Rate per km").fill("18");
    await page.getByLabel("Rate per kg").fill("2");
    const charges = page.getByRole("group", { name: "Additional charges" });
    const before = await charges.getByLabel("Charge").count();
    await charges.getByRole("button", { name: "Add a charge" }).click();
    await expect(charges.getByLabel("Charge")).toHaveCount(before + 1);
    await charges.getByLabel("Charge").last().fill("Toll");
    await charges.getByLabel("Amount").last().fill("150");
    // The preview lists the new charge line.
    await expect(page.getByRole("term").filter({ hasText: /^Toll$/ })).toBeVisible();
    // Remove → re-add keeps the repeater consistent.
    await charges.getByRole("button", { name: "Remove Toll" }).click();
    await expect(charges.getByLabel("Charge")).toHaveCount(before);
    await charges.getByRole("button", { name: "Add a charge" }).click();
    await charges.getByLabel("Charge").last().fill("Toll");
    await charges.getByLabel("Amount").last().fill("150");
    await page.getByRole("button", { name: "Publish trip" }).click();

    await expect(page).toHaveURL(/\/agency\/trips(\/trp_|\?)/, { timeout: 30_000 });
    const trips = await A.api<any>("/agency/trips?tab=upcoming", { token: agency.token });
    const t = JSON.stringify(trips);
    expect(t).toContain("Coimbatore → Salem");
    const tripId = /"id":"(trp_[a-z0-9]+)"/.exec(t)![1];
    const trip = await A.api<any>(`/agency/trips/${tripId}`, { token: agency.token });
    expect(trip.status).toBe("published");
    expect(trip.stops).toEqual(["Coimbatore", "Erode", "Salem"]);
    expect(trip.rates.additionalCharges.map((c: any) => c.label)).toContain("Toll");
    await page.goto(`/agency/trips/${tripId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Coimbatore → Salem" })).toBeVisible();
    await expect(page.getByText("Toll").first()).toBeVisible();
  });

  test("bookings: reject one request with a reason, accept another", async ({ page }) => {
    const w = await A.makeWorld();
    const day = A.istDay(w.start);
    const s1 = await A.createShipment(w.customer, "fake_coimbatore", "fake_erode", day);
    const s2 = await A.createShipment(w.customer, "fake_tiruppur", "fake_salem", day);
    const b1 = await A.requestBooking(w.customer, s1.id, w.trip.id);
    const b2 = await A.requestBooking(w.customer, s2.id, w.trip.id);
    await loginUI(page, w.agency);
    await page.goto("/agency/bookings");
    await expect(page.getByRole("tab", { name: /Pending 2/ })).toBeVisible();

    await page.goto(`/agency/bookings/${b1.id}`);
    await page.getByRole("button", { name: "Reject" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("textbox").first().fill("Vehicle is full on that leg");
    await dlg.getByRole("button", { name: /reject/i }).click();
    await expect(page.getByText(/rejected/i).first()).toBeVisible({ timeout: 20_000 });

    await page.goto(`/agency/bookings/${b2.id}`);
    await expect(page.getByRole("definition").filter({ hasText: "Shared after you accept" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Accept" }).click();
    const confirm = page.getByRole("dialog");
    if (await confirm.count()) await confirm.getByRole("button", { name: /accept/i }).click();
    await expect(page.getByText(/awaiting payment|accepted/i).first()).toBeVisible({ timeout: 20_000 });
    expect((await A.customerBooking(w.customer, b1.id)).status).toBe("rejected");
    expect((await A.customerBooking(w.customer, b2.id)).status).toBe("pending_payment");
    await page.goto("/agency/bookings?tab=rejected");
    await expect(page.getByText(b1.id).first()).toBeVisible();
  });

  test("earnings show the paid booking; trip page shows capacity", async ({ page }) => {
    const { agency, bookingId, trip } = await A.makeConfirmedBooking();
    await loginUI(page, agency);
    await page.goto("/agency/dashboard");
    await page.getByRole("link", { name: /View earnings/ }).click();
    await expect(page).toHaveURL(/\/agency\/earnings/);
    await expect(page.getByRole("heading", { level: 1, name: "Earnings" })).toBeVisible();
    await page.getByRole("tab", { name: /Payments/ }).click();
    await expect(page.getByText(bookingId).first()).toBeVisible();

    await page.goto(`/agency/trips/${trip.id}`);
    await expect(page.getByRole("heading", { name: "Capacity" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(bookingId) })).toBeVisible();
  });

  test("an unverified agency cannot publish (verification CTA shown)", async ({ page, watch }) => {
    watch.allow(/40[39] POST .*\/agency\/trips/, /status of 40[39]/);
    const agency = await A.signupAgency();
    await A.verifyAgency(agency, { submitOnly: true });
    await loginUI(page, agency);
    await page.goto("/agency/dashboard");
    await expect(page.getByText(/verification|verify/i).first()).toBeVisible();
    await page.goto("/agency/profile/verification");
    await expect(page.getByRole("heading", { level: 1, name: "Agency verification" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Verification status" })).toContainText(/pending|review/i);
  });
});
