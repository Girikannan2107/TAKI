import { expect, test, type Page } from "@playwright/test";

const DAY = 864e5;

/** IST calendar date `days` from now ("YYYY-MM-DD"). */
function istDate(days: number): string {
  return new Date(Date.now() + 5.5 * 3600e3 + days * DAY).toISOString().slice(0, 10);
}

/** Driver (Ravi) session; db absent → the store seeds fresh demo data. */
function driverState(extra: Record<string, unknown> = {}) {
  const now = Date.now();
  return JSON.stringify({
    state: {
      session: {
        accountId: "usr_ravi",
        role: "driver",
        profileId: "drv_ravi",
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 7 * DAY).toISOString(),
      },
      ...extra,
    },
    version: 1,
  });
}

async function seed(page: Page, extra: Record<string, unknown> = {}) {
  await page.addInitScript((value) => {
    // Only on the first load of the test: later navigations keep the app's own state.
    if (!sessionStorage.getItem("d8-spec-seeded")) {
      localStorage.setItem("taki-demo-v1", value);
      sessionStorage.setItem("d8-spec-seeded", "1");
    }
  }, driverState(extra));
}

const ROUTE_DRAFT = {
  originCityId: "coimbatore",
  destinationCityId: "chennai",
  stopCityIds: ["salem", "vellore"],
  travelDate: istDate(3),
  departureTime: "08:00",
  vehicleId: "veh_raj",
  totalCapacityKg: 3000,
  offeredCapacityKg: 2000,
};

test.describe("Driver booking requests", () => {
  test("accepting fills the route; an over-capacity request can't be accepted", async ({ page }) => {
    await seed(page);
    await page.goto("/driver/bookings");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText("Booking Requests (5)");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    const cards = page.getByTestId("booking-request-card");
    await expect(cards).toHaveCount(5);
    const arjun = cards.filter({ hasText: "Customer: Arjun K." });
    await expect(arjun.getByRole("heading", { name: "Coimbatore → Chennai" })).toBeVisible();
    await expect(arjun.getByTestId("request-meta")).toContainText("300 kg");
    await expect(arjun.getByTestId("request-earnings")).toHaveText("₹4,194");
    await expect(arjun).toContainText("2,000 kg left on this route");

    await arjun.getByRole("button", { name: "Accept Coimbatore → Chennai request" }).click();
    await expect(page.getByText("Request accepted").first()).toBeVisible();
    await expect(h1).toHaveText("Booking Requests (4)");

    const meera = cards.filter({ hasText: "Customer: Meera S." });
    await expect(meera.getByTestId("request-meta")).toContainText("1,000 kg");
    await expect(meera).toContainText("1,700 kg left on this route");
    await meera.getByRole("button", { name: /^Accept / }).click();
    await expect(h1).toHaveText("Booking Requests (3)");

    const karthik = cards.filter({ hasText: "Customer: Karthik R." });
    const karthikAccept = karthik.getByRole("button", { name: /^Accept / });
    await expect(karthikAccept).toBeDisabled();
    await expect(karthik.getByTestId("capacity-reason")).toHaveText("Not enough capacity — 700 kg left, needs 1,200 kg");
    await expect(karthikAccept).toHaveAccessibleDescription("Not enough capacity — 700 kg left, needs 1,200 kg");
    await expect(karthik.getByRole("button", { name: /^Decline / })).toBeEnabled();

    // Accepted tab (kept in ?tab=) lists the accepted requests with their driver status.
    await page.getByRole("tab", { name: /^Accepted/ }).click();
    await expect(page).toHaveURL(/[?&]tab=accepted/);
    const accepted = page.locator('[data-testid="booking-request-card"][data-booking-id="TAKI874640"]');
    // Accepted → the customer now pays the final price; pickup only becomes possible once paid.
    await expect(accepted).toContainText("Accepted · awaiting payment");
    await expect(accepted.getByRole("button", { name: /^Mark picked up/ })).toHaveCount(0);

    // Dashboard tile reflects the same store.
    await page.goto("/driver/dashboard");
    await expect(page.getByTestId("driver-stats").getByRole("link", { name: /Booking Requests/ })).toContainText("03");
  });

  test("decline asks for confirmation and moves the request to Declined", async ({ page }) => {
    await seed(page);
    await page.goto("/driver/bookings");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText("Booking Requests (5)");

    const senthil = page.getByTestId("booking-request-card").filter({ hasText: "Customer: Senthil P." });
    await senthil.getByRole("button", { name: /^Decline / }).click();
    const dialog = page.getByRole("dialog", { name: "Decline this request?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("No payment has been taken yet.");
    await dialog.getByRole("button", { name: "Decline request" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Request declined").first()).toBeVisible();
    await expect(h1).toHaveText("Booking Requests (4)");

    await page.getByRole("tab", { name: /^Declined/ }).click();
    await expect(page.getByTestId("booking-request-card").filter({ hasText: "Customer: Senthil P." })).toContainText("Declined");
  });
});

test.describe("Set Pricing", () => {
  test("without a route draft it sends the driver back to Add Route", async ({ page }) => {
    await seed(page);
    await page.goto("/driver/routes/new/pricing");
    await page.waitForURL(/\/driver\/routes\/new$/);
  });

  test("live preview, validation and publish", async ({ page }) => {
    await seed(page, { routeDraft: ROUTE_DRAFT });
    await page.goto("/driver/routes/new/pricing");
    await expect(page.getByRole("heading", { level: 1, name: "Set Pricing" })).toBeVisible();
    await expect(page.getByText("Enter your rates for this route")).toBeVisible();

    const km = page.getByLabel("Per Kilometre Rate");
    const kg = page.getByLabel("Per Kilogram Rate");
    await expect(km).toHaveValue("12");
    await expect(kg).toHaveValue("0.50");

    const preview = page.getByTestId("price-preview");
    await expect(preview).toContainText("For 500 kg (≈ 498 km)");
    await expect(preview).toContainText("Distance charge (498 km × ₹12)");
    await expect(preview).toContainText("Weight charge (500 kg × ₹0.50)");
    await expect(page.getByTestId("preview-distance")).toHaveText("₹5,976");
    await expect(page.getByTestId("preview-weight")).toHaveText("₹250");
    await expect(page.getByTestId("preview-earnings")).toHaveText("₹6,226");
    await expect(page.getByText("The customer will see a final price with a small TAKI service fee added.")).toBeVisible();

    const publish = page.getByRole("button", { name: "Publish Route" });
    await km.fill("-5");
    await expect(page.getByRole("alert").filter({ hasText: "Per kilometre rate can't be negative" })).toBeVisible();
    await expect(page.getByTestId("preview-earnings")).toHaveText("—");
    await expect(publish).toBeDisabled();

    await km.fill("15");
    await expect(page.getByTestId("preview-distance")).toHaveText("₹7,470");
    await expect(page.getByTestId("preview-earnings")).toHaveText("₹7,720");

    await km.fill("12");
    await expect(page.getByTestId("preview-earnings")).toHaveText("₹6,226");
    await expect(publish).toBeEnabled();
    await publish.click();
    await page.waitForURL(/\/driver\/routes\?published=rte_\w+/);
  });
});

test.describe("Earnings", () => {
  test("summary, settlements and a demo withdrawal", async ({ page }) => {
    await seed(page);
    await page.goto("/driver/earnings");
    await expect(page.getByRole("heading", { level: 1, name: "Earnings" })).toBeVisible();
    const available = page.getByTestId("available-payout");
    await expect(available).toHaveText("₹28,500");
    await expect(page.getByTestId("earnings-this-month")).toHaveText("₹28,500");
    await expect(page.getByTestId("earnings-last-month")).toHaveText("₹25,400");
    await expect(page.getByTestId("earnings-total")).toHaveText("₹1,86,200");
    await expect(page.getByText("Paid = credited to your TAKI balance")).toBeVisible();
    const settlement = page.getByTestId("settlement-row").filter({ hasText: "TAKI874391" });
    await expect(settlement).toContainText("Coimbatore → Chennai");
    await expect(settlement).toContainText("₹6,226");
    await expect(settlement).toContainText("Paid");

    await page.getByRole("button", { name: "Withdraw" }).click();
    const dialog = page.getByRole("dialog", { name: "Withdraw earnings" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Demo payout — no money moves")).toBeVisible();
    await expect(dialog.getByTestId("payout-destination")).toHaveText("HDFC Bank ••••4321");
    const amount = dialog.getByLabel("Amount");
    await expect(amount).toHaveValue("28500");

    await amount.fill("50");
    await dialog.getByRole("button", { name: "Confirm withdrawal" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Minimum withdrawal is ₹100");

    await amount.fill("10000");
    await dialog.getByRole("button", { name: "Confirm withdrawal" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Demo payout simulated — no money moved").first()).toBeVisible();
    await expect(available).toHaveText("₹18,500");
    const history = page.getByTestId("payout-history");
    await expect(history).toContainText("₹10,000");
    await expect(history).toContainText("HDFC Bank ••••4321");
    await expect(history).toContainText("Demo");
  });
});
