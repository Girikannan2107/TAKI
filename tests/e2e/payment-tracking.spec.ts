import { expect, test, type Page } from "@playwright/test";

/** Demo state injected before the app boots (db absent → the store seeds fresh data). Same shape as booking.spec.ts. */
function seedState(withSearch: boolean) {
  const now = Date.now();
  const tomorrowIst = new Date(now + 5.5 * 3600e3 + 864e5).toISOString().slice(0, 10);
  const state: Record<string, unknown> = {
    session: {
      accountId: "usr_arjun",
      role: "customer",
      profileId: "cus_arjun",
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 864e5).toISOString(),
    },
  };
  if (withSearch) state.search = { sourceCityId: "coimbatore", destinationCityId: "chennai", weightKg: 500, pickupDate: tomorrowIst };
  return JSON.stringify({ state, version: 1 });
}

async function signIn(page: Page, withSearch = true) {
  await page.addInitScript((value) => {
    // Only on the first load of the test: later navigations keep the app's own state.
    if (!sessionStorage.getItem("pay-spec-seeded")) {
      localStorage.setItem("taki-demo-v1", value);
      sessionStorage.setItem("pay-spec-seeded", "1");
    }
  }, seedState(withSearch));
}

/** /customer/booking/rte_r1 → Book → payment page. Returns the booking id. */
async function startPayment(page: Page): Promise<string> {
  await signIn(page);
  await page.goto("/customer/booking/rte_r1");
  await page.getByRole("button", { name: /Book This Vehicle/ }).click();
  await page.waitForURL(/\/customer\/payment\?bookingId=TAKI\d{6}/);
  await expect(page.getByRole("heading", { level: 1, name: "Payment" })).toBeVisible();
  return new URL(page.url()).searchParams.get("bookingId")!;
}

test.describe("Payment, confirmation and payments history", () => {
  test("double-click Pay places exactly one booking payment", async ({ page }) => {
    const bookingId = await startPayment(page);

    await expect(page.getByTestId("price-total")).toHaveText("₹4,850");
    await expect(page.getByRole("group", { name: "Choose Payment Method" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "UPI (GPay, PhonePe, Paytm)" })).toBeChecked();
    await expect(page.getByText("Demo payment — no money moves")).toBeVisible();
    // No card / UPI / bank detail inputs anywhere.
    await expect(page.getByRole("textbox")).toHaveCount(0);

    const pay = page.getByRole("button", { name: "Pay ₹4,850" });
    await pay.dblclick();
    await page.waitForURL(/\/customer\/booking-confirmation\?bookingId=/);
    await expect(page.getByRole("heading", { level: 1, name: "Booking placed!" })).toBeVisible();
    await expect(page.getByTestId("booking-status")).toHaveText("Awaiting driver confirmation");
    await expect(page.getByTestId("booking-id")).toHaveText(bookingId);
    await expect(page.getByTestId("amount-paid")).toHaveText("₹4,850");

    await page.goto("/customer/payments");
    await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
    const rows = page.locator(`[data-testid="payment-row"][data-booking-id="${bookingId}"]`);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Paid");
    await expect(rows.first()).toContainText("Demo");
  });

  test("simulated failure shows an error, then a retry succeeds", async ({ page }) => {
    const bookingId = await startPayment(page);

    const failBox = page.getByRole("checkbox", { name: /Simulate a failed payment \(demo\)/ });
    await failBox.check();
    await page.getByRole("button", { name: "Pay ₹4,850" }).click();
    await expect(page.getByTestId("payment-error")).toHaveText("Payment failed (demo). You can try again.");
    await expect(page.getByRole("button", { name: "Pay ₹4,850" })).toBeEnabled();

    await failBox.uncheck();
    await page.getByRole("button", { name: "Pay ₹4,850" }).click();
    await page.waitForURL(/\/customer\/booking-confirmation\?bookingId=/);
    await expect(page.getByRole("heading", { level: 1, name: "Booking placed!" })).toBeVisible();

    await page.goto("/customer/payments");
    const rows = page.locator(`[data-testid="payment-row"][data-booking-id="${bookingId}"]`);
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Paid" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Failed" })).toHaveCount(1);
  });
});

test.describe("Track Shipment", () => {
  test("a new booking shows the awaiting step; simulate moves it to Booking Confirmed", async ({ page }) => {
    await startPayment(page);
    await page.getByRole("button", { name: "Pay ₹4,850" }).click();
    await page.waitForURL(/\/customer\/booking-confirmation\?bookingId=/);
    await page.getByRole("link", { name: /Track Shipment/ }).click();
    await page.waitForURL(/\/customer\/tracking\/TAKI\d{6}/);
    await expect(page.getByRole("heading", { level: 1, name: "Track Shipment" })).toBeVisible();

    const steps = page.getByTestId("timeline-step");
    await expect(steps).toHaveCount(6);
    await expect(steps.first()).toContainText("Payment received · awaiting driver confirmation");
    await expect(steps.first()).toHaveAttribute("aria-current", "step");

    await page.getByRole("button", { name: "Demo: simulate next update" }).click();
    const current = page.locator('[data-testid="timeline-step"][aria-current="step"]');
    await expect(current).toContainText("Booking Confirmed");
    await expect(steps).toHaveCount(5);
    await expect(page.getByTestId("tracking-status")).toHaveText("Booking Confirmed");
  });

  test("TAKI874523 is in transit; View Route opens the illustrative map", async ({ page }) => {
    await signIn(page, false);
    await page.goto("/customer/tracking/TAKI874523");
    await expect(page.getByRole("heading", { level: 1, name: "Track Shipment" })).toBeVisible();
    await expect(page.getByTestId("booking-id")).toHaveText("TAKI874523");

    const steps = page.getByTestId("timeline-step");
    await expect(steps).toHaveCount(5);
    const current = page.locator('[data-testid="timeline-step"][aria-current="step"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText("In Transit");
    await expect(current).toContainText("On the way to Chennai");
    await expect(steps.nth(3)).toContainText(/Expected: \d{1,2} \w{3}, \d{2}:\d{2} (AM|PM)/);
    await expect(page.getByText(/View Live Route/)).toHaveCount(0);

    await page.getByRole("button", { name: "View Route" }).click();
    const dialog = page.getByRole("dialog", { name: "Route" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Illustrative route — not live location").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("unknown booking shows Shipment not found", async ({ page }) => {
    await signIn(page, false);
    await page.goto("/customer/tracking/TAKI000000");
    await expect(page.getByRole("heading", { name: "Shipment not found" })).toBeVisible();
  });
});
