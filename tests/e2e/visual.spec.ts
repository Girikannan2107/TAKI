import { expect, test, type Page } from "@playwright/test";

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
  // Let lazy images decode and entrance transitions finish.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  // Bounded wait for images (lazy images that never load must not hang the capture).
  await page
    .waitForFunction(() => Array.from(document.images).every((img) => img.complete), null, { timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(400);
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
      await page.getByRole("button", { name: /Book This Vehicle/ }).click();
      await page.waitForURL(/\/customer\/payment\?bookingId=TAKI\w+/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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
