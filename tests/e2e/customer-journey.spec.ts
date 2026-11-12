/**
 * T2 — Customer journey (Phase 3). Real-UI end-to-end flow plus invalid/edge cases.
 * Run: E2E_PORT=3100 npx playwright test tests/e2e/customer-journey.spec.ts --project=desktop --workers=1
 * The happy path also runs on the mobile project (390×844): add `--project=mobile -g "happy path"`.
 */
import { expect, test, type Page } from "@playwright/test";
import { acceptAsDemoDriver, requestAcceptAndOpenPayment } from "./booking-flow";

const DAY = 864e5;
const DEMO_PASSWORD = "Taki@2025";
const ARJUN = "9876543210";
const RAVI = "9876543211";

/** IST calendar date `days` from now ("YYYY-MM-DD"). */
function istDate(days: number): string {
  return new Date(Date.now() + 5.5 * 3600e3 + days * DAY).toISOString().slice(0, 10);
}

/** A fresh 98765 0xxxx number (seeded demo numbers are 98765 432xx / 90000 xxxxx). */
function freshMobile(): string {
  return "987650" + String(Math.floor(Math.random() * 1e4)).padStart(4, "0");
}

/** Collects console errors, page errors and failed same-origin requests (G-8). */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[console] ${page.url()} :: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${page.url()} :: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().startsWith("http://localhost")) errors.push(`[http ${r.status()}] ${r.url()}`);
  });
  return errors;
}

/** Signup through the real UI starting at the phone step. Returns the mobile used. */
async function signupFromPhone(page: Page, fullName: string, mobile = freshMobile()) {
  await expect(page).toHaveURL(/\/auth\/phone\?.*role=customer/);
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByRole("button", { name: "Send OTP" }).click();
  await expect(page).toHaveURL(/\/auth\/verify-otp/);
  const code = (await page.getByTestId("demo-otp-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel("Digit 1 of 6").click();
  await page.keyboard.type(code); // auto-submits on the 6th digit; Verify kept for the explicit click path
  await expect(page).toHaveURL(/\/auth\/create-password/, { timeout: 15_000 });
  await page.getByLabel("Full name").fill(fullName);
  await page.getByLabel("Password", { exact: true }).fill("Secure123");
  await page.getByLabel("Confirm password", { exact: true }).fill("Secure123");
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page).toHaveURL(/\/customer\/dashboard/, { timeout: 15_000 });
  return mobile;
}

async function signupCustomer(page: Page, fullName: string) {
  await page.goto("/auth/phone?flow=signup&role=customer");
  return signupFromPhone(page, fullName);
}

async function login(page: Page, mobile: string, password = DEMO_PASSWORD, path = "/auth/login") {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log In" }).click();
}

/** Log out via the sidebar (desktop) or the menu drawer (below 1024px). */
async function logoutViaSidebar(page: Page) {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Log out", exact: true }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/$/);
}

async function searchFromDashboard(page: Page, opts: { from?: string; to?: string; weight: string; date?: string }) {
  if (opts.from) await page.getByLabel("Source", { exact: true }).selectOption(opts.from);
  if (opts.to) await page.getByLabel("Destination", { exact: true }).selectOption(opts.to);
  await page.getByLabel("Cargo Weight", { exact: true }).fill(opts.weight);
  await page.getByLabel("Pickup Date", { exact: true }).fill(opts.date ?? istDate(1));
  await page.getByRole("button", { name: /Find Available Vehicles/ }).click();
}

/** Logged-in Arjun → search 500 kg tomorrow → Raj → Request → (demo) driver accepts → payment page. Returns booking id. */
async function arjunToPayment(page: Page): Promise<string> {
  await login(page, ARJUN);
  await expect(page).toHaveURL(/\/customer\/dashboard/);
  await searchFromDashboard(page, { from: "coimbatore", to: "chennai", weight: "500" });
  await expect(page.getByTestId("vehicle-card")).toHaveCount(3);
  await page.getByTestId("vehicle-card").filter({ hasText: "Raj Transport" }).getByRole("link", { name: /View & Select/ }).click();
  return requestAcceptAndOpenPayment(page);
}

async function paymentRows(page: Page, bookingId: string) {
  await page.goto("/customer/payments");
  await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
  return page.locator(`[data-testid="payment-row"][data-booking-id="${bookingId}"]`);
}

/** Bookings for this id visible in My Shipments (any tab), counted from the persisted store. */
async function storedBookingCount(page: Page, bookingId: string) {
  return page.evaluate((id) => {
    const raw = localStorage.getItem("taki-demo-v1") ?? "";
    return raw.split(`"id":"${id}"`).length - 1;
  }, bookingId);
}

/** Demo-honesty scan: no claims of a sent SMS, a real charge or live GPS. Returns offending snippets. */
async function honestyViolations(page: Page): Promise<string[]> {
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const patterns = [
    /(?<!no )(?<!not )\b(SMS|OTP|code)\b (has been |was )?sent(?! to)/i,
    /(?<!no SMS is )sent (an? )?(SMS|OTP|text)/i,
    /code (has been |was )?sent to/i,
    /(?<!not )(?<!no )live (GPS|tracking|location)/i,
    /real[- ]time/i,
    /(?<!no )money (has been |was )?(debited|deducted|charged)/i,
    /payment (was )?successful(?! \(demo\))/i,
  ];
  const hits: string[] = [];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) hits.push(`${page.url()} :: "${text.slice(Math.max(0, m.index! - 40), m.index! + 60)}"`);
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------

test.describe("customer journey — happy path", () => {
  test("happy path: landing → signup → search → book → pay → confirm → track → driver sees it", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    const honesty: string[] = [];
    const isMobile = (page.viewportSize()?.width ?? 1440) < 768;

    // Landing → Ship Goods → public search (guest) → sign up → role selection → customer
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your goods. Their route.");
    honesty.push(...(await honestyViolations(page)));
    await page.getByRole("link", { name: /Ship Goods/ }).first().click();
    await expect(page).toHaveURL(/\/customer\/dashboard$/);
    await expect(page.getByRole("form", { name: "New shipment" })).toBeVisible();
    await page.goto("/signup?role=customer");
    await expect(page.getByRole("heading", { level: 1, name: "Join TAKI Travel" })).toBeVisible();
    await page.getByRole("link", { name: /I'm a Customer/ }).click();

    // Phone → OTP → create password (the OTP page is checked for honest copy before entering the code)
    const mobile = freshMobile();
    await page.getByLabel("Mobile number").fill(mobile);
    honesty.push(...(await honestyViolations(page)));
    await page.getByRole("button", { name: "Send OTP" }).click();
    await expect(page).toHaveURL(/\/auth\/verify-otp/);
    await expect(page.getByText(`+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`)).toBeVisible();
    honesty.push(...(await honestyViolations(page)));
    const code = (await page.getByTestId("demo-otp-code").textContent())!.trim();
    expect(code).toMatch(/^\d{6}$/);
    // Type 5 digits, then the 6th — the form auto-submits; Verify is the explicit fallback.
    await page.getByLabel("Digit 1 of 6").click();
    await page.keyboard.type(code.slice(0, 5));
    await expect(page.getByRole("button", { name: "Verify" })).toBeDisabled();
    await page.keyboard.type(code.slice(5));
    await expect(page).toHaveURL(/\/auth\/create-password/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Create a Password" })).toBeVisible();
    await page.getByLabel("Full name").fill("Priya Raman");
    await page.getByLabel("Password", { exact: true }).fill("Secure123");
    await page.getByLabel("Confirm password", { exact: true }).fill("Secure123");
    await page.getByRole("button", { name: "Create Account" }).click();

    // Dashboard: greeting with the new name
    await expect(page).toHaveURL(/\/customer\/dashboard/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hi, Priya");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hi, Priya");
    await expect(page).toHaveURL(/\/customer\/dashboard/);

    // Search
    await searchFromDashboard(page, { from: "coimbatore", to: "chennai", weight: "500" });
    await expect(page).toHaveURL(new RegExp(`/customer/vehicles\\?from=coimbatore&to=chennai&weight=500&date=${istDate(1)}&cargo=general_goods`));
    const cards = page.getByTestId("vehicle-card");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Available Vehicles (3)");
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText("₹4,850");
    await expect(cards.nth(1)).toContainText("₹5,200");
    await expect(cards.nth(2)).toContainText("₹5,450");
    await page.reload();
    await expect(cards).toHaveCount(3);
    const raj = cards.filter({ hasText: "Raj Transport" });
    await expect(raj).toContainText("₹4,850");
    await raj.getByRole("link", { name: /View & Select/ }).click();

    // Booking details: same vehicle, route, price
    await expect(page).toHaveURL(/\/customer\/booking\/rte_r1$/);
    await expect(page.getByRole("heading", { level: 1, name: "Route & Booking Details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Raj Transport" })).toBeVisible();
    await expect(page.getByTestId("route-line")).toHaveText("Route: Coimbatore → Salem → Vellore → Chennai");
    await expect(page.getByTestId("price-total")).toHaveText("₹4,850");
    honesty.push(...(await honestyViolations(page)));
    await page.reload();
    await expect(page.getByTestId("price-total")).toHaveText("₹4,850");
    await page.getByRole("button", { name: "Request Booking", exact: true }).click();

    // Request sent → tracking (awaiting driver, nothing paid) → driver accepts (demo) → final price → payment
    await page.waitForURL(/\/customer\/tracking\/TAKI\d{6}/);
    const bookingId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
    const current = page.locator('[data-testid="timeline-step"][aria-current="step"]');
    await expect(current).toContainText(/awaiting driver/i);
    honesty.push(...(await honestyViolations(page)));
    await page.reload();
    await expect(current).toContainText(/awaiting driver/i);
    await acceptAsDemoDriver(page);
    await page.getByRole("link", { name: "Complete payment" }).click();

    // Payment
    await page.waitForURL(/\/customer\/payment\?bookingId=TAKI\d{6}/);
    expect(new URL(page.url()).searchParams.get("bookingId")).toBe(bookingId);
    await expect(page.getByRole("heading", { level: 1, name: "Payment" })).toBeVisible();
    await expect(page.getByText("₹4,500", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("₹350", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("price-total")).toHaveText("₹4,850");
    honesty.push(...(await honestyViolations(page)));
    await page.reload();
    await expect(page.getByTestId("price-total")).toHaveText("₹4,850");
    await page.getByRole("radio", { name: "UPI (GPay, PhonePe, Paytm)" }).check();
    await page.getByRole("button", { name: "Pay ₹4,850" }).click();

    // Confirmation
    await page.waitForURL(new RegExp(`/customer/booking-confirmation\\?bookingId=${bookingId}`));
    await expect(page.getByRole("heading", { level: 1, name: "Booking placed!" })).toBeVisible();
    await expect(page.getByTestId("booking-id")).toHaveText(bookingId);
    await expect(page.getByTestId("booking-status")).toHaveText("Booking Confirmed");
    honesty.push(...(await honestyViolations(page)));
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Booking placed!" })).toBeVisible();
    await page.getByRole("link", { name: /Track Shipment/ }).click();

    // Tracking: Booking Confirmed + pickup / delivery verification codes
    await page.waitForURL(new RegExp(`/customer/tracking/${bookingId}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Track Shipment" })).toBeVisible();
    await expect(current).toContainText("Booking Confirmed");
    await expect(page.getByTestId("pickup-otp")).toHaveText(/^\d{6}$/);
    honesty.push(...(await honestyViolations(page)));
    await expect(page.getByTestId("tracking-status")).toHaveText("Booking Confirmed");
    await page.reload();
    await expect(page.getByTestId("tracking-status")).toHaveText("Booking Confirmed");

    // My Shipments + Payments
    await page.goto("/customer/shipments");
    await expect(page.getByRole("link", { name: new RegExp(bookingId) }).first()).toBeVisible();
    const rows = await paymentRows(page, bookingId);
    const anyRows = page.locator(`[data-booking-id="${bookingId}"]`).filter({ visible: true });
    await expect(anyRows).toHaveCount(1);
    await expect(anyRows.first()).toContainText("₹4,850");
    if (!isMobile) await expect(rows).toHaveCount(1);
    honesty.push(...(await honestyViolations(page)));

    // Driver Ravi sees the same booking (accepted via the demo simulation)
    await logoutViaSidebar(page);
    await login(page, RAVI);
    await expect(page).toHaveURL(/\/driver\/dashboard/, { timeout: 15_000 });
    await page.goto("/driver/bookings?tab=accepted");
    const card = page.locator(`[data-testid="booking-request-card"][data-booking-id="${bookingId}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("Coimbatore → Chennai");
    await expect(card).toContainText("Customer: Priya R.");

    expect(honesty, honesty.join("\n")).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("customer journey — login and resume", () => {
  test("demo customer login lands on the dashboard", async ({ page }) => {
    const errors = watchConsole(page);
    await login(page, ARJUN);
    await expect(page).toHaveURL(/\/customer\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hi, Arjun");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("guest searches and compares; Request Booking asks to log in and returns to the same vehicle", async ({ page }) => {
    await page.goto("/customer/dashboard");
    await expect(page.getByRole("link", { name: "Log in" }).first()).toBeVisible();
    await searchFromDashboard(page, { from: "coimbatore", to: "chennai", weight: "500" });
    await expect(page.getByTestId("vehicle-card")).toHaveCount(3);
    await page.getByTestId("vehicle-card").filter({ hasText: "Raj Transport" }).getByRole("link", { name: /View & Select/ }).click();
    await expect(page).toHaveURL(/\/customer\/booking\/rte_r1$/);
    await expect(page.getByTestId("price-total")).toHaveText("₹4,850");
    await page.getByRole("button", { name: "Log in to Request Booking" }).click();
    await expect(page).toHaveURL(/\/auth\/login\?next=%2Fcustomer%2Fbooking%2Frte_r1/);
    await page.getByLabel("Mobile number").fill(ARJUN);
    await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page).toHaveURL(/\/customer\/booking\/rte_r1$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Route & Booking Details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Raj Transport" })).toBeVisible();
    await expect(page.getByTestId("price-total")).toHaveText("₹4,850");
    await expect(page.getByRole("button", { name: "Request Booking", exact: true })).toBeEnabled();
  });

  test("protected URL while logged out → login?next → back to that URL", async ({ page }) => {
    await page.goto("/customer/shipments");
    await expect(page).toHaveURL(/\/auth\/login\?next=%2Fcustomer%2Fshipments/);
    await page.getByLabel("Mobile number").fill(ARJUN);
    await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page).toHaveURL(/\/customer\/shipments$/, { timeout: 15_000 });
  });

  test("booking resume after session expiry: search kept → login → Request Booking enabled", async ({ page }) => {
    await login(page, ARJUN);
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await searchFromDashboard(page, { from: "coimbatore", to: "chennai", weight: "500" });
    await page.getByTestId("vehicle-card").filter({ hasText: "Raj Transport" }).getByRole("link", { name: /View & Select/ }).click();
    await expect(page).toHaveURL(/\/customer\/booking\/rte_r1$/);
    // Expire the demo session (customer-flow §14: "Session expired mid-flow → login with next; pending booking retained").
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("taki-demo-v1")!);
      s.state.session.expiresAt = new Date(Date.now() - 60_000).toISOString();
      localStorage.setItem("taki-demo-v1", JSON.stringify(s));
    });
    await page.reload();
    // The vehicle page stays open to guests; requesting asks for login and comes back here.
    await page.getByRole("button", { name: "Log in to Request Booking" }).click();
    await expect(page).toHaveURL(/\/auth\/login\?next=%2Fcustomer%2Fbooking%2Frte_r1/);
    await page.getByLabel("Mobile number").fill(ARJUN);
    await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page).toHaveURL(/\/customer\/booking\/rte_r1$/, { timeout: 15_000 });
    await expect(page.getByTestId("price-total")).toHaveText("₹4,850");
    await expect(page.getByRole("button", { name: "Request Booking", exact: true })).toBeEnabled();
  });

  test("deep link without a search: 'Enter shipment details' notice, dashboard link, no bookable Book (C-01 approved deviation)", async ({ page }) => {
    await login(page, ARJUN);
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await page.goto("/customer/booking/rte_r1");
    await expect(page.getByRole("heading", { level: 1, name: "Route & Booking Details" })).toBeVisible();
    // Lead decision (C-01): notice + dashboard link instead of the inline mini-form of route-contract §9.
    const notice = page.getByTestId("booking-no-search");
    await expect(notice).toContainText("Enter your shipment details to see the price for this vehicle");
    await expect(notice.getByRole("link", { name: "Enter shipment details" })).toHaveAttribute("href", "/customer/dashboard");
    // Book is either not rendered or disabled — never enabled without a search.
    await expect(page.locator("button:not([disabled])", { hasText: "Request Booking" })).toHaveCount(0);
    await expect(page.getByTestId("price-total")).toHaveCount(0);
  });

  test("protected payment URL with query keeps the query through login", async ({ page }) => {
    await page.goto("/customer/payments");
    await expect(page).toHaveURL(/\/auth\/login\?next=%2Fcustomer%2Fpayments/);
    await page.getByLabel("Mobile number").fill(ARJUN);
    await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page).toHaveURL(/\/customer\/payments$/, { timeout: 15_000 });
  });

  const evil = ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/driver/earnings", "%2F%2Fevil.example"];
  for (const next of evil) {
    test(`open redirect blocked: next=${next}`, async ({ page }) => {
      await login(page, ARJUN, DEMO_PASSWORD, `/auth/login?next=${encodeURIComponent(next)}`);
      await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/customer\/dashboard$/, { timeout: 15_000 });
    });
  }

  test("signed-in customer visiting /auth/login?next=//evil.example stays on site", async ({ page }) => {
    await login(page, ARJUN);
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await page.goto("/auth/login?next=//evil.example");
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/customer\/dashboard$/, { timeout: 15_000 });
  });
});

test.describe("customer journey — invalid auth input", () => {
  test("phone: empty, short, 0–5 start, letters, existing account", async ({ page }) => {
    await page.goto("/auth/phone?flow=signup&role=customer");
    const input = page.getByLabel("Mobile number");
    const send = page.getByRole("button", { name: "Send OTP" });
    await send.click();
    await expect(page.locator("#mobile-error")).toHaveText("Enter your mobile number");
    await expect(input).toHaveAttribute("aria-invalid", "true");

    await input.fill("98765");
    await send.click();
    await expect(page.getByText("Enter a valid 10-digit Indian mobile number")).toBeVisible();

    for (const n of ["0123456789", "5123456789"]) {
      await input.fill(n);
      await send.click();
      await expect(page.getByText("Enter a valid 10-digit Indian mobile number")).toBeVisible();
      await expect(page).toHaveURL(/\/auth\/phone/);
    }

    await input.fill("");
    await input.pressSequentially("abcdeFGHij");
    await expect(input).toHaveValue("");
    await input.pressSequentially("98a76b5");
    await expect(input).toHaveValue("98765");
    await expect(input).toHaveAttribute("maxlength", "10");

    await input.fill(ARJUN);
    await send.click();
    await expect(page.getByRole("alert").filter({ hasText: /already (has an account|exists for this number)/ })).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/phone/);
  });

  test("OTP: incomplete, wrong code + attempts left, resend cooldown, lockout", async ({ page }) => {
    await page.clock.install();
    await page.goto("/auth/phone?flow=signup&role=customer");
    await page.getByLabel("Mobile number").fill(freshMobile());
    await page.getByRole("button", { name: "Send OTP" }).click();
    await expect(page).toHaveURL(/\/auth\/verify-otp/);
    const code = (await page.getByTestId("demo-otp-code").textContent())!.trim();

    // Incomplete → Verify disabled
    await page.getByLabel("Digit 1 of 6").click();
    await page.keyboard.type("12");
    await expect(page.getByRole("button", { name: "Verify" })).toBeDisabled();
    // Non-digits rejected
    await page.keyboard.type("ab");
    await expect(page.getByLabel("Digit 3 of 6")).toHaveValue("");

    // Resend cooldown visible, no Resend button yet
    await expect(page.getByText(/Resend OTP in 00:[0-3]\d/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend OTP" })).toHaveCount(0);

    // Wrong code
    const wrong = code.split("").map((d) => String((Number(d) + 1) % 10)).join("");
    await page.getByLabel("Digit 1 of 6").click();
    await page.keyboard.press("Backspace");
    await page.getByLabel("Digit 1 of 6").fill("");
    await page.getByLabel("Digit 2 of 6").fill("");
    await page.getByLabel("Digit 1 of 6").click();
    await page.keyboard.type(wrong);
    await expect(page.getByText("Incorrect code. 4 attempts left.")).toBeVisible();
    await expect(page.getByLabel("Digit 1 of 6")).toHaveValue("");
    await expect(page).toHaveURL(/\/auth\/verify-otp/);

    // After the cooldown, Resend issues a new code
    await page.clock.fastForward("00:31");
    const resend = page.getByRole("button", { name: "Resend OTP" });
    await expect(resend).toBeVisible();
    await resend.click();
    await expect(page.getByText(/Resend OTP in 00:\d\d/)).toBeVisible();
    const code2 = (await page.getByTestId("demo-otp-code").textContent())!.trim();
    expect(code2).toMatch(/^\d{6}$/);

    // The old code is rejected once a new one is issued (unless identical by chance)
    if (code2 !== code) {
      await page.getByLabel("Digit 1 of 6").click();
      await page.keyboard.type(code);
      await expect(page.getByText(/Incorrect code\. \d attempts? left\./)).toBeVisible();
    }

    // Exhaust attempts → back to phone with a message
    const wrong2 = code2.split("").map((d) => String((Number(d) + 1) % 10)).join("");
    for (let i = 0; i < 6; i++) {
      if (!/verify-otp/.test(page.url())) break;
      const d1 = page.getByLabel("Digit 1 of 6");
      try {
        await expect(d1).toBeEnabled({ timeout: 3000 });
        await d1.click({ timeout: 3000 });
      } catch {
        break;
      }
      await page.keyboard.type(wrong2);
      await page.waitForTimeout(800);
    }
    await expect(page).toHaveURL(/\/auth\/phone/, { timeout: 10_000 });
    await expect(page.getByText("Too many incorrect attempts")).toBeVisible();
  });

  test("password rules, mismatch and name required", async ({ page }) => {
    await page.goto("/auth/phone?flow=signup&role=customer");
    await page.getByLabel("Mobile number").fill(freshMobile());
    await page.getByRole("button", { name: "Send OTP" }).click();
    const code = (await page.getByTestId("demo-otp-code").textContent())!.trim();
    await page.getByLabel("Digit 1 of 6").click();
    await page.keyboard.type(code);
    await expect(page).toHaveURL(/\/auth\/create-password/, { timeout: 15_000 });

    const create = page.getByRole("button", { name: "Create Account" });
    const pw = page.getByLabel("Password", { exact: true });
    const confirm = page.getByLabel("Confirm password", { exact: true });
    const rules = page.getByRole("list", { name: "Password rules" });
    await expect(rules).toContainText("At least 8 characters");
    await expect(rules).toContainText("One uppercase letter");
    await expect(rules).toContainText("One number");

    await create.click();
    await expect(page.getByText("Enter your full name")).toBeVisible();
    await expect(page.getByText("Enter a password")).toBeVisible();

    await page.getByLabel("Full name").fill("Q");
    for (const bad of ["short1A", "alllowercase1", "NoNumbersHere"]) {
      await pw.fill(bad);
      await confirm.fill(bad);
      await create.click();
      await expect(page.getByText("Your password doesn't meet all the rules below")).toBeVisible();
      await expect(page).toHaveURL(/\/auth\/create-password/);
    }
    await expect(page.getByText("Name must be at least 2 characters")).toBeVisible();

    await page.getByLabel("Full name").fill("Kumar S");
    await pw.fill("Secure123");
    await confirm.fill("Secure124");
    await create.click();
    await expect(page.getByText("Passwords don't match")).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/create-password/);

    // Show/hide toggle does not submit
    await page.getByRole("button", { name: "Show password" }).first().click();
    await expect(pw).toHaveAttribute("type", "text");
    await expect(page).toHaveURL(/\/auth\/create-password/);
  });

  test("direct visits to verify-otp / create-password without state redirect to phone", async ({ page }) => {
    await page.goto("/auth/verify-otp?flow=signup&role=customer");
    await expect(page).toHaveURL(/\/auth\/phone/);
    await page.goto("/auth/create-password?flow=signup&role=customer");
    await expect(page).toHaveURL(/\/auth\/phone/);
  });
});

test.describe("customer journey — shipment form and availability", () => {
  test("new customer: missing fields; same city; weight 0 / negative / > 25,000; past and far dates", async ({ page }) => {
    test.setTimeout(90_000);
    await signupCustomer(page, "Fields Tester");
    const find = page.getByRole("button", { name: /Find Available Vehicles/ });
    const weight = page.getByLabel("Cargo Weight", { exact: true });
    const date = page.getByLabel("Pickup Date", { exact: true });

    // A brand-new customer starts with an empty form (or a sensible default) — clear what can be cleared.
    await weight.fill("");
    await date.fill("");
    const fromValue = await page.getByLabel("Source", { exact: true }).inputValue();
    await find.click();
    if (fromValue === "") await expect(page.getByText("Select a source city")).toBeVisible();
    await expect(page.getByText("Enter the cargo weight")).toBeVisible();
    await expect(page.getByText(/Select a pickup date|Enter a valid date/)).toBeVisible();
    await expect(page).toHaveURL(/\/customer\/dashboard$/);

    await page.getByLabel("Source", { exact: true }).selectOption("chennai");
    await page.getByLabel("Destination", { exact: true }).selectOption("chennai");
    await find.click();
    await expect(page.getByText("Source and destination must be different").first()).toBeVisible();

    await page.getByLabel("Source", { exact: true }).selectOption("coimbatore");
    for (const [w, msg] of [
      ["0", /Weight must be between 10 kg and 25,000 kg/],
      ["-5", /Enter a number, e\.g\. 500/],
      ["25001", /Weight must be between 10 kg and 25,000 kg/],
      ["12.5", /Enter a whole number of kg/],
    ] as const) {
      await weight.fill(w);
      await find.click();
      await expect(page.getByText(msg)).toBeVisible();
      await expect(page).toHaveURL(/\/customer\/dashboard$/);
    }
    await weight.fill("500");
    await date.fill(istDate(-1));
    await find.click();
    await expect(page.getByText("Pickup date can't be in the past")).toBeVisible();
    await date.fill(istDate(90));
    await find.click();
    await expect(page.getByText(/Pickup date must be within the next \d+ days/)).toBeVisible();
    await expect(page).toHaveURL(/\/customer\/dashboard$/);

    // Tampered URL is re-validated on the vehicles page.
    await page.goto(`/customer/vehicles?from=coimbatore&to=chennai&weight=-500&date=${istDate(1)}`);
    await expect(page.getByRole("heading", { name: "Your search is incomplete" })).toBeVisible();
    await page.goto(`/customer/vehicles?from=coimbatore&to=chennai&weight=500&date=${istDate(-3)}`);
    await expect(page.getByRole("heading", { name: "Your search is incomplete" })).toBeVisible();
  });

  test("excess weight 2,500 kg: Raj and Sree not offered; booking page blocks Book", async ({ page }) => {
    await login(page, ARJUN);
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await searchFromDashboard(page, { from: "coimbatore", to: "chennai", weight: "2500" });
    const cards = page.getByTestId("vehicle-card");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Available Vehicles");
    await expect(cards.filter({ hasText: "Raj Transport" })).toHaveCount(0);
    await expect(cards.filter({ hasText: "Sree Travels" })).toHaveCount(0);
    // Kavin (3,000 kg) is the only vehicle with room
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Kavin Logistics");

    // Deep link to Raj with the 2,500 kg search → explained, Book disabled
    await page.goto("/customer/booking/rte_r1");
    await expect(page.getByTestId("offer-problem")).toContainText(/space/i);
    await expect(page.getByRole("button", { name: /Request Booking/ })).toBeDisabled();

    // 3,500 kg → nobody → empty state with capacity explanation
    await page.goto("/customer/dashboard");
    await searchFromDashboard(page, { from: "coimbatore", to: "chennai", weight: "3500" });
    await expect(page.getByRole("heading", { name: "No vehicles on this route yet" })).toBeVisible();
    await expect(page.getByText(/\d+ vehicles? on this route (don't|doesn't) have space for 3,500 kg/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Try next day/ })).toBeVisible();
  });
});

test.describe("customer journey — payment integrity", () => {
  test("unknown or missing bookingId on payment / confirmation shows not found", async ({ page }) => {
    const errors = watchConsole(page);
    await login(page, ARJUN);
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    for (const url of ["/customer/payment?bookingId=TAKI000000", "/customer/payment?bookingId=<script>", "/customer/payment"]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { name: "Booking not found" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Pay / })).toHaveCount(0);
    }
    await page.goto("/customer/booking-confirmation?bookingId=TAKI000000");
    await expect(page.getByRole("heading", { name: "Booking not found" })).toBeVisible();
    await page.goto("/customer/booking-confirmation");
    await expect(page.getByRole("heading", { name: "Booking not found" })).toBeVisible();
    await page.goto("/customer/tracking/TAKI000000");
    await expect(page.getByRole("heading", { name: "Shipment not found" })).toBeVisible();
    expect(errors.filter((e) => !e.includes("[http 404]")), errors.join("\n")).toEqual([]);
  });

  test("duplicate payment: rapid multi-click Pay → one payment row and one booking", async ({ page }) => {
    const bookingId = await arjunToPayment(page);
    const pay = page.getByRole("button", { name: "Pay ₹4,850" });
    await expect(pay).toBeEnabled();
    // Fire three synchronous clicks in one task (harsher than dblclick) …
    await pay.evaluate((el: HTMLButtonElement) => {
      el.click();
      el.click();
      el.click();
    });
    await page.waitForURL(/\/customer\/booking-confirmation\?bookingId=/);
    await expect(page.getByRole("heading", { level: 1, name: "Booking placed!" })).toBeVisible();
    const rows = await paymentRows(page, bookingId);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Paid");
    expect(await storedBookingCount(page, bookingId)).toBeGreaterThan(0);
    const bookings = await page.evaluate((id) => {
      const s = JSON.parse(localStorage.getItem("taki-demo-v1") ?? "{}");
      const db = s.state?.db ?? {};
      const list = Array.isArray(db.bookings) ? db.bookings : Object.values(db.bookings ?? {});
      const pays = Array.isArray(db.payments) ? db.payments : Object.values(db.payments ?? {});
      return {
        bookings: list.filter((b: { id: string }) => b.id === id).length,
        succeeded: pays.filter((p: { bookingId: string; status: string }) => p.bookingId === id && p.status === "succeeded").length,
      };
    }, bookingId);
    expect(bookings).toEqual({ bookings: 1, succeeded: 1 });
  });

  test("Net Banking via keyboard Enter ×2 → one payment, method recorded", async ({ page }) => {
    const bookingId = await arjunToPayment(page);
    await page.getByRole("radio", { name: "Net Banking" }).check();
    const pay = page.getByRole("button", { name: "Pay ₹4,850" });
    await pay.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForURL(/\/customer\/booking-confirmation\?bookingId=/);
    await expect(page.getByText("Net Banking").first()).toBeVisible();
    const rows = await paymentRows(page, bookingId);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Net Banking");
  });

  test("browser back from confirmation then Pay again → redirected, no second charge", async ({ page }) => {
    const bookingId = await arjunToPayment(page);
    await page.getByRole("button", { name: "Pay ₹4,850" }).click();
    await page.waitForURL(/\/customer\/booking-confirmation\?bookingId=/);
    await page.goBack();
    // Payment replaced itself with the confirmation, so Back skips it (request tracking page) or lands on the confirmation.
    await expect(page).toHaveURL(/\/customer\/(tracking\/TAKI\d{6}|booking-confirmation\?bookingId=)/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^Pay / })).toHaveCount(0);
    await page.goForward();
    await expect(page).toHaveURL(/\/customer\/booking-confirmation\?bookingId=/, { timeout: 10_000 });
    // Direct deep link to payment for a paid booking also redirects.
    await page.goto(`/customer/payment?bookingId=${bookingId}`);
    await expect(page).toHaveURL(/\/customer\/booking-confirmation\?bookingId=/, { timeout: 10_000 });
    const rows = await paymentRows(page, bookingId);
    await expect(rows).toHaveCount(1);
  });

  test("simulated failure → retry succeeds; one booking, one Paid + one Failed row", async ({ page }) => {
    const bookingId = await arjunToPayment(page);
    await page.getByRole("checkbox", { name: /Simulate a failed payment/ }).check();
    await page.getByRole("button", { name: "Pay ₹4,850" }).click();
    await expect(page.getByTestId("payment-error")).toBeVisible();
    await expect(page.getByTestId("payment-error")).toContainText(/failed/i);
    await expect(page).toHaveURL(/\/customer\/payment\?bookingId=/);
    // Reload while failed: still payable
    await page.reload();
    await page.getByRole("checkbox", { name: /Simulate a failed payment/ }).uncheck();
    await page.getByRole("button", { name: "Pay ₹4,850" }).click();
    await page.waitForURL(/\/customer\/booking-confirmation\?bookingId=/);
    const rows = await paymentRows(page, bookingId);
    await expect(rows.filter({ hasText: "Paid" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Failed" })).toHaveCount(1);
    await page.goto("/customer/shipments");
    await expect(page.getByRole("link", { name: new RegExp(bookingId) })).not.toHaveCount(0);
  });

  test("another customer's booking id → not found on tracking, payment and confirmation", async ({ page }) => {
    test.setTimeout(90_000);
    // Arjun's seeded bookings must be invisible to a different customer.
    await signupCustomer(page, "Other Customer");
    for (const id of ["TAKI874523", "TAKI874391"]) {
      await page.goto(`/customer/tracking/${id}`);
      await expect(page.getByRole("heading", { name: "Shipment not found" })).toBeVisible();
      await expect(page.getByText("Raj Transport")).toHaveCount(0);
      await page.goto(`/customer/payment?bookingId=${id}`);
      await expect(page.getByRole("heading", { name: "Booking not found" })).toBeVisible();
      await page.goto(`/customer/booking-confirmation?bookingId=${id}`);
      await expect(page.getByRole("heading", { name: "Booking not found" })).toBeVisible();
    }
    await page.goto("/customer/shipments");
    await expect(page.getByRole("link", { name: /TAKI874523/ })).toHaveCount(0);
    await page.goto("/customer/payments");
    await expect(page.locator('[data-booking-id="TAKI874523"]')).toHaveCount(0);
  });
});

test.describe("customer journey — booking lifecycle edges", () => {
  test("Request is idempotent: back from payment and Request again → same booking id", async ({ page }) => {
    const first = await arjunToPayment(page);
    await page.getByRole("link", { name: "Back to booking details" }).click();
    await expect(page).toHaveURL(/\/customer\/booking\/rte_r1$/);
    await page.getByRole("button", { name: "Request Booking", exact: true }).click();
    await page.waitForURL(/\/customer\/tracking\/TAKI\d{6}/);
    expect(new URL(page.url()).pathname.split("/").pop()).toBe(first);
  });

  test("unpaid booking: Complete payment from My Shipments, then Cancel booking", async ({ page }) => {
    const bookingId = await arjunToPayment(page);
    await page.goto("/customer/shipments");
    await page.getByRole("link", { name: new RegExp(`Complete payment.*${bookingId}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/customer/payment[?]bookingId=${bookingId}`));
    await page.getByRole("button", { name: "Cancel booking" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel this booking?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel booking" }).click();
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await page.goto(`/customer/payment?bookingId=${bookingId}`);
    await expect(page.getByRole("button", { name: /^Pay / })).toHaveCount(0);
    await page.goto("/customer/shipments?tab=cancelled");
    await expect(page.getByRole("link", { name: new RegExp(bookingId) }).first()).toBeVisible();
  });

  test("confirmation CTAs and the payment notification deep link", async ({ page }) => {
    const bookingId = await arjunToPayment(page);
    await page.getByRole("button", { name: "Pay ₹4,850" }).click();
    await page.waitForURL(/\/customer\/booking-confirmation\?bookingId=/);
    await expect(page.getByText(/Demo/).first()).toBeVisible();
    await page.getByRole("link", { name: "View my shipments" }).click();
    await expect(page).toHaveURL(/\/customer\/shipments/);
    await page.goBack();
    await page.getByRole("link", { name: "Book another shipment" }).click();
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await page.getByRole("button", { name: "Notifications" }).click();
    const link = page.locator(`a[href="/customer/tracking/${bookingId}"]`).filter({ visible: true }).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/customer/tracking/${bookingId}$`));
  });

  test("customer can cancel a paid, confirmed booking → refunded (customer-flow §12, C-02)", async ({ page }) => {
    const bookingId = await arjunToPayment(page);
    await page.getByRole("button", { name: "Pay ₹4,850" }).click();
    await page.waitForURL(/\/customer\/booking-confirmation\?bookingId=/);
    // Also offered on the confirmation page before departure.
    await expect(page.getByRole("button", { name: "Cancel booking" })).toBeVisible();
    await page.goto(`/customer/tracking/${bookingId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Track Shipment" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel booking" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel this booking?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByText("Booking cancelled — refund issued (demo)")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Booking cancelled" }).or(page.getByText("Booking cancelled", { exact: true })).first()).toBeVisible();
    await expect(page.getByText(/refunded/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel booking" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Demo: simulate next update" })).toHaveCount(0);
    const rows = await paymentRows(page, bookingId);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Refunded");
    await page.goto("/customer/shipments?tab=cancelled");
    await expect(page.getByRole("link", { name: new RegExp(bookingId) }).first()).toBeVisible();
  });

  test("accepted-but-unpaid booking can be cancelled from tracking; nothing is charged (C-02)", async ({ page }) => {
    const bookingId = await arjunToPayment(page);
    await page.goto(`/customer/tracking/${bookingId}`);
    await expect(page.getByTestId("tracking-status")).toHaveText("Accepted · Payment pending");
    await page.getByRole("button", { name: "Cancel booking" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel this booking?" });
    await expect(dialog).toContainText("No payment has been taken");
    await dialog.getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByText("Booking cancelled", { exact: true }).first()).toBeVisible();
    const rows = await paymentRows(page, bookingId);
    await expect(rows).toHaveCount(0);
  });
});

test.describe("customer journey — navigation, console and copy", () => {
  test("sidebar, header, back arrows and footer reach real pages without console errors", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    const honesty: string[] = [];
    const not404 = async () => {
      await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      honesty.push(...(await honestyViolations(page)));
    };

    // Public landing header + footer
    await page.goto("/");
    await not404();
    for (const [name, hash] of [["How it Works", "#how-it-works"], ["Benefits", "#benefits"], ["About", "#about"], ["Contact", "#contact"]]) {
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name }).click();
      await expect(page).toHaveURL(new RegExp(`${hash}$`));
      await expect(page.locator(hash)).toBeAttached();
    }
    const footer = page.getByRole("contentinfo");
    for (const [name, url] of [["Ship goods", /\/signup\?role=customer/], ["List a route", /\/signup\?role=driver/], ["Log in", /\/auth\/login/]] as const) {
      await page.goto("/");
      await footer.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
      await not404();
    }
    await page.goto("/");
    for (const link of await footer.getByRole("navigation", { name: "Footer" }).getByRole("link").all()) {
      const href = await link.getAttribute("href");
      expect(href).toMatch(/^\/(#[a-z-]+)?$/);
      if (href?.includes("#")) await expect(page.locator(href.slice(1))).toBeAttached();
    }

    // Customer shell
    await login(page, ARJUN);
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await not404();
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const [name, url, h1] of [
      ["My Shipments", /\/customer\/shipments/, "My Shipments"],
      ["Payments", /\/customer\/payments/, "Payments"],
      ["Profile", /\/customer\/profile/, /Profile/],
      ["Home", /\/customer\/dashboard/, /Hi, Arjun/],
    ] as const) {
      await nav.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(h1);
      await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
      await not404();
    }

    // Header: bell + account menu → Profile
    await page.getByRole("button", { name: "Notifications" }).click();
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Profile" }).click();
    await expect(page).toHaveURL(/\/customer\/profile/);
    await not404();

    // Back arrows through the flow
    await page.goto("/customer/dashboard");
    await page.getByRole("button", { name: /Find Available Vehicles/ }).click();
    await expect(page).toHaveURL(/\/customer\/vehicles/);
    await not404();
    await page.getByRole("link", { name: "Back to dashboard" }).click();
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await page.getByRole("button", { name: /Find Available Vehicles/ }).click();
    await page.getByTestId("vehicle-card").first().getByRole("link", { name: /View & Select/ }).click();
    await expect(page).toHaveURL(/\/customer\/booking\//);
    await not404();
    await page.getByRole("link", { name: "Back to available vehicles" }).click();
    await expect(page).toHaveURL(/\/customer\/vehicles\?/);
    await expect(page.getByTestId("vehicle-card")).toHaveCount(3);
    await page.getByTestId("vehicle-card").first().getByRole("link", { name: /View & Select/ }).click();
    await requestAcceptAndOpenPayment(page);
    await not404();
    await page.getByRole("link", { name: "Back to booking details" }).click();
    await expect(page).toHaveURL(/\/customer\/booking\//);
    await page.goto("/customer/tracking/TAKI874523");
    await not404();
    await page.getByRole("link", { name: "Back to my shipments" }).click();
    await expect(page).toHaveURL(/\/customer\/shipments/);

    // Shipments tabs and the Track link
    await page.getByRole("link", { name: /TAKI874523/ }).first().click();
    await expect(page).toHaveURL(/\/customer\/tracking\/TAKI874523/);
    await page.getByRole("button", { name: "View Route" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    honesty.push(...(await honestyViolations(page)));
    await page.keyboard.press("Escape");

    // Logo goes home (dashboard in the app shell)
    await page.getByRole("link", { name: "TAKI Travel home" }).first().click();
    await expect(page).toHaveURL(/\/customer\/dashboard|\/$/);

    // Unknown path → branded 404
    await page.goto("/customer/does-not-exist");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

    expect(honesty, honesty.join("\n")).toEqual([]);
    expect(errors.filter((e) => !e.includes("does-not-exist")), errors.join("\n")).toEqual([]);
  });

  test("customer visiting /driver/* is sent to the customer dashboard", async ({ page }) => {
    await login(page, ARJUN);
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await page.goto("/driver/bookings");
    await expect(page).toHaveURL(/\/customer\/dashboard/, { timeout: 10_000 });
  });
});
