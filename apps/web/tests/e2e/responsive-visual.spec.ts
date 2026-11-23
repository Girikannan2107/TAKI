/**
 * T1 — responsive + visual + accessibility sweep of the key pages, per project (desktop 1440×900, mobile 390×844):
 *   - no horizontal scroll (scrollWidth ≤ innerWidth)
 *   - no console errors and no failed requests (watch fixture)
 *   - axe (WCAG 2.0/2.1/2.2 A+AA): no serious or critical violations
 *   - a full-page screenshot to test-results/visual/<nn-name>-<project>.png (tracked baselines, refreshed on purpose)
 * Findings are soft so one run reports every page; a JSON summary per role is attached to the test.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import * as A from "../support/e2e-api";
import { axeSeriousCritical, expect, expectNoHorizontalScroll, loginUI, snap, test, type AxeFinding } from "../support/e2e-fixtures";

type Row = { page: string; url: string; hscroll: boolean; axe: AxeFinding[] };

async function sweep(page: Page, pages: [name: string, url: string][], ready?: (name: string) => Promise<void>): Promise<Row[]> {
  const rows: Row[] = [];
  for (const [name, url] of pages) {
    await page.goto(url);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page.getByRole("heading", { level: 1 }).first(), `${name}: h1`).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[aria-busy="true"]'), `${name}: still loading`).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /something went wrong/i }), `${name}: error boundary`).toHaveCount(0);
    if (ready) await ready(name);
    const { sw, iw } = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
    expect.soft(sw, `${name} (${url}): horizontal scroll ${sw} > ${iw}`).toBeLessThanOrEqual(iw);
    const axe = await axeSeriousCritical(page);
    expect.soft(axe, `${name} (${url}): axe serious/critical`).toEqual([]);
    await snap(page, name);
    rows.push({ page: name, url, hscroll: sw > iw, axe });
  }
  await test.info().attach("sweep.json", { body: JSON.stringify(rows, null, 2), contentType: "application/json" });
  const dir = path.join("test-results", "a11y");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${test.info().project.name}-${test.info().title.replace(/\W+/g, "-")}.json`);
  const prev = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Row[]) : [];
  fs.writeFileSync(file, JSON.stringify([...prev.filter((r) => !rows.some((n) => n.page === r.page)), ...rows], null, 2));
  return rows;
}

test.describe("responsive + visual", () => {
  test.describe.configure({ timeout: 300_000 });

  test("public and auth pages", async ({ page }) => {
    await sweep(page, [
      ["01-landing", "/"],
      ["02-role-selection", "/signup"],
      ["03-signup-customer", "/signup/customer"],
      ["04-signup-agency", "/signup/agency"],
      ["05-signup-driver", "/signup/driver"],
      ["06-login", "/auth/login?role=customer"],
      ["07-admin-login", "/admin/login"],
      ["08-terms", "/terms"],
      ["09-privacy", "/privacy"],
      ["10-refund-policy", "/refund-policy"],
      ["11-shipping-policy", "/shipping-policy"],
    ]);
    // Phone + OTP steps (need the signup flow state).
    await page.goto("/signup/customer");
    await page.getByLabel("Full name").fill("Visual Check");
    await page.getByLabel("Date of birth").fill("1990-01-01");
    await page.locator("#acceptTerms").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/auth\/phone/);
    await expectNoHorizontalScroll(page);
    await snap(page, "12-mobile-number");
    const mobile = A.freshMobile();
    await page.getByLabel("Mobile number").fill(mobile);
    await page.getByRole("button", { name: "Send OTP" }).click();
    await expect(page).toHaveURL(/\/auth\/verify-otp/);
    await expect(page.getByLabel("Digit 1 of 6")).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect.soft(await axeSeriousCritical(page), "verify-otp axe").toEqual([]);
    await snap(page, "13-verify-otp");
    await page.getByLabel("Digit 1 of 6").pressSequentially(await A.emulatorCode({ phone: `+91${mobile}` }), { delay: 30 });
    await expect(page).toHaveURL(/\/auth\/create-password/, { timeout: 30_000 });
    await expectNoHorizontalScroll(page);
    expect.soft(await axeSeriousCritical(page), "create-password axe").toEqual([]);
    await snap(page, "14-create-password");
  });

  test("customer pages", async ({ page }) => {
    const w = await A.makeWorld({ start: A.soonDeparture(100) });
    const day = A.istDay(w.start);
    const confirmed = await A.makeConfirmedBooking(w);
    const s2 = await A.createShipment(w.customer, "fake_coimbatore", "fake_tiruppur", day);
    const unpaid = await A.requestBooking(w.customer, s2.id, w.trip.id);
    await A.acceptBooking(w.agency, unpaid.id);
    const s3 = await A.createShipment(w.customer, "fake_coimbatore", "fake_salem", day, 150);
    await loginUI(page, w.customer);
    await sweep(page, [
      ["20-customer-dashboard", "/customer/dashboard"],
      ["21-new-shipment", "/customer/shipments/new"],
      ["22-available-vehicles", `/customer/vehicles?shipment=${s3.id}`],
      ["23-transport-details", `/customer/booking/${w.trip.id}?shipment=${s3.id}`],
      ["24-payment", `/customer/payment?bookingId=${unpaid.id}`],
      ["25-my-shipments", "/customer/shipments?tab=confirmed"],
      ["26-tracking", `/customer/tracking/${confirmed.bookingId}`],
      ["27-payments-history", "/customer/payments"],
      ["28-customer-profile", "/customer/profile"],
    ]);
    // Dev gateway (Test payment) page.
    await page.goto(`/customer/payment?bookingId=${unpaid.id}`);
    await page.getByRole("button", { name: /^Pay ₹/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Test payment" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect.soft(await axeSeriousCritical(page), "dev gateway axe").toEqual([]);
    await snap(page, "29-test-payment");
    // Delivered: receipt + review card.
    await A.driveToDelivered(w, confirmed.bookingId);
    await sweep(page, [
      ["30-tracking-delivered", `/customer/tracking/${confirmed.bookingId}`],
      ["31-receipt", `/customer/receipt/${confirmed.bookingId}`],
    ]);
  });

  test("agency pages", async ({ page }) => {
    const w = await A.makeWorld();
    const day = A.istDay(w.start);
    const { bookingId } = await A.makeConfirmedBooking(w);
    const s2 = await A.createShipment(w.customer, "fake_coimbatore", "fake_salem", day);
    const pending = await A.requestBooking(w.customer, s2.id, w.trip.id);
    const draft = await A.publishTrip(w.agency, w.vehicle.id, w.driver.uid, { start: A.departure(5), publish: false });
    await loginUI(page, w.agency);
    await sweep(page, [
      ["40-agency-dashboard", "/agency/dashboard"],
      ["41-vehicles", "/agency/vehicles"],
      ["42-add-vehicle", "/agency/vehicles/new"],
      ["43-vehicle", `/agency/vehicles/${w.vehicle.id}`],
      ["44-drivers", "/agency/drivers"],
      ["45-add-driver", "/agency/drivers/new"],
      ["46-driver", `/agency/drivers/${w.driver.uid}`],
      ["47-add-trip", "/agency/trips/new"],
      ["48-set-pricing", `/agency/trips/new/pricing?draft=${draft.id}`],
      ["49-trips", "/agency/trips"],
      ["50-trip", `/agency/trips/${w.trip.id}`],
      ["51-booking-requests", "/agency/bookings"],
      ["52-booking-pending", `/agency/bookings/${pending.id}`],
      ["53-booking-confirmed", `/agency/bookings/${bookingId}`],
      ["54-earnings", "/agency/earnings"],
      ["55-history", "/agency/history"],
      ["56-agency-profile", "/agency/profile"],
      ["57-verification", "/agency/profile/verification"],
      ["58-help", "/agency/help"],
    ]);
  });

  test("driver pages", async ({ page }) => {
    const w = await A.makeWorld({ start: A.soonDeparture(100) });
    const { bookingId } = await A.makeConfirmedBooking(w);
    await loginUI(page, w.driver);
    await sweep(page, [
      ["60-driver-dashboard", "/driver/dashboard"],
      ["61-assigned-shipments", "/driver/shipments"],
      ["62-shipment", `/driver/shipments/${bookingId}`],
      ["63-trip", `/driver/trips/${w.trip.id}`],
      ["64-driver-history", "/driver/history"],
      ["65-driver-profile", "/driver/profile"],
      ["66-driver-documents", "/driver/profile/documents"],
    ]);
  });

  test("admin pages", async ({ page }) => {
    const { agency, driver, bookingId } = await A.makeConfirmedBooking();
    await loginUI(page, await A.admin());
    await sweep(page, [
      ["70-admin-overview", "/admin"],
      ["71-admin-agencies", "/admin/agencies"],
      ["72-admin-agency", `/admin/agencies/${agency.agencyId}`],
      ["73-admin-drivers", "/admin/drivers"],
      ["74-admin-driver", `/admin/drivers/${driver.uid}`],
      ["75-admin-payments", "/admin/payments?status=succeeded"],
      ["76-admin-booking", `/admin/bookings/${bookingId}`],
      ["77-admin-settlements", "/admin/settlements"],
    ]);
  });
});
