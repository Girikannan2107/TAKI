/**
 * T3 — Driver journey (Phase 3). Covers the new-driver happy path through the real UI,
 * Ravi's booking requests / shipments / earnings, invalid cases and driver navigation.
 *
 * Run: E2E_PORT=3100 npx playwright test tests/e2e/driver-journey.spec.ts --project=desktop --workers=1 --output=test-results/t3/pw
 */
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

const DAY = 864e5;
const STORE_KEY = "taki-demo-v1";

/** IST calendar date `days` from now ("YYYY-MM-DD"). */
function istDate(days: number): string {
  return new Date(Date.now() + 5.5 * 3600e3 + days * DAY).toISOString().slice(0, 10);
}

/** A fresh, unseeded mobile number (seeded demo numbers start 98765 / 90000). */
function randomMobile(): string {
  return "7" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
}

type Who = "ravi" | "arjun";
function sessionState(who: Who, extra: Record<string, unknown> = {}) {
  const now = Date.now();
  const session =
    who === "ravi"
      ? { accountId: "usr_ravi", role: "driver", profileId: "drv_ravi" }
      : { accountId: "usr_arjun", role: "customer", profileId: "cus_arjun" };
  return JSON.stringify({
    state: {
      session: { ...session, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * DAY).toISOString() },
      ...extra,
    },
    version: 1,
  });
}

/** Seeds the store once per test (db absent → app seeds fresh demo data); later loads keep app state. */
async function seed(target: Page | BrowserContext, who: Who | null, extra: Record<string, unknown> = {}) {
  const value = who ? sessionState(who, extra) : null;
  await target.addInitScript(
    ([key, v]) => {
      if (!sessionStorage.getItem("t3-seeded")) {
        if (v) localStorage.setItem(key as string, v as string);
        else localStorage.removeItem(key as string);
        sessionStorage.setItem("t3-seeded", "1");
      }
    },
    [STORE_KEY, value],
  );
}

/** Collects console errors / page errors; asserted empty at the end of each test (R-8). */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[console] ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  return errors;
}

async function logout(page: Page) {
  const direct = page.getByRole("button", { name: "Log out" });
  if (!(await direct.first().isVisible())) await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Log out" }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/$/);
}

async function login(page: Page, role: "customer" | "driver") {
  await page.goto("/auth/login");
  await page.getByRole("button", { name: role === "customer" ? "Fill demo customer" : "Fill demo driver" }).click();
  await page.getByLabel("Password", { exact: true }).fill("Taki@2025");
  await page.getByRole("button", { name: "Log In" }).click();
  await expect(page).toHaveURL(role === "customer" ? /\/customer\/dashboard/ : /\/driver\/dashboard/, { timeout: 15_000 });
}

/** Clicks a dashboard sidebar item; on small viewports opens the menu drawer first. */
async function navTo(page: Page, label: string) {
  const visible = page.getByRole("link", { name: label, exact: true }).filter({ visible: true });
  if (!(await visible.count())) await page.getByRole("button", { name: "Open menu" }).click();
  await visible.first().click();
}

/** No horizontal page scroll (layout rule: every page works at 360 px+). */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `horizontal overflow on ${page.url()}`).toBeLessThanOrEqual(0);
}

const stat = (page: Page, name: RegExp) => page.getByTestId("driver-stats").getByRole("link", { name });
const requestCard = (page: Page, customer: string) =>
  page.getByTestId("booking-request-card").filter({ hasText: `Customer: ${customer}` });
const routeCard = (page: Page, id: string) => page.locator(`[data-route-id="${id}"]`);

// ───────────────────────────── 1. New driver happy path ─────────────────────────────

test.describe("T3 new driver journey", () => {
  test("landing → sign up → post route → publish → bookable by a customer @happy", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await seed(page, null);
    const travelDate = istDate(5);
    const fullName = "Selvi Murugan";
    const business = "Selvi Cargo Movers";

    // Landing → List a Route → role → phone → OTP → password.
    await page.goto("/");
    await page.getByRole("link", { name: "List a Route" }).first().click();
    await expect(page).toHaveURL(/\/signup\?role=driver/);
    await page.getByRole("link", { name: /I'm a Lorry Driver/ }).click();
    await expect(page).toHaveURL(/\/auth\/phone\?.*role=driver/);
    await page.getByLabel("Mobile number").fill(randomMobile());
    await page.getByRole("button", { name: "Send OTP" }).click();
    await expect(page).toHaveURL(/\/auth\/verify-otp/);
    const code = (await page.getByTestId("demo-otp-code").textContent())?.trim() ?? "";
    expect(code).toMatch(/^\d{6}$/);
    await page.getByLabel("Digit 1 of 6").click();
    await page.keyboard.type(code.slice(0, 5));
    const verify = page.getByRole("button", { name: "Verify" });
    await expect(verify).toBeDisabled();
    await page.keyboard.type(code.slice(5)); // 6th digit auto-submits
    await expect(page).toHaveURL(/\/auth\/create-password/, { timeout: 15_000 });
    await page.getByLabel("Full name").fill(fullName);
    await page.getByLabel("Business name").fill(business);
    await page.getByLabel("Password", { exact: true }).fill("Secure123");
    await page.getByLabel("Confirm password", { exact: true }).fill("Secure123");
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page).toHaveURL(/\/driver\/dashboard/, { timeout: 15_000 });

    // New driver dashboard: greeting, zeros / empty states.
    await expect(page.getByRole("heading", { level: 1, name: /Hi, Selvi/ })).toBeVisible();
    await expect(page.getByTestId("earnings-amount")).toHaveText("₹0");
    await expect(page.getByTestId("earnings-trend")).toHaveCount(0);
    await expect(stat(page, /Active Routes/)).toContainText("00");
    await expect(stat(page, /Booking Requests/)).toContainText("00");
    await expect(stat(page, /Completed Trips/)).toContainText("00");
    await expect(stat(page, /Available Capacity/)).toContainText("—");
    await expect(page.getByText(/NaN|undefined|Infinity/)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `test-results/t3/new-driver-dashboard-${test.info().project.name}.png`, fullPage: true });

    // Empty states for a new driver.
    await page.goto("/driver/routes");
    await expect(page.getByText("You haven't listed a route")).toBeVisible();
    await page.goto("/driver/bookings");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Booking Requests (0)");
    await expect(page.getByText("No pending requests")).toBeVisible();
    await page.goto("/driver/earnings");
    await expect(page.getByTestId("available-payout")).toHaveText("₹0");
    await expect(page.getByRole("button", { name: "Withdraw" })).toBeDisabled();
    await expect(page.getByText(/No settlements yet/)).toBeVisible();
    await expect(page.getByText(/NaN|undefined|Infinity/)).toHaveCount(0);
    await page.goto("/driver/dashboard");

    // Add New Route.
    await page.getByRole("link", { name: "Post a New Route" }).click();
    await expect(page).toHaveURL(/\/driver\/routes\/new$/);
    await expect(page.getByRole("heading", { level: 1, name: "Add New Route" })).toBeVisible();
    await page.getByLabel("From", { exact: true }).selectOption("coimbatore");
    await page.getByLabel("To", { exact: true }).selectOption("chennai");
    // Start from no stops, add Salem + Vellore, remove one and re-add it.
    for (const name of ["Salem", "Vellore"]) {
      const rm = page.getByRole("button", { name: `Remove ${name}` });
      if (await rm.count()) await rm.click();
    }
    await expect(page.getByTestId("route-distance")).toContainText("Coimbatore → Chennai");
    for (const city of ["salem", "vellore"]) {
      await page.getByRole("button", { name: /Add Stop/ }).click();
      const picker = page.getByLabel("Choose a stop city");
      await expect(picker.locator("option[value=coimbatore]")).toHaveCount(0);
      await expect(picker.locator("option[value=chennai]")).toHaveCount(0);
      await picker.selectOption(city);
    }
    await expect(page.getByTestId("route-distance")).toContainText("Coimbatore → Salem → Vellore → Chennai");
    await page.getByRole("button", { name: "Remove Vellore" }).click();
    await expect(page.getByTestId("route-distance")).toContainText("Coimbatore → Salem → Chennai");
    await page.getByRole("button", { name: /Add Stop/ }).click();
    await expect(page.getByLabel("Choose a stop city").locator("option[value=salem]")).toHaveCount(0); // no duplicate stop offered
    await page.getByLabel("Choose a stop city").selectOption("vellore");
    await expect(page.getByTestId("route-distance")).toContainText("Coimbatore → Salem → Vellore → Chennai");
    await expect(page.getByTestId("route-distance")).toContainText("498 km");
    await expectNoHorizontalScroll(page);

    await page.getByLabel("Travel Date").fill(travelDate);
    await page.getByLabel("Departure Time").selectOption("08:00");
    await page.getByLabel("Vehicle Type").selectOption("new:tata_407");
    await page.getByLabel("Total Capacity").fill("3000");
    await page.getByLabel("Available Capacity").fill("2000");
    await page.getByRole("button", { name: "Next: Set Pricing" }).click();
    await expect(page).toHaveURL(/\/driver\/routes\/new\/pricing$/, { timeout: 15_000 });

    // Set Pricing preview.
    await expect(page.getByRole("heading", { level: 1, name: "Set Pricing" })).toBeVisible();
    await expect(page.getByTestId("draft-path")).toHaveText("Coimbatore → Salem → Vellore → Chennai");
    await page.getByLabel("Per Kilometre Rate").fill("12");
    await page.getByLabel("Per Kilogram Rate").fill("0.50");
    const preview = page.getByTestId("price-preview");
    await expect(preview).toContainText("Distance charge (498 km × ₹12)");
    await expect(preview).toContainText("Weight charge (500 kg × ₹0.50)");
    await expect(page.getByTestId("preview-distance")).toHaveText("₹5,976");
    await expect(page.getByTestId("preview-weight")).toHaveText("₹250");
    await expect(page.getByTestId("preview-earnings")).toHaveText("₹6,226");
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: "Publish Route" }).click();
    await expect(page).toHaveURL(/\/driver\/routes(\?published=rte_\w+)?$/, { timeout: 15_000 });

    // My Routes shows it.
    const cards = page.getByTestId("route-card");
    await expect(cards).toHaveCount(1);
    await expect(cards.first().getByRole("heading", { name: "Coimbatore → Salem → Vellore → Chennai" })).toBeVisible();
    await expect(cards.first().getByTestId("route-capacity")).toHaveText("2,000 kg available of 3,000 kg");
    await expect(cards.first()).toContainText("₹12/km · ₹0.50/kg");
    await expect(cards.first()).toContainText("Tata 407");
    await expect(cards.first()).toContainText("Active");
    await expectNoHorizontalScroll(page);

    await navTo(page, "Dashboard");
    await expect(stat(page, /Active Routes/)).toContainText("01");
    await expect(stat(page, /Available Capacity/)).toContainText(/2,000\s*kg/);

    // A customer can find and book it.
    await logout(page);
    await login(page, "customer");
    await page.getByLabel("Source", { exact: true }).selectOption("coimbatore");
    await page.getByLabel("Destination", { exact: true }).selectOption("chennai");
    await page.getByLabel("Cargo Weight", { exact: true }).fill("500");
    await page.getByLabel("Pickup Date", { exact: true }).fill(travelDate);
    await page.getByRole("button", { name: /Find Available Vehicles/ }).click();
    await expect(page).toHaveURL(new RegExp(`/customer/vehicles\\?.*date=${travelDate}`));
    const offer = page.getByTestId("vehicle-card").filter({ hasText: business });
    await expect(offer).toHaveCount(1);
    await expect(offer).toContainText("₹6,576"); // 6,226 + ₹350 fee
    await expectNoHorizontalScroll(page);
    await expect(offer.getByRole("link", { name: /View & Select/ })).toHaveAttribute("href", /^\/customer\/booking\/rte_/);

    // Back to the demo driver.
    await logout(page);
    await login(page, "driver");
    await expect(page.getByRole("heading", { level: 1, name: /Hi, Ravi/ })).toBeVisible();
    await expect(stat(page, /Booking Requests/)).toContainText("05");

    expect(errors, errors.join("\n")).toEqual([]);
  });
});

// ───────────────────────────── 2. Ravi's requests, shipments, earnings ─────────────────────────────

test.describe("T3 Ravi booking requests", () => {
  test("accept updates capacity everywhere; overbook blocked; decline keeps capacity", async ({ page }) => {
    const errors = watchConsole(page);
    await seed(page, "ravi");
    await page.goto("/driver/bookings");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText("Booking Requests (5)");

    await expect(requestCard(page, "Arjun K.").getByTestId("request-earnings")).toHaveText("₹4,194");
    await expect(requestCard(page, "Meera S.").getByTestId("request-earnings")).toHaveText("₹4,028");
    await requestCard(page, "Arjun K.").getByRole("button", { name: /^Accept / }).click();
    await expect(h1).toHaveText("Booking Requests (4)");

    // My Routes + dashboard reflect 1,700 kg.
    await navTo(page, "My Routes");
    await expect(routeCard(page, "rte_r1").getByTestId("route-capacity")).toHaveText("1,700 kg available of 3,000 kg");
    await navTo(page, "Dashboard");
    await expect(stat(page, /Available Capacity/)).toContainText(/1,700\s*kg/);
    await expect(stat(page, /Booking Requests/)).toContainText("04");

    // Meera → 700 left; Karthik blocked with the exact message.
    await stat(page, /Booking Requests/).click();
    await expect(page).toHaveURL(/\/driver\/bookings/);
    await expect(requestCard(page, "Meera S.")).toContainText("1,700 kg left on this route");
    await requestCard(page, "Meera S.").getByRole("button", { name: /^Accept / }).click();
    await expect(h1).toHaveText("Booking Requests (3)");
    const karthik = requestCard(page, "Karthik R.");
    await expect(karthik.getByRole("button", { name: /^Accept / })).toBeDisabled();
    await expect(karthik.getByTestId("capacity-reason")).toHaveText("Not enough capacity — 700 kg left, needs 1,200 kg");
    await expect(karthik.getByRole("button", { name: /^Decline / })).toBeEnabled();

    // Decline Karthik (r1): Esc cancels first, then confirm. Capacity stays 700.
    await karthik.getByRole("button", { name: /^Decline / }).click();
    const dialog = page.getByRole("dialog", { name: "Decline this request?" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(h1).toHaveText("Booking Requests (3)");
    await karthik.getByRole("button", { name: /^Decline / }).click();
    await dialog.getByRole("button", { name: "Decline request" }).click();
    await expect(dialog).toBeHidden();
    await expect(h1).toHaveText("Booking Requests (2)");
    await page.getByRole("tab", { name: /^Declined/ }).click();
    await expect(requestCard(page, "Karthik R.")).toContainText("Declined");
    await page.goto("/driver/routes");
    await expect(routeCard(page, "rte_r1").getByTestId("route-capacity")).toHaveText("700 kg available of 3,000 kg");
    await page.goto("/driver/dashboard");
    await expect(stat(page, /Available Capacity/)).toContainText(/700\s*kg/);
    await expect(stat(page, /Booking Requests/)).toContainText("02");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("double-click Accept, reload and a second tab deduct capacity only once", async ({ page, context }) => {
    const errors = watchConsole(page);
    await seed(context, "ravi");
    await page.goto("/driver/bookings");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Booking Requests (5)");

    // Second tab opened on the same pending list before the accept.
    const tab2 = await context.newPage();
    const errors2 = watchConsole(tab2);
    await tab2.goto("/driver/bookings");
    await expect(requestCard(tab2, "Divya M.").getByRole("button", { name: /^Accept / })).toBeEnabled();

    // Double-click on Divya (r2, 800 kg): r2 2,000 → 1,200 once.
    await requestCard(page, "Divya M.").getByRole("button", { name: /^Accept / }).dblclick();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Booking Requests (4)");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Booking Requests (4)");
    await expect(requestCard(page, "Divya M.")).toHaveCount(0);

    // Stale tab tries the same accept.
    const staleAccept = requestCard(tab2, "Divya M.").getByRole("button", { name: /^Accept / });
    if (await staleAccept.count()) {
      if (await staleAccept.isEnabled()) await staleAccept.click();
      await tab2.waitForTimeout(1500);
    }
    await tab2.goto("/driver/routes");
    await expect(routeCard(tab2, "rte_r2").getByTestId("route-capacity")).toHaveText("1,200 kg available of 3,000 kg");
    await page.goto("/driver/routes");
    await expect(routeCard(page, "rte_r2").getByTestId("route-capacity")).toHaveText("1,200 kg available of 3,000 kg");
    await page.goto("/driver/bookings?tab=accepted");
    await expect(requestCard(page, "Divya M.")).toHaveCount(1);

    expect([...errors, ...errors2], [...errors, ...errors2].join("\n")).toEqual([]);
  });

  test("advancing a shipment to delivered credits its earnings", async ({ page }) => {
    const errors = watchConsole(page);
    await seed(page, "ravi");
    await page.goto("/driver/bookings?tab=accepted");
    await expect(page.getByText("Demo: status updates are manual; no GPS")).toBeVisible();
    const card = page.locator('[data-booking-id="TAKI874523"]');
    await expect(card).toContainText("Customer: Arjun K.");
    await expect(card.getByTestId("request-earnings")).toHaveText("₹4,500");

    await card.getByRole("button", { name: /^Mark out for delivery/ }).click();
    await expect(card.getByRole("button", { name: /^Mark delivered/ })).toBeVisible();
    await card.getByRole("button", { name: /^Mark delivered/ }).click();
    const dialog = page.getByRole("dialog", { name: "Mark this shipment delivered?" });
    await expect(dialog).toContainText("₹4,500 will be credited to your TAKI balance.");
    await dialog.getByRole("button", { name: "Mark delivered" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-booking-id="TAKI874523"]')).toContainText("Earnings credited");

    await navTo(page, "Earnings");
    await expect(page.getByTestId("available-payout")).toHaveText("₹33,000");
    await expect(page.getByTestId("earnings-this-month")).toHaveText("₹33,000");
    await expect(page.getByTestId("earnings-total")).toHaveText("₹1,90,700");
    await expect(page.getByTestId("settlement-row").first()).toContainText("TAKI874523");
    await navTo(page, "Dashboard");
    await expect(page.getByTestId("earnings-amount")).toHaveText("₹33,000");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a future-dated confirmed booking can't be picked up yet", async ({ page }) => {
    await seed(page, "ravi");
    await page.goto("/driver/bookings?tab=accepted");
    const lakshmi = page.locator('[data-booking-id="TAKI874611"]'); // r1, departs T+1
    await expect(lakshmi).toContainText("Customer: Lakshmi V.");
    // driver-flow §7: Mark Picked Up is guarded by today ≥ travelDate (disabled "Available on <date>").
    await expect(lakshmi.getByRole("button", { name: /^Mark picked up/ })).toBeDisabled();
    await expect(lakshmi).toContainText(/Available on /);
  });

  test("earnings summary and demo withdrawal with limits", async ({ page }) => {
    const errors = watchConsole(page);
    await seed(page, "ravi");
    await page.goto("/driver/earnings");
    const available = page.getByTestId("available-payout");
    await expect(available).toHaveText("₹28,500");
    await expect(page.getByTestId("earnings-this-month")).toHaveText("₹28,500");
    await expect(page.getByTestId("earnings-last-month")).toHaveText("₹25,400");
    await expect(page.getByTestId("earnings-total")).toHaveText("₹1,86,200");
    const settlement = page.getByTestId("settlement-row").filter({ hasText: "TAKI874391" });
    await expect(settlement).toContainText("₹6,226");
    await expect(settlement).toContainText("Paid");

    await page.getByRole("button", { name: "Withdraw" }).click();
    const dialog = page.getByRole("dialog", { name: "Withdraw earnings" });
    await expect(dialog.getByText("Demo payout — no money moves")).toBeVisible();
    const amount = dialog.getByLabel("Amount");
    const confirm = dialog.getByRole("button", { name: "Confirm withdrawal" });
    await amount.fill("99");
    await confirm.click();
    await expect(dialog.getByRole("alert")).toHaveText("Minimum withdrawal is ₹100");
    await amount.fill("28501");
    await confirm.click();
    await expect(dialog.getByRole("alert")).toHaveText(/28,500/);
    await expect(available).toHaveText("₹28,500");
    await amount.fill("10000");
    await confirm.click();
    await expect(dialog).toBeHidden();
    await expect(available).toHaveText("₹18,500");
    await expect(page.getByTestId("payout-history")).toContainText("₹10,000");
    await expect(page.getByTestId("payout-history")).toContainText("Demo");
    await expect(page.getByTestId("earnings-this-month")).toHaveText("₹28,500");
    await expect(page.getByTestId("earnings-total")).toHaveText("₹1,86,200");

    expect(errors, errors.join("\n")).toEqual([]);
  });
});

// ───────────────────────────── 3. Invalid cases ─────────────────────────────

test.describe("T3 invalid cases", () => {
  async function openForm(page: Page) {
    await seed(page, "ravi");
    await page.goto("/driver/routes/new");
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("coimbatore");
  }
  const next = (page: Page) => page.getByRole("button", { name: "Next: Set Pricing" }).click();

  test("route form rejects same cities, bad capacities, past date, missing time", async ({ page }) => {
    const errors = watchConsole(page);
    await openForm(page);
    await page.getByLabel("To", { exact: true }).selectOption("coimbatore");
    await page.getByLabel("Available Capacity").fill("3500");
    await page.getByLabel("Travel Date").fill(istDate(-1));
    await next(page);
    await expect(page.getByText("From and To must be different cities")).toBeVisible();
    await expect(page.getByText("Available capacity can't exceed total capacity")).toBeVisible();
    await expect(page.getByText("Travel date can't be in the past")).toBeVisible();
    await expect(page).toHaveURL(/\/driver\/routes\/new$/);

    await page.getByLabel("Total Capacity").fill("5000");
    await expect(page.getByText("Total capacity can't exceed this vehicle's 3,000 kg limit")).toBeVisible();
    await page.getByLabel("Total Capacity").fill("-100");
    await expect(page.getByText("Enter a whole number of kg, e.g. 3000")).toBeVisible();
    await page.getByLabel("Total Capacity").fill("0");
    await expect(page.getByText("Total capacity must be at least 100 kg")).toBeVisible();
    await page.getByLabel("Available Capacity").fill("0");
    await expect(page.getByText("Available capacity must be at least 100 kg")).toBeVisible();
    await page.getByLabel("Available Capacity").fill("12.5");
    await expect(page.getByLabel("Available Capacity")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Travel Date").fill(istDate(61));
    await expect(page.getByText(/Travel date must be within the next 60 days/)).toBeVisible();
    await expect(page).toHaveURL(/\/driver\/routes\/new$/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a draft without a departure time can't continue", async ({ page }) => {
    await seed(page, "ravi", {
      routeDraft: {
        originCityId: "coimbatore",
        destinationCityId: "chennai",
        stopCityIds: [],
        travelDate: istDate(4),
        vehicleId: "veh_raj",
        totalCapacityKg: 3000,
        offeredCapacityKg: 2000,
      },
    });
    await page.goto("/driver/routes/new");
    await expect(page.getByLabel("Departure Time")).toHaveValue("");
    await next(page);
    await expect(page.getByText("Choose a departure time")).toBeVisible();
    await expect(page).toHaveURL(/\/driver\/routes\/new$/);
    // Pricing guard also rejects the incomplete draft.
    await page.goto("/driver/routes/new/pricing");
    await expect(page).toHaveURL(/\/driver\/routes\/new$/);
  });

  test("a stop can't duplicate an endpoint; same-day departure needs 1 h lead", async ({ page }) => {
    await openForm(page);
    // Stops are Salem, Vellore by default; make Salem the From city → stop duplicates an endpoint.
    await page.getByLabel("From", { exact: true }).selectOption("salem");
    await next(page);
    await expect(page.getByText("Each stop must be a different city, and not your From or To city")).toBeVisible();
    await expect(page).toHaveURL(/\/driver\/routes\/new$/);
    await page.getByLabel("From", { exact: true }).selectOption("coimbatore");
    await page.getByLabel("Travel Date").fill(istDate(0));
    await page.getByLabel("Departure Time").selectOption("00:00");
    await next(page);
    await expect(page.getByText("Departure must be at least 1 hour from now")).toBeVisible();
  });

  test("the same vehicle can't get a second route on the same date", async ({ page }) => {
    await openForm(page);
    await page.getByLabel("Vehicle Type").selectOption("veh_raj");
    await page.getByLabel("Travel Date").fill(istDate(1)); // rte_r1 runs veh_raj on T+1
    await next(page);
    await expect(page.getByText(/^Tata 407 \(TN 37 XX 4587\) already has a route on /)).toBeVisible();
    await expect(page).toHaveURL(/\/driver\/routes\/new$/);
  });

  test("pricing rejects invalid rates and blocks publish", async ({ page }) => {
    const errors = watchConsole(page);
    await seed(page, "ravi", {
      routeDraft: {
        originCityId: "coimbatore",
        destinationCityId: "chennai",
        stopCityIds: ["salem", "vellore"],
        travelDate: istDate(4),
        departureTime: "08:00",
        vehicleId: "veh_raj",
        totalCapacityKg: 3000,
        offeredCapacityKg: 2000,
      },
    });
    await page.goto("/driver/routes/new/pricing");
    const km = page.getByLabel("Per Kilometre Rate");
    const kg = page.getByLabel("Per Kilogram Rate");
    const publish = page.getByRole("button", { name: "Publish Route" });
    const cases: Array<[Locator, string, RegExp]> = [
      [km, "-5", /can't be negative/],
      [km, "0", /Per kilometre rate must be between ₹1(\.00)? and ₹100/],
      [km, "abc", /Enter a number, e.g. 12 or 0.50/],
      [km, "12.345", /Use up to 2 decimal places/],
      [km, "100.01", /Per kilometre rate must be between/],
      [kg, "-1", /can't be negative/],
      [kg, "20.5", /Per kilogram rate must be between ₹0(\.00)? and ₹20/],
      [kg, "", /Enter your per kilogram rate/],
    ];
    for (const [input, value, message] of cases) {
      await km.fill("12");
      await kg.fill("0.50");
      await expect(publish).toBeEnabled();
      await input.fill(value);
      await expect(page.getByRole("alert").filter({ hasText: message }), `${value}`).toBeVisible();
      await expect(page.getByTestId("preview-earnings")).toHaveText("—");
      await expect(publish).toBeDisabled();
    }
    // Boundaries are accepted.
    await km.fill("1");
    await kg.fill("0");
    await expect(page.getByTestId("preview-earnings")).toHaveText("₹498");
    await km.fill("100");
    await kg.fill("20");
    await expect(page.getByTestId("preview-earnings")).toHaveText("₹59,800");
    await expect(publish).toBeEnabled();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("double-click Publish creates a single route (S-7)", async ({ page }) => {
    await seed(page, "ravi", {
      routeDraft: {
        originCityId: "coimbatore",
        destinationCityId: "chennai",
        stopCityIds: ["salem"],
        travelDate: istDate(6),
        departureTime: "09:00",
        vehicleId: "veh_raj",
        totalCapacityKg: 3000,
        offeredCapacityKg: 1500,
      },
    });
    await page.goto("/driver/routes/new/pricing");
    await expect(page.getByTestId("preview-earnings")).not.toHaveText("—");
    await page.getByRole("button", { name: "Publish Route" }).dblclick();
    await expect(page).toHaveURL(/\/driver\/routes/, { timeout: 15_000 });
    await expect(page.getByTestId("route-card").filter({ hasText: "Coimbatore → Salem → Chennai" })).toHaveCount(1);
    await expect(page.getByTestId("route-card")).toHaveCount(4); // r0, r1, r2 + new
  });

  test("pricing without a draft redirects to Add Route", async ({ page }) => {
    await seed(page, "ravi");
    await page.goto("/driver/routes/new/pricing");
    await expect(page).toHaveURL(/\/driver\/routes\/new$/);
  });

  test("customer is kept out of /driver/*; logged-out visit goes to login with next", async ({ page, context }) => {
    await seed(page, "arjun");
    for (const path of ["/driver/dashboard", "/driver/bookings", "/driver/earnings", "/driver/routes/new"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/customer\/dashboard$/);
    }
    await context.clearCookies();
    const anon = await context.newPage();
    await anon.addInitScript(() => localStorage.removeItem("taki-demo-v1"));
    await anon.goto("/driver/earnings");
    await expect(anon).toHaveURL(/\/auth\/login\?next=%2Fdriver%2Fearnings/);
    await anon.getByRole("button", { name: "Fill demo driver" }).click();
    await anon.getByLabel("Password", { exact: true }).fill("Taki@2025");
    await anon.getByRole("button", { name: "Log In" }).click();
    await expect(anon).toHaveURL(/\/driver\/earnings$/, { timeout: 15_000 });
  });
});

// ───────────────────────────── 4. Navigation ─────────────────────────────

test.describe("T3 driver navigation", () => {
  test("sidebar, stat cards and help links reach real pages without console errors", async ({ page }) => {
    const errors = watchConsole(page);
    await seed(page, "ravi");
    await page.goto("/driver/dashboard");
    const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).first();
    const items: Array<[string, RegExp, RegExp]> = [
      ["My Routes", /\/driver\/routes$/, /My Routes/],
      ["Booking Requests", /\/driver\/bookings$/, /Booking Requests/],
      ["Earnings", /\/driver\/earnings$/, /Earnings/],
      ["Profile", /\/driver\/profile$/, /Profile/],
      ["Help", /\/driver\/help$/, /Help/],
      ["Dashboard", /\/driver\/dashboard$/, /Hi, Ravi/],
    ];
    for (const [label, url, h1] of items) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
      await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.getByText(/This page could not be found|404/)).toHaveCount(0);
    }

    const tiles: Array<[RegExp, RegExp]> = [
      [/Active Routes/, /\/driver\/routes$/],
      [/Booking Requests/, /\/driver\/bookings$/],
      [/Completed Trips/, /\/driver\/routes\?status=completed$/],
      [/Available Capacity/, /\/driver\/routes$/],
    ];
    for (const [name, url] of tiles) {
      await page.goto("/driver/dashboard");
      await stat(page, name).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    await page.goto("/driver/dashboard");
    await page.getByTestId("earnings-hero").click();
    await expect(page).toHaveURL(/\/driver\/earnings$/);

    // Help: FAQ accordion + action links.
    await page.goto("/driver/help");
    // FAQ is a native <details> accordion (approved deviation, D-25 updated — R-02 closed).
    const faq = page.locator("details").filter({ hasText: "How does capacity work?" });
    await expect(faq).not.toHaveAttribute("open", "");
    await faq.locator("summary").click();
    await expect(faq).toHaveAttribute("open", "");
    await expect(page.locator("details").filter({ hasText: "How is my price calculated?" })).toContainText(/per-km|per km|kilomet/i);
    const main = page.getByRole("main");
    const helpLinks = await main.getByRole("link").evaluateAll((els) =>
      els.map((a) => ({ href: a.getAttribute("href") ?? "", rel: a.getAttribute("rel"), target: a.getAttribute("target") })),
    );
    for (const l of helpLinks) {
      if (l.target === "_blank") expect(l.rel ?? "").toContain("noopener");
      if (l.href.startsWith("/")) {
        const res = await page.request.get(l.href);
        expect(res.status(), l.href).toBeLessThan(400);
      }
    }
    await main.getByRole("link", { name: /Post a New Route/ }).click();
    await expect(page).toHaveURL(/\/driver\/routes\/new$/);
    await page.goto("/driver/help");
    await main.getByRole("link", { name: /Booking Requests|View requests/ }).first().click();
    await expect(page).toHaveURL(/\/driver\/bookings/);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
