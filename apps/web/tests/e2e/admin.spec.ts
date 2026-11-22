/**
 * T1 — hidden admin console in the browser: login, verify a pending agency and a pending driver, payments list,
 * booking support lookup, settlements. The admin is bootstrapped by create_admin.py (global setup).
 */
import * as A from "../support/e2e-api";
import { expect, loginUI, navLink, settle, test } from "../support/e2e-fixtures";

test.describe("admin", () => {
  test("verify a pending agency from the queue", async ({ page }) => {
    const agency = await A.signupAgency();
    await A.verifyAgency(agency, { submitOnly: true });
    await loginUI(page, await A.admin());

    await page.goto("/admin/agencies?status=pending");
    await settle(page);
    await page.getByRole("link", { name: new RegExp(agency.agencyName!) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/agencies/${agency.agencyId}`));
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(agency.agencyName!) })).toBeVisible();
    // Documents are served through signed URLs; the PAN number is masked.
    await expect(page.getByText("ABCDE1234F")).toHaveCount(0);
    await page.getByRole("button", { name: /^verify/i }).click();
    const dlg = page.getByRole("dialog");
    if (await dlg.isVisible().catch(() => false)) await dlg.getByRole("button", { name: /verify|confirm/i }).last().click();
    await expect(page.getByText(/verified/i).first()).toBeVisible({ timeout: 20_000 });
    const v = await A.api<any>("/agency/verification", { token: agency.token });
    expect(JSON.stringify(v)).toContain("verified");
  });

  test("verify a pending driver from the queue", async ({ page }) => {
    const agency = await A.signupAgency();
    await A.verifyAgency(agency);
    const name = `Pending Driver ${Math.floor(Math.random() * 1e5)}`;
    const driver = await A.addDriver(agency, name, { verify: false });
    await loginUI(page, await A.admin());
    await page.goto("/admin/drivers?status=pending");
    await settle(page);
    await page.getByRole("link", { name: new RegExp(name) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/drivers/${driver.uid}`));
    await expect(page.getByText("234123412346")).toHaveCount(0); // Aadhaar masked
    await page.getByRole("button", { name: /^verify/i }).click();
    const dlg = page.getByRole("dialog");
    if (await dlg.isVisible().catch(() => false)) await dlg.getByRole("button", { name: /verify|confirm/i }).last().click();
    await expect(page.getByText(/verified/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test("payments list, booking lookup and settlements", async ({ page }) => {
    const { bookingId } = await A.makeConfirmedBooking();
    await loginUI(page, await A.admin());
    await (await navLink(page, "Payments")).click();
    await expect(page).toHaveURL(/\/admin\/payments/);
    await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
    // Defaults to the support queue (refund failed); filter to paid.
    await page.getByLabel("Status", { exact: true }).selectOption({ label: "Paid" });
    await expect(page).toHaveURL(/status=(paid|succeeded)/);
    await expect(page.getByText(bookingId).filter({ visible: true }).first()).toBeVisible();
    await page.getByRole("link", { name: new RegExp(bookingId) }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/bookings/${bookingId}`));
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(bookingId) })).toBeVisible();
    await (await navLink(page, "Settlements")).click();
    await expect(page).toHaveURL(/\/admin\/settlements/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await (await navLink(page, "Overview")).click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("admin pages are noindex", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});
