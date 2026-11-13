import { expect, test, type Page } from "@playwright/test";

/**
 * v2 auth journeys (D1): role signup (details → phone → Dev OTP → password), one login page with role tabs,
 * password recovery, logout and the proxy gate. Needs `npm run seed` (demo accounts) and SMS_PROVIDER=dev.
 * Override the demo credentials with E2E_* env vars if the seed changes.
 */
const DEMO = {
  password: process.env.E2E_PASSWORD ?? "Taki@2026",
  customer: process.env.E2E_CUSTOMER_PHONE ?? "9876543210",
  agency: process.env.E2E_AGENCY_PHONE ?? "9876543220",
  driver: process.env.E2E_DRIVER_PHONE ?? "9876543211",
};
const NEW_PASSWORD = "Sunrise2026";

/** A fresh mobile number that the seed never uses (seed numbers start 98765 / 90000). */
function randomMobile(): string {
  return "7" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
}

/** Phone step → returns the Dev OTP shown on the verify screen. */
async function sendOtp(page: Page, mobile: string): Promise<string> {
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByRole("button", { name: "Send OTP" }).click();
  await expect(page).toHaveURL(/\/auth\/verify-otp/);
  await expect(page.getByTestId("dev-otp")).toContainText("Dev OTP");
  const code = (await page.getByTestId("dev-otp-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^\d{6}$/);
  return code;
}

async function enterOtp(page: Page, code: string) {
  await page.getByLabel("Digit 1 of 6").click();
  await page.keyboard.type(code); // auto-submits on the 6th digit
}

async function setPassword(page: Page, submit: RegExp | string, password = NEW_PASSWORD) {
  await expect(page).toHaveURL(/\/auth\/create-password/);
  await page.getByLabel(/^(New )?password$/i).first().fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: submit }).click();
}

async function customerDetails(page: Page, name = "Asha Devi", dob = "1990-05-01") {
  await page.goto("/signup/customer");
  await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Date of birth").fill(dob);
  await page.getByLabel(/I agree to the TAKI Terms/).check();
  await page.getByRole("button", { name: "Continue" }).click();
}

async function loginAs(page: Page, role: "Customer" | "Travel agency" | "Driver", mobile: string, password: string) {
  await page.goto("/auth/login");
  await page.getByRole("tab", { name: role }).click();
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log In" }).click();
}

test.describe("signup", () => {
  test("role selection offers the three account types", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { level: 1, name: "Join TAKI Travel" })).toBeVisible();
    await expect(page.getByRole("link", { name: /I'm a Customer/ })).toHaveAttribute("href", /\/signup\/customer/);
    await expect(page.getByRole("link", { name: /I'm a Travel Agency/ })).toHaveAttribute("href", /\/signup\/agency/);
    await expect(page.getByRole("link", { name: /I'm a Driver/ })).toHaveAttribute("href", /\/signup\/driver/);
  });

  test("customer: details → OTP → password lands on the dashboard, signed in", async ({ page }) => {
    await customerDetails(page);
    await expect(page).toHaveURL(/\/auth\/phone\?.*flow=signup.*role=customer/);
    const code = await sendOtp(page, randomMobile());
    await enterOtp(page, code);
    await setPassword(page, "Create Customer Account");
    await expect(page).toHaveURL(/\/customer\/dashboard/, { timeout: 15_000 });
    const me = await page.request.get("/api/me");
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ role: "customer", name: "Asha Devi" });
  });

  test("customer: under-18 date of birth is refused", async ({ page }) => {
    const year = new Date().getFullYear() - 17;
    await customerDetails(page, "Young Person", `${year}-01-01`);
    await expect(page.getByText(/18 or older/).first()).toBeVisible();
    await expect(page).toHaveURL(/\/signup\/customer/);
  });

  test("terms must be accepted", async ({ page }) => {
    await page.goto("/signup/customer");
    await page.getByLabel("Full name").fill("Asha Devi");
    await page.getByLabel("Date of birth").fill("1990-05-01");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Accept the Terms to continue")).toBeVisible();
  });

  test("agency: details → OTP → password lands on verification onboarding", async ({ page }) => {
    await page.goto("/signup/agency");
    await expect(page.getByRole("heading", { level: 1, name: "Register your agency" })).toBeVisible();
    await page.getByLabel("Owner name").fill("Kumar Selvam");
    await page.getByLabel("Agency name").fill(`E2E Travels ${Date.now() % 100000}`);
    await page.getByLabel("District").selectOption({ index: 1 });
    await page.getByRole("radio", { name: "6–10" }).check({ force: true });
    await page.getByLabel(/I agree to the TAKI Terms/).check();
    await page.getByRole("button", { name: "Continue" }).click();
    const code = await sendOtp(page, randomMobile());
    await enterOtp(page, code);
    await setPassword(page, "Create Travel agency Account");
    await expect(page).toHaveURL(/\/agency\/profile\/verification\?onboarding=1/, { timeout: 15_000 });
  });

  test("driver: invite choice without an invite asks them to choose an agency", async ({ page }) => {
    await page.goto("/signup/driver");
    await page.getByLabel("Full name").fill("Mani Raj");
    await page.getByLabel("Associated agency").selectOption({ label: "My agency added me (invite)" });
    await page.getByLabel(/I agree to the TAKI Terms/).check();
    await page.getByRole("button", { name: "Continue" }).click();
    const code = await sendOtp(page, randomMobile());
    await enterOtp(page, code);
    await expect(page.getByText("We couldn't find an invite for this number.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Create Driver Account/ })).toBeDisabled();
  });

  test("a registered number can't sign up again", async ({ page }) => {
    await customerDetails(page);
    await page.getByLabel("Mobile number").fill(DEMO.customer);
    await page.getByRole("button", { name: "Send OTP" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "This number is already registered" })).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/phone/);
  });

  test("a wrong OTP shows the attempts left and clears the boxes", async ({ page }) => {
    await customerDetails(page);
    const code = await sendOtp(page, randomMobile());
    const wrong = code
      .split("")
      .map((d) => String((Number(d) + 1) % 10))
      .join("");
    await enterOtp(page, wrong);
    await expect(page.getByText("That code is incorrect. 4 attempts left.")).toBeVisible();
    await expect(page.getByLabel("Digit 1 of 6")).toHaveValue("");
    await expect(page).toHaveURL(/\/auth\/verify-otp/);
  });

  test("mismatched passwords block account creation", async ({ page }) => {
    await customerDetails(page);
    await enterOtp(page, await sendOtp(page, randomMobile()));
    await expect(page).toHaveURL(/\/auth\/create-password/);
    await page.getByLabel("Password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm password", { exact: true }).fill(NEW_PASSWORD + "x");
    await page.getByRole("button", { name: "Create Customer Account" }).click();
    await expect(page.getByText("Passwords don't match")).toBeVisible();
  });

  test("the phone step without signup details goes back to the details form", async ({ page }) => {
    await page.goto("/auth/phone?flow=signup&role=agency");
    await expect(page).toHaveURL(/\/signup\/agency/);
  });

  test("an invalid mobile number is rejected", async ({ page }) => {
    await page.goto("/auth/phone?flow=reset&role=customer");
    await page.getByLabel("Mobile number").fill("5123456789");
    await page.getByRole("button", { name: "Send OTP" }).click();
    await expect(page.getByText("Enter a valid 10-digit Indian mobile number")).toBeVisible();
    await expect(page.getByLabel("Mobile number")).toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("login", () => {
  test("one page with role tabs synced to ?role", async ({ page }) => {
    await page.goto("/auth/login?role=driver");
    await expect(page.getByRole("tab", { name: "Driver" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { level: 1, name: "Driver login" })).toBeVisible();
    await page.getByRole("tab", { name: "Travel agency" }).click();
    await expect(page).toHaveURL(/role=agency/);
    await expect(page.getByRole("heading", { level: 1, name: "Travel agency login" })).toBeVisible();
  });

  test("customer logs in and lands on the dashboard; logout ends the session", async ({ page }) => {
    await loginAs(page, "Customer", DEMO.customer, DEMO.password);
    await expect(page).toHaveURL(/\/customer\/dashboard/, { timeout: 15_000 });
    expect((await page.request.get("/api/me")).status()).toBe(200);

    await page.getByRole("button", { name: /account menu|profile menu/i }).first().click();
    await page.getByRole("menuitem", { name: /Log out/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("You've been logged out")).toBeVisible();
    expect((await page.request.get("/api/me")).status()).toBe(401);
  });

  test("driver and agency land on their own dashboards", async ({ page }) => {
    await loginAs(page, "Driver", DEMO.driver, DEMO.password);
    await expect(page).toHaveURL(/\/driver\//, { timeout: 15_000 });
    await page.context().clearCookies();
    await loginAs(page, "Travel agency", DEMO.agency, DEMO.password);
    await expect(page).toHaveURL(/\/agency\/dashboard/, { timeout: 15_000 });
  });

  test("a wrong password shows a generic error", async ({ page }) => {
    await loginAs(page, "Customer", DEMO.customer, "Wrong12345");
    await expect(page.getByText("Phone number or password is incorrect.")).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("the wrong role tab offers to switch after a correct password", async ({ page }) => {
    await loginAs(page, "Driver", DEMO.customer, DEMO.password);
    const alert = page.getByRole("alert").filter({ hasText: "registered as a Customer account" });
    await expect(alert).toBeVisible();
    await alert.getByRole("button", { name: "Switch to Customer login" }).click();
    await expect(page.getByRole("tab", { name: "Customer" })).toHaveAttribute("aria-selected", "true");
  });

  test("an admin number can't sign in on the public page", async ({ page }) => {
    const admin = process.env.E2E_ADMIN_PHONE ?? "9000000001";
    await loginAs(page, "Customer", admin, DEMO.password);
    await expect(page.getByText("This number can't sign in here.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Switch to/ })).toHaveCount(0);
  });

  test("?next is honoured after login and open redirects are ignored", async ({ page }) => {
    await page.goto("/auth/login?role=customer&next=%2Fcustomer%2Fshipments");
    await page.getByLabel("Mobile number").fill(DEMO.customer);
    await page.getByLabel("Password", { exact: true }).fill(DEMO.password);
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page).toHaveURL(/\/customer\/shipments/, { timeout: 15_000 });

    await page.context().clearCookies();
    await page.goto("/auth/login?role=customer&next=https%3A%2F%2Fevil.example");
    await page.getByLabel("Mobile number").fill(DEMO.customer);
    await page.getByLabel("Password", { exact: true }).fill(DEMO.password);
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page).toHaveURL(/\/customer\/dashboard/, { timeout: 15_000 });
  });
});

test("a guest's chosen vehicle survives login (?next keeps its full query string)", async ({ page }) => {
  const deep = "/customer/shipments/new?from=A%26B%20Nagar&to=Chennai&weight=500&cargo=general&trip=trp_e2e";
  await page.goto(`/auth/login?role=customer&next=${encodeURIComponent(deep)}`);
  await page.getByLabel("Mobile number").fill(DEMO.customer);
  await page.getByLabel("Password", { exact: true }).fill(DEMO.password);
  await page.getByRole("button", { name: "Log In" }).click();
  await expect(page).toHaveURL(/\/customer\/shipments\/new\?/, { timeout: 15_000 });
  const url = new URL(page.url());
  expect(url.searchParams.get("from")).toBe("A&B Nagar");
  expect(url.searchParams.get("trip")).toBe("trp_e2e");
  expect(url.searchParams.get("weight")).toBe("500");
});

test.describe("recovery", () => {
  test("forgot password: OTP → new password → log in with it; the old one stops working", async ({ page }) => {
    // Fresh account so the shared demo password never changes.
    const mobile = randomMobile();
    await customerDetails(page, "Reset Tester");
    await enterOtp(page, await sendOtp(page, mobile));
    await setPassword(page, "Create Customer Account");
    await expect(page).toHaveURL(/\/customer\/dashboard/, { timeout: 15_000 });
    await page.context().clearCookies();

    await page.goto("/auth/login?role=customer");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Reset your password" })).toBeVisible();
    await enterOtp(page, await sendOtp(page, mobile));
    await setPassword(page, "Save Password", "Moonrise2027");
    await expect(page).toHaveURL(/\/auth\/login\?.*role=customer/, { timeout: 15_000 });
    await expect(page.getByText("Password updated")).toBeVisible();

    await loginAs(page, "Customer", mobile, NEW_PASSWORD);
    await expect(page.getByText("Phone number or password is incorrect.")).toBeVisible();
    await loginAs(page, "Customer", mobile, "Moonrise2027");
    await expect(page).toHaveURL(/\/customer\/dashboard/, { timeout: 15_000 });
  });
});

test.describe("route gate (proxy)", () => {
  test("guests are sent to the right login with ?next", async ({ page }) => {
    await page.goto("/customer/shipments");
    await expect(page).toHaveURL(/\/auth\/login\?.*role=customer.*next=%2Fcustomer%2Fshipments/);
    await page.goto("/agency/dashboard");
    await expect(page).toHaveURL(/\/auth\/login\?.*role=agency/);
    await page.goto("/driver/dashboard");
    await expect(page).toHaveURL(/\/auth\/login\?.*role=driver/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("guests can browse the public customer search", async ({ page }) => {
    await page.goto("/customer/vehicles");
    await expect(page).toHaveURL(/\/customer\/vehicles/);
  });

  test("a signed-in user is kept out of other roles' sections and off the auth pages", async ({ page }) => {
    await loginAs(page, "Customer", DEMO.customer, DEMO.password);
    await expect(page).toHaveURL(/\/customer\/dashboard/, { timeout: 15_000 });
    await page.goto("/agency/dashboard");
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await page.goto("/auth/login");
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await page.goto("/auth/login?switch=1");
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("a forged session cookie is treated as signed out", async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "taki_session", value: "forged.value", url: baseURL! }]);
    await page.goto("/customer/shipments");
    await expect(page).toHaveURL(/\/auth\/login/);
    expect((await page.request.get("/api/me")).status()).toBe(401);
  });
});
