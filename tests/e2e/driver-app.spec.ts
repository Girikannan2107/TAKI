import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

/**
 * v2 driver app (D4): dashboard, assigned shipments, shipment action screen (pickup OTP), trip run,
 * history and profile. Needs `npm run seed` (demo accounts, an approved driver with assigned trips and
 * paid bookings). Override the demo credentials with E2E_* env vars if the seed changes.
 *
 * Read-only checks run in every viewport project; the one state-changing journey (pickup with the
 * customer's OTP) runs only in "desktop" so parallel projects don't race for the same booking.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "Taki@2026";
const DRIVER_PHONE = process.env.E2E_DRIVER_PHONE ?? "9876543211";
const CUSTOMER_PHONE = process.env.E2E_CUSTOMER_PHONE ?? "9876543210";

function isNarrow(info: TestInfo): boolean {
  return (info.project.use.viewport?.width ?? 1440) < 1024;
}

async function apiLogin(request: APIRequestContext, baseURL: string, role: "driver" | "customer", phone: string) {
  const res = await request.post("/api/auth/login", { headers: { origin: baseURL }, data: { role, phone, password: PASSWORD } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Signs the page's browser context in as the demo driver (cookie set by the API). */
async function loginDriver(page: Page, baseURL: string) {
  await apiLogin(page.request, baseURL, "driver", DRIVER_PHONE);
}

test.describe("driver app", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginDriver(page, baseURL!);
  });

  test("dashboard: greeting, 4 stats, current trip and the right navigation for the viewport", async ({ page }, info) => {
    await page.goto("/driver");
    await expect(page).toHaveURL(/\/driver\/dashboard/);
    await expect(page.getByRole("heading", { level: 1, name: /^Hi, / })).toBeVisible();
    for (const label of ["Active trips", "Pending pickups", "In transit", "Completed deliveries"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    for (const name of ["Dashboard", "Assigned Shipments", "History", "Profile"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    if (isNarrow(info)) {
      // Bottom tab bar, no hamburger.
      await expect(page.getByRole("button", { name: "Open menu" })).toHaveCount(0);
    }

    // No horizontal scroll at any width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("assigned shipments: three tabs in the URL, cards link to the action screen", async ({ page }, info) => {
    await page.goto("/driver/shipments");
    await expect(page.getByRole("heading", { level: 1, name: "Assigned shipments" })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Shipment status" });
    await expect(tabs.getByRole("tab", { name: "To pick up" })).toHaveAttribute("aria-selected", "true");

    await tabs.getByRole("tab", { name: "In transit" }).click();
    await expect(page).toHaveURL(/tab=transit/);
    await tabs.getByRole("tab", { name: "Delivered" }).click();
    await expect(page).toHaveURL(/tab=delivered/);

    await page.goto("/driver/shipments?tab=pickup");
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByRole("article").first().or(panel.getByRole("heading", { name: "Nothing to pick up" }))).toBeVisible();
    const first = panel.getByRole("article").first();
    if (await first.count()) {
      await first.getByRole("link").click();
      await expect(page).toHaveURL(/\/driver\/shipments\/TAKI\d{6}/);
      await expect(page.getByRole("heading", { level: 2, name: "Customer" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Receiver" })).toBeVisible();
      await expect(page.getByRole("link", { name: /Open in Maps/ }).first()).toHaveAttribute("target", "_blank");
      // The bottom nav gives way to the sticky action bar on action screens.
      await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(isNarrow(info) ? 0 : 1);
    }
  });

  test("wrong pickup OTP is rejected inline and nothing changes", async ({ page }) => {
    const list = await page.request.get("/api/driver/shipments?tab=pending_pickup");
    expect(list.ok()).toBeTruthy();
    const { items } = (await list.json()) as { items: Array<{ bookingId: string }> };
    test.skip(items.length === 0, "seed has no shipment waiting for pickup");
    const id = items[0]!.bookingId;

    await page.goto(`/driver/shipments/${id}`);
    await page.getByRole("button", { name: "Confirm pickup" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirm pickup" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Digit 1 of 6").click();
    await page.keyboard.type("000000");
    await dialog.getByRole("button", { name: "Confirm pickup" }).click();
    await expect(dialog.getByRole("alert")).toContainText(/incorrect|attempts|new code/i);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    const after = await page.request.get(`/api/driver/shipments/${id}`);
    expect(((await after.json()) as { status: string }).status).toBe("confirmed");
  });

  test("pickup with the customer's OTP moves the shipment to Picked up", async ({ page, baseURL, playwright }, info) => {
    test.skip(info.project.name !== "desktop", "state-changing journey runs once (desktop)");
    const list = await page.request.get("/api/driver/shipments?tab=pending_pickup");
    const { items } = (await list.json()) as { items: Array<{ bookingId: string }> };

    // Find a pickup that belongs to the demo customer, so we can read the OTP the customer sees.
    const customer = await playwright.request.newContext({ baseURL });
    await apiLogin(customer, baseURL!, "customer", CUSTOMER_PHONE);
    let target: { id: string; otp: string } | null = null;
    for (const it of items) {
      const r = await customer.get(`/api/customer/bookings/${it.bookingId}`);
      if (!r.ok()) continue;
      const b = (await r.json()) as { otps: { pickup: string | null } | null };
      if (b.otps?.pickup) {
        target = { id: it.bookingId, otp: b.otps.pickup };
        break;
      }
    }
    await customer.dispose();
    test.skip(!target, "no pickup of the demo customer is waiting");

    await page.goto(`/driver/shipments/${target!.id}`);
    await page.getByRole("button", { name: "Confirm pickup" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirm pickup" });
    await dialog.getByLabel("Digit 1 of 6").click();
    await page.keyboard.type(target!.otp);
    await dialog.getByLabel("Remarks").fill("2 boxes, sealed");
    await dialog.getByRole("button", { name: "Confirm pickup" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Pickup confirmed")).toBeVisible();
    await expect(page.getByText("Picked up", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("2 boxes, sealed")).toBeVisible();
  });

  test("trip run lists the route in order and offers only the next step", async ({ page }) => {
    const res = await page.request.get("/api/driver/dashboard");
    const d = (await res.json()) as { nextTrip: { id: string } | null };
    test.skip(!d.nextTrip, "seed has no trip for the demo driver");

    await page.goto(`/driver/trips/${d.nextTrip!.id}`);
    await expect(page.getByRole("heading", { level: 2, name: "Route" })).toBeVisible();
    const rows = page.getByRole("list").filter({ has: page.getByText("Source") }).getByRole("listitem");
    await expect(rows.first()).toContainText("Source");
    await expect(rows.last()).toContainText("Destination");
    // At most one primary step button in the sticky bar.
    const step = page.getByRole("button", { name: /^(Start trip|Arrived at .+|Departed .+|Complete trip)$/ });
    expect(await step.count()).toBeLessThanOrEqual(1);
  });

  test("history: search and month filter live in the URL", async ({ page }) => {
    await page.goto("/driver/history");
    await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
    await page.getByLabel("Booking ID").fill("TAKI000000");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/q=TAKI000000/);
    await expect(page.getByRole("heading", { name: "No deliveries match" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/q=/);
    await page.getByLabel("Month").selectOption({ index: 1 });
    await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
  });

  test("profile: details, agency, documents and reviews; documents page opens", async ({ page }) => {
    await page.goto("/driver/profile");
    await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
    for (const name of ["Your details", "Agency", "Documents", "Ratings and reviews"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    await page.getByRole("link", { name: "Manage documents" }).click();
    await expect(page).toHaveURL(/\/driver\/profile\/documents/);
    await expect(page.getByRole("heading", { level: 1, name: "Your documents" })).toBeVisible();
  });
});

test.describe("driver app access", () => {
  test("guests are sent to the driver login", async ({ page }) => {
    await page.goto("/driver/dashboard");
    await expect(page).toHaveURL(/\/auth\/login\?.*role=driver/);
  });

  test("driver APIs refuse guests (401) and customers (403)", async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    expect((await ctx.get("/api/driver/dashboard")).status()).toBe(401);
    await apiLogin(ctx, baseURL!, "customer", CUSTOMER_PHONE);
    expect((await ctx.get("/api/driver/dashboard")).status()).toBe(403);
    expect((await ctx.post("/api/driver/shipments/TAKI000001/pickup", { headers: { origin: baseURL! }, data: { otp: "123456" } })).status()).toBe(403);
    await ctx.dispose();
  });
});
