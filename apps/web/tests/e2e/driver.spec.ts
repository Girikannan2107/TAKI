/**
 * T1 — driver app in the browser: assigned shipments, start trip, pickup OTP, checkpoint arrive/depart,
 * out for delivery, delivery OTP. The trip departs ~90 min from now (trip start opens 2 h before departure).
 */
import * as A from "../support/e2e-api";
import type { Page } from "@playwright/test";
import { expect, loginUI, test } from "../support/e2e-fixtures";

/** Confirm the action dialog the driver app opens for every step (if one opens). */
async function confirmIfAsked(page: Page) {
  const dlg = page.getByRole("dialog");
  try {
    await dlg.waitFor({ state: "visible", timeout: 3_000 });
  } catch {
    return;
  }
  // Primary action = the last button that is not Cancel (e.g. "Confirm", "Mark out for delivery").
  const primary = dlg.getByRole("button").filter({ hasNotText: /^Cancel$/ }).last();
  // The dialog pops in with an animation; retry the click if the first one landed mid-animation.
  await expect(async () => {
    if (await dlg.isVisible()) await primary.click({ timeout: 3_000 });
    await expect(dlg).toBeHidden({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
}

test.describe("driver", () => {
  test("assigned shipment → start trip → pickup OTP → checkpoints → deliver with OTP", async ({ page }) => {
    const w = await A.makeWorld({ start: A.soonDeparture(90) });
    const { bookingId } = await A.makeConfirmedBooking(w);
    const otps = (await A.customerBooking(w.customer, bookingId)).otps;
    await loginUI(page, w.driver);

    // Dashboard → assigned shipments.
    await expect(page.getByRole("heading", { level: 1, name: /Hi, Selvam/ })).toBeVisible();
    await page.getByRole("link", { name: /Pending pickups 1/ }).click();
    await expect(page).toHaveURL(/\/driver\/shipments/);
    await expect(page.getByRole("tab", { name: "To pick up", selected: true })).toBeVisible();

    // Trip: start (= depart checkpoint 0).
    await page.getByRole("link", { name: "Open trip" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/driver/trips/${w.trip.id}`));
    await page.getByRole("button", { name: "Start trip" }).click();
    await confirmIfAsked(page);
    await expect(page.getByRole("button", { name: "Start trip" })).toHaveCount(0, { timeout: 20_000 });

    // Pickup with the customer's code.
    await page.goto(`/driver/shipments/${bookingId}`);
    await expect(page.getByRole("heading", { level: 1, name: bookingId })).toBeVisible();
    await page.getByRole("button", { name: "Confirm pickup" }).click();
    const pick = page.getByRole("dialog");
    await pick.getByRole("textbox").first().fill(otps.pickup);
    await pick.getByRole("button", { name: /confirm/i }).click();
    await expect(page.getByText(/picked up|in transit/i).first()).toBeVisible({ timeout: 20_000 });

    // Checkpoint arrive/depart at Tiruppur (index 1).
    await page.goto(`/driver/trips/${w.trip.id}`);
    // The sticky action bar offers the next checkpoint step.
    await page.getByRole("button", { name: "Arrived at Tiruppur" }).click();
    await confirmIfAsked(page);
    await page.getByRole("button", { name: /Depart(ed)? (from )?Tiruppur/i }).click();
    await confirmIfAsked(page);
    await expect(page.getByRole("button", { name: /Arrived at Erode/ })).toBeVisible({ timeout: 20_000 });
    const trip = await A.api<any>(`/agency/trips/${w.trip.id}`, { token: w.agency.token });
    expect(trip.checkpoints[1].actualArrivalAt).toBeTruthy();
    expect(trip.checkpoints[1].actualDepartureAt).toBeTruthy();

    // Customer tracking shows the checkpoint event.
    // Out for delivery → deliver with the receiver's code.
    await page.goto(`/driver/shipments/${bookingId}`);
    const transit = page.getByRole("button", { name: /start transit|in transit/i });
    if (await transit.count()) {
      await transit.first().click();
      await confirmIfAsked(page);
    }
    await page.getByRole("button", { name: /out for delivery/i }).click();
    await confirmIfAsked(page);
    await page.getByRole("button", { name: "Confirm delivery" }).click();
    const del = page.getByRole("dialog");
    const form = (await del.count()) ? del : page;
    await form.getByRole("group", { name: "Delivery code" }).getByLabel("Digit 1 of 6").pressSequentially(otps.delivery, { delay: 30 });
    // Proof photo (optional; REQUIRE_DELIVERY_PROOF=false) through the labelled file input.
    await expect(form.getByRole("button", { name: "Take photo for Delivery photo" })).toBeVisible();
    await form.locator('input[type="file"]').first().setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: A.PNG });
    const recv = form.getByRole("textbox", { name: /received by/i });
    if (await recv.count()) await recv.fill("Meena Devi");
    await form.getByRole("button", { name: "Confirm delivery" }).last().click();
    await expect(page.getByText(/delivered/i).first()).toBeVisible({ timeout: 20_000 });
    expect((await A.customerBooking(w.customer, bookingId)).status).toBe("delivered");

    await page.goto("/driver/shipments?tab=delivered");
    await expect(page.getByText(bookingId).first()).toBeVisible();
  });

  test("wrong pickup code is refused with a message", async ({ page, watch }) => {
    watch.allow(/4\d\d POST .*\/pickup/, /status of 4\d\d/);
    const w = await A.makeWorld({ start: A.soonDeparture(90) });
    const { bookingId } = await A.makeConfirmedBooking(w);
    await A.api(`/driver/trips/${w.trip.id}/checkpoints/0/depart`, { token: w.driver.token, json: {} });
    await loginUI(page, w.driver);
    await page.goto(`/driver/shipments/${bookingId}`);
    await page.getByRole("button", { name: "Confirm pickup" }).click();
    const pick = page.getByRole("dialog");
    await pick.getByRole("textbox").first().fill("000000");
    await pick.getByRole("button", { name: /confirm/i }).click();
    await expect(page.getByText(/incorrect|wrong|doesn't match|invalid/i).first()).toBeVisible();
    expect((await A.customerBooking(w.customer, bookingId)).status).toBe("confirmed");
  });

  test("history and profile pages load", async ({ page }) => {
    const w = await A.makeWorld({ start: A.soonDeparture(90) });
    const { bookingId } = await A.makeConfirmedBooking(w);
    await A.driveToDelivered(w, bookingId);
    await loginUI(page, w.driver);
    await page.goto("/driver/history");
    await expect(page.getByText(bookingId).first()).toBeVisible();
    await page.getByRole("link", { name: new RegExp(bookingId) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/driver/history/${bookingId}`));
    await page.goto("/driver/profile");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(w.agency.agencyName!).first()).toBeVisible();
  });
});
