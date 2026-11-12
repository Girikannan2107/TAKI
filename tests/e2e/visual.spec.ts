import { requestAcceptAndOpenPayment } from "./booking-flow";
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * T1 visual fidelity capture. Not an assertion suite: it saves full-page screenshots of every
 * implemented screen at desktop (1440x900) and mobile (390x844) for side-by-side comparison with
 * references/screens/NN-name.png. Output: test-results/visual/<NN-name>-<viewport>.png
 */

const BOARD_NOW = new Date("2025-11-19T10:00:00+05:30");
const TRACK_NOW = new Date("2025-11-20T14:00:00+05:30");

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;
type Vp = keyof typeof VIEWPORTS;

function session(role: "customer" | "driver", now: Date) {
  const base =
    role === "customer"
      ? { accountId: "usr_arjun", role: "customer", profileId: "cus_arjun" }
      : { accountId: "usr_ravi", role: "driver", profileId: "drv_ravi" };
  return { ...base, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 7 * 864e5).toISOString() };
}

const SEARCH = { sourceCityId: "coimbatore", destinationCityId: "chennai", weightKg: 500, pickupDate: "2025-11-20" };
const ROUTE_DRAFT = {
  originCityId: "coimbatore",
  destinationCityId: "chennai",
  stopCityIds: ["salem", "vellore"],
  travelDate: "2025-11-22",
  departureTime: "08:00",
  vehicleId: "veh_raj",
  totalCapacityKg: 3000,
  offeredCapacityKg: 2000,
};

async function prepare(page: Page, vp: Vp, now: Date, state: Record<string, unknown> | null) {
  await page.setViewportSize(VIEWPORTS[vp]);
  await page.clock.setFixedTime(now);
  if (state) {
    await page.addInitScript((value) => {
      if (!sessionStorage.getItem("visual-seeded")) {
        localStorage.setItem("taki-demo-v1", value);
        sessionStorage.setItem("visual-seeded", "1");
      }
    }, JSON.stringify({ state, version: 1 }));
  }
}

async function shot(page: Page, name: string, vp: Vp) {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  // Guard: never save an unstyled capture (e.g. while the server is being rebuilt).
  const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(font, "app stylesheet must be applied").not.toMatch(/^"?Times/);
  // Let lazy images decode and entrance transitions finish.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  // Bounded wait for images (lazy images that never load must not hang the capture).
  await page
    .waitForFunction(() => Array.from(document.images).every((img) => img.complete), null, { timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  // Record horizontal overflow (page-level and any clipped scroll strips) for the audit.
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const strips = Array.from(document.querySelectorAll<HTMLElement>("main *"))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible")
      .map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute("role") ?? el.className.toString().slice(0, 40)}] ${el.scrollWidth}/${el.clientWidth}`);
    return { page: `${doc.scrollWidth}/${doc.clientWidth}`, strips };
  });
  fs.mkdirSync("test-results/t1/overflow", { recursive: true });
  fs.writeFileSync(`test-results/t1/overflow/${name}-${vp}.json`, JSON.stringify(overflow));
  await page.screenshot({ path: `test-results/visual/${name}-${vp}.png`, fullPage: true, animations: "disabled" });
}

for (const vp of Object.keys(VIEWPORTS) as Vp[]) {
  test.describe(`visual ${vp}`, () => {
    test("01 landing", async ({ page }) => {
      await prepare(page, vp, BOARD_NOW, null);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, "01-landing", vp);
    });

    test("02 role selection", async ({ page }) => {
      await prepare(page, vp, BOARD_NOW, null);
      await page.goto("/signup");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, "02-role-selection", vp);
    });

    test("03 mobile number + 04 otp + 05 create password", async ({ page }) => {
      await prepare(page, vp, BOARD_NOW, null);
      await page.goto("/auth/phone?flow=signup&role=customer");
      await expect(page.getByLabel("Mobile number")).toBeVisible();
      await shot(page, "03-mobile-number", vp);
      await page.getByLabel("Mobile number").fill("9876500001");
      await page.getByRole("button", { name: "Send OTP" }).click();
      await expect(page).toHaveURL(/\/auth\/verify-otp/);
      const code = (await page.getByTestId("demo-otp-code").textContent())?.trim() ?? "";
      await shot(page, "04-verify-otp", vp);
      await page.getByLabel("Digit 1 of 6").click();
      await page.keyboard.type(code);
      await expect(page).toHaveURL(/\/auth\/create-password/);
      await expect(page.getByLabel("Full name")).toBeVisible();
      await shot(page, "05-create-password", vp);
    });

    test("03b login", async ({ page }) => {
      await prepare(page, vp, BOARD_NOW, null);
      await page.goto("/auth/login");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, "03b-login", vp);
    });

    test("06 customer dashboard", async ({ page }) => {
      await prepare(page, vp, BOARD_NOW, { session: session("customer", BOARD_NOW) });
      await page.goto("/customer/dashboard");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, "06-customer-dashboard", vp);
    });

    test("07 available vehicles", async ({ page }) => {
      await prepare(page, vp, BOARD_NOW, { session: session("customer", BOARD_NOW), search: SEARCH });
      await page.goto("/customer/vehicles?from=coimbatore&to=chennai&weight=500&date=2025-11-20");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, "07-available-vehicles", vp);
    });

    test("08 booking details + 09 payment", async ({ page }) => {
      await prepare(page, vp, BOARD_NOW, { session: session("customer", BOARD_NOW), search: SEARCH });
      await page.goto("/customer/booking/rte_r1");
      await expect(page.getByRole("heading", { level: 1, name: "Route & Booking Details" })).toBeVisible();
      await shot(page, "08-route-booking-details", vp);
      await requestAcceptAndOpenPayment(page);
      await shot(page, "09-payment", vp);
    });

    test("10 track shipment", async ({ page }) => {
      await prepare(page, vp, TRACK_NOW, { session: session("customer", TRACK_NOW) });
      await page.goto("/customer/tracking/TAKI874523");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, "10-track-shipment", vp);
    });

    test("11 driver dashboard", async ({ page }) => {
      await prepare(page, vp, BOARD_NOW, { session: session("driver", BOARD_NOW) });
      await page.goto("/driver/dashboard");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, "11-driver-dashboard", vp);
    });

    test("12 add new route", async ({ page }) => {
      await prepare(page, vp, BOARD_NOW, { session: session("driver", BOARD_NOW) });
      await page.goto("/driver/routes/new");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, "12-add-new-route", vp);
    });

    test("13 set pricing", async ({ page }) => {
      await prepare(page, vp, BOARD_NOW, { session: session("driver", BOARD_NOW), routeDraft: ROUTE_DRAFT });
      await page.goto("/driver/routes/new/pricing");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, "13-set-pricing", vp);
    });

    test("14 booking requests", async ({ page }) => {
      await prepare(page, vp, BOARD_NOW, { session: session("driver", BOARD_NOW) });
      await page.goto("/driver/bookings");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, "14-booking-requests", vp);
    });

    test("15 earnings", async ({ page }) => {
      await prepare(page, vp, BOARD_NOW, { session: session("driver", BOARD_NOW) });
      await page.goto("/driver/earnings");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, "15-earnings", vp);
    });
  });
}

// Hero sharpness probe across the md–lg band (viewport-only, DPR 1): records which srcset candidate
// the browser picked vs. the rendered width, to catch upscaled (soft) hero photos.
test("01 landing hero probe", async ({ page }) => {
  const out: unknown[] = [];
  fs.mkdirSync("test-results/t1/probe", { recursive: true });
  for (const width of [768, 900, 1024, 1100, 1180, 1279]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.waitForTimeout(1500);
    const info = await page.evaluate(async () => {
      const i = document.querySelector<HTMLImageElement>("section[aria-labelledby=hero-title] img")!;
      await Promise.race([i.decode().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
      const r = i.getBoundingClientRect();
      const p = i.parentElement!.getBoundingClientRect();
      const cs = getComputedStyle(i);
      return { complete: i.complete, natural: i.naturalWidth, src: i.currentSrc.split("?")[1], img: [r.x, r.y, r.width, r.height].map(Math.round), wrap: [p.x, p.y, p.width, p.height].map(Math.round), opacity: cs.opacity, vis: cs.visibility };
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/visual/01-landing-hero-${width}.png` });
    out.push({ width, ...info });
  }
  fs.writeFileSync("test-results/t1/probe/hero.json", JSON.stringify(out, null, 1));
});

// Re-test extras (Lead round 2).
for (const vp of Object.keys(VIEWPORTS) as Vp[]) {
  test(`extra toast above modal ${vp}`, async ({ page }) => {
    test.setTimeout(60_000);
    await prepare(page, vp, BOARD_NOW, { session: session("driver", BOARD_NOW) });
    await page.goto("/driver/earnings");
    await page.getByRole("button", { name: "Withdraw" }).click();
    const dialog = page.getByRole("dialog", { name: "Withdraw earnings" });
    await expect(dialog).toBeVisible();
    await page.getByLabel("Amount").fill("1000");
    await page.getByRole("button", { name: "Confirm withdrawal" }).click();
    const toast = page.getByText("Demo payout simulated — no money moved");
    await expect(toast).toBeVisible();
    await expect(dialog).toBeHidden();
    // Re-open the modal while the toast is still showing: the toast must stay on top.
    await page.getByRole("button", { name: "Withdraw" }).click();
    await expect(dialog).toBeVisible();
    await expect(toast).toBeVisible();
    await page.waitForTimeout(400);
    // Top layer: the toast region must be an open popover (painted above the modal <dialog>).
    const onTop = await toast.evaluate((el) => !!el.closest("[popover]")?.matches(":popover-open"));
    // Can the toast still be dismissed while the modal is open (inert check)?
    await page.screenshot({ path: `test-results/visual/x1-toast-over-modal-${vp}.png` });
    const inAxTree = await page.getByRole("button", { name: "Dismiss notification" }).count();
    const btn = page.locator('button[aria-label="Dismiss notification"]').first();
    const btnExists = await btn.count();
    await btn.click({ force: true, timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(500);
    const dismissible = !(await toast.isVisible());
    fs.mkdirSync("test-results/t1", { recursive: true });
    fs.writeFileSync(`test-results/t1/toast-over-modal-${vp}.json`, JSON.stringify({ onTop, inAxTree, btnExists, dismissible }));
    await page.screenshot({ path: `test-results/visual/x1-after-dismiss-click-${vp}.png` });
    expect(onTop, "toast is the topmost element at its centre while the modal is open").toBe(true);
  });

  test(`extra cancel booking ${vp}`, async ({ page }) => {
    await prepare(page, vp, TRACK_NOW, { session: session("customer", TRACK_NOW) });
    await page.goto("/customer/tracking/TAKI874640");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel booking" })).toBeVisible();
    await shot(page, "x2-tracking-awaiting-cancel", vp);
    await page.getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/visual/x2-cancel-dialog-${vp}.png` });
  });
}
