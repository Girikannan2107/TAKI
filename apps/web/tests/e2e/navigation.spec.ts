/**
 * T1 — navigation per role: top-bar pills, the agency "More" menu, the account menu, the drawer (< 1024 px;
 * agency < 1280 px), the driver bottom bar (hidden on action screens), active states, landing CTAs and legal pages.
 * Every link must land on the right page in the right role's shell.
 */
import type { Page } from "@playwright/test";
import * as A from "../support/e2e-api";
import { expect, isMobile, loginUI, test } from "../support/e2e-fixtures";

type Item = { label: string; path: RegExp; more?: boolean };

const CUSTOMER: Item[] = [
  { label: "Book Transport", path: /\/customer\/shipments\/new$/ },
  { label: "My Shipments", path: /\/customer\/shipments$/ },
  { label: "Dashboard", path: /\/customer\/dashboard$/ },
];
const AGENCY: Item[] = [
  { label: "Dashboard", path: /\/agency\/dashboard$/ },
  { label: "Vehicles", path: /\/agency\/vehicles$/ },
  { label: "Drivers", path: /\/agency\/drivers$/ },
  { label: "Trips", path: /\/agency\/trips$/ },
  { label: "Bookings", path: /\/agency\/bookings$/ },
  { label: "Add Trip", path: /\/agency\/trips\/new$/, more: true },
  { label: "Earnings", path: /\/agency\/earnings$/, more: true },
  { label: "History", path: /\/agency\/history$/, more: true },
  { label: "Help", path: /\/agency\/help$/, more: true },
];
const DRIVER: Item[] = [
  { label: "Dashboard", path: /\/driver\/dashboard$/ },
  { label: "Assigned Shipments", path: /\/driver\/shipments$/ },
  { label: "History", path: /\/driver\/history$/ },
  { label: "Profile", path: /\/driver\/profile$/ },
];
const ADMIN: Item[] = [
  { label: "Agencies", path: /\/admin\/agencies$/ },
  { label: "Drivers", path: /\/admin\/drivers$/ },
  { label: "Settlements", path: /\/admin\/settlements$/ },
  { label: "Payments", path: /\/admin\/payments$/ },
  { label: "Overview", path: /\/admin$/ },
];

const banner = (page: Page) => page.getByRole("banner");

/** Click a nav item the way a user at this viewport would, then check where it landed. */
async function go(page: Page, role: string, item: Item) {
  if (!isMobile()) {
    const nav = banner(page).getByRole("navigation", { name: "Main" });
    if (item.more) {
      await nav.getByRole("button", { name: "More" }).click();
      await nav.getByRole("link", { name: item.label }).click();
    } else {
      await nav.getByRole("link", { name: item.label, exact: true }).click();
    }
  } else if (role === "driver") {
    await page.locator('nav.fixed[aria-label="Main"]').getByRole("link", { name: item.label, exact: true }).click();
  } else {
    await banner(page).getByRole("button", { name: "Open menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Menu" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("link", { name: item.label, exact: true }).click();
    await expect(drawer).toBeHidden();
  }
  await expect(page).toHaveURL(item.path);
  await expect(page.locator(`[data-role="${role}"]`)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /something went wrong|page not found/i })).toHaveCount(0);
}

async function accountMenu(page: Page, profile: RegExp) {
  await banner(page).getByRole("button", { name: /account menu for/i }).click();
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Profile" }).click();
  await expect(page).toHaveURL(profile);
}

test.describe("navigation", () => {
  test("customer: every nav item, active states, account menu", async ({ page }) => {
    const c = await A.signupCustomer();
    await loginUI(page, c);
    for (const item of CUSTOMER) await go(page, "customer", item);
    if (!isMobile()) {
      // "My Shipments" is not active on the new-shipment form; "Book Transport" is.
      await page.goto("/customer/shipments/new");
      const nav = banner(page).getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link", { name: "Book Transport" })).toHaveAttribute("aria-current", "page");
      await expect(nav.getByRole("link", { name: "My Shipments" })).not.toHaveAttribute("aria-current", "page");
      await page.goto("/customer/payments");
      await expect(nav.getByRole("link", { name: "My Shipments" })).toHaveAttribute("aria-current", "page");
      await expect(nav.getByRole("link", { name: "Book Transport" })).not.toHaveAttribute("aria-current", "page");
    }
    await accountMenu(page, /\/customer\/profile$/);
  });

  test("agency: pills, More menu, account menu; drawer below 1280 px", async ({ page }) => {
    const agency = await A.signupAgency();
    await A.verifyAgency(agency);
    await loginUI(page, agency);
    for (const item of AGENCY) await go(page, "agency", item);
    await accountMenu(page, /\/agency\/profile$/);
    if (!isMobile()) {
      // 1279 px: the 5 pills no longer fit → hamburger + drawer.
      await page.setViewportSize({ width: 1279, height: 900 });
      await expect(banner(page).getByRole("navigation", { name: "Main" })).toBeHidden();
      await banner(page).getByRole("button", { name: "Open menu" }).click();
      const drawer = page.getByRole("dialog", { name: "Menu" });
      for (const item of AGENCY) await expect(drawer.getByRole("link", { name: item.label, exact: true })).toBeVisible();
      await expect(drawer.getByRole("button", { name: "Log out" })).toBeVisible();
      // Growing back to xl closes the drawer.
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(drawer).toBeHidden();
    }
  });

  test("agency dashboard CTAs land on their pages", async ({ page }) => {
    const { agency } = await A.makeConfirmedBooking();
    await loginUI(page, agency);
    const main = page.getByRole("main");
    for (const [name, path] of [
      [/^Vehicles/, /\/agency\/vehicles/],
      [/^Drivers/, /\/agency\/drivers/],
      [/^Upcoming Trips/, /\/agency\/trips/],
      [/^Pending Bookings/, /\/agency\/bookings/],
      [/View earnings/, /\/agency\/earnings/],
      [/^Add Trip$/, /\/agency\/trips\/new/],
    ] as const) {
      await page.goto("/agency/dashboard");
      await main.getByRole("link", { name }).first().click();
      await expect(page).toHaveURL(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    }
  });

  test("customer dashboard summary links keep the tab", async ({ page }) => {
    const { customer } = await A.makeConfirmedBooking();
    await loginUI(page, customer);
    for (const [name, tab] of [
      [/^Active shipments/, "in_transit"],
      [/^Completed/, "delivered"],
      [/^Pending bookings/, "pending"],
    ] as const) {
      await page.goto("/customer/dashboard");
      await page.getByRole("region", { name: "Shipment summary" }).getByRole("link", { name }).click();
      await expect(page).toHaveURL(new RegExp(`/customer/shipments\\?tab=${tab}`));
      await expect(page.getByRole("tab", { selected: true })).toBeVisible();
    }
  });

  test("driver: every tab; bottom bar on mobile, hidden on action screens", async ({ page }) => {
    const w = await A.makeWorld({ start: A.soonDeparture(90) });
    const { bookingId } = await A.makeConfirmedBooking(w);
    await loginUI(page, w.driver);
    for (const item of DRIVER) await go(page, "driver", item);
    if (isMobile()) {
      const bottom = page.locator("nav.fixed").filter({ has: page.getByRole("link", { name: "Assigned Shipments" }) });
      await expect(bottom).toBeVisible();
      await page.goto(`/driver/shipments/${bookingId}`);
      await expect(page.getByRole("heading", { level: 1, name: bookingId })).toBeVisible();
      await expect(bottom).toBeHidden();
      await page.goto(`/driver/trips/${w.trip.id}`);
      await expect(bottom).toBeHidden();
    }
  });

  test("admin: console nav", async ({ page }) => {
    await loginUI(page, await A.admin());
    for (const item of ADMIN) await go(page, "admin", item);
  });

  test("signed-out landing: header + hero CTAs, footer legal links", async ({ page }) => {
    test.info().annotations.push({ type: "bug", description: "T1-5: <p> nested in <p> on /refund-policy (OwnerText) → hydration error (D1)" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const footer = page.getByRole("contentinfo");
    for (const [label, path, h1] of [
      ["Terms of Service", "/terms", /terms/i],
      ["Privacy Policy", "/privacy", /privacy/i],
      ["Refund & Cancellation", "/refund-policy", /refund/i],
      ["Shipping & Delivery", "/shipping-policy", /shipping/i],
    ] as const) {
      await page.goto("/");
      await footer.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
    }
    for (const [label, path] of [
      ["Ship goods", /\/signup\/customer/],
      ["Register your agency", /\/signup\/agency/],
      ["Driver sign-up", /\/signup\/driver/],
      ["Log in", /\/auth\/login/],
    ] as const) {
      await page.goto("/");
      await footer.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(path);
    }
  });

  test("unknown route shows the branded not-found page", async ({ page, watch }) => {
    watch.allow(/404 GET .*\/no-such-page/, /status of 404/);
    const res = await page.goto("/no-such-page");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("link", { name: /home/i }).first()).toBeVisible();
  });
});
