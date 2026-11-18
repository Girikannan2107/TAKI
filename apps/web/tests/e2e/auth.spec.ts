/**
 * T1 — auth flows through the real UI (Firebase Auth emulator OTP + FastAPI): signup per role, login, logout,
 * password reset, verified-phone-without-password resume, and the client guards (P3 §3.4, §3.5, §6.1).
 */
import type { Page } from "@playwright/test";
import * as A from "../support/e2e-api";
import { expect, loginUI, test } from "../support/e2e-fixtures";

async function enterOtp(page: Page, mobile: string) {
  await expect(page).toHaveURL(/\/auth\/verify-otp/);
  await expect(page.locator("#recaptcha-anchor")).toBeAttached();
  await expect(page.getByText(/dev otp/i)).toHaveCount(0);
  const code = await A.emulatorCode({ phone: `+91${mobile}` });
  await page.getByLabel("Digit 1 of 6").pressSequentially(code, { delay: 30 });
}

/** /auth/phone → OTP → /auth/create-password → submit. */
async function phoneOtpPassword(page: Page, mobile: string, submit: RegExp) {
  await expect(page).toHaveURL(/\/auth\/phone/);
  await expect(page.locator("#recaptcha-anchor")).toBeAttached();
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByRole("button", { name: "Send OTP" }).click();
  await enterOtp(page, mobile);
  await expect(page).toHaveURL(/\/auth\/create-password/, { timeout: 30_000 });
  await page.getByLabel(/^(new )?password$/i).fill(A.PASSWORD);
  await page.getByLabel("Confirm password").fill(A.PASSWORD);
  await page.getByRole("button", { name: submit }).click();
}

async function logoutViaMenu(page: Page) {
  await page.getByRole("button", { name: /account menu for/i }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/($|\?|auth\/login)/);
}

test.describe("signup with phone OTP", () => {
  test("customer: role select → details → OTP → password → dashboard", async ({ page }) => {
    const mobile = A.freshMobile();
    await page.goto("/signup");
    await page.getByRole("link", { name: /customer/i }).first().click();
    await expect(page).toHaveURL(/\/signup\/customer/);
    await page.getByLabel("Full name").fill("Kavya Raman");
    await page.getByLabel("Date of birth").fill("1994-03-02");
    await page.locator("#acceptTerms").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await phoneOtpPassword(page, mobile, /create customer account/i);
    await expect(page).toHaveURL(/\/customer\/dashboard/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: /kavya/i })).toBeVisible();
    // The new account logs in with phone + password.
    const acct = await A.login("customer", mobile);
    expect(acct.name).toBe("Kavya Raman");
  });

  test("customer under 18 is rejected on the details step", async ({ page }) => {
    await page.goto("/signup/customer");
    await page.getByLabel("Full name").fill("Young Person");
    const d = new Date();
    await page.getByLabel("Date of birth").fill(`${d.getFullYear() - 16}-01-01`);
    await page.locator("#acceptTerms").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/signup\/customer/);
    await expect(page.getByText(/18/).first()).toBeVisible();
  });

  test("agency: details with typed base town (E23 fallback) → OTP → verification onboarding", async ({ page }) => {
    const mobile = A.freshMobile();
    await page.goto("/signup/agency");
    await page.getByLabel("Owner name").fill("Arun Kumar");
    await page.getByLabel("Agency name").fill(`Kovai Travels ${mobile.slice(-4)}`);
    // No Maps browser key in e2e: the town is typed; the server geocodes it (E23) on signup.
    await page.getByLabel("Based in").fill("Coimbatore");
    await page.getByRole("group", { name: /how many vehicles/i }).getByText("1–5").click();
    await page.getByRole("group", { name: /states you cover/i }).getByText("Tamil Nadu").click();
    await page.locator("#acceptTerms").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await phoneOtpPassword(page, mobile, /create .*agency account/i);
    await expect(page).toHaveURL(/\/agency\/profile\/verification\?onboarding=1|\/agency\/dashboard/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("driver: invited by an agency → OTP → documents onboarding", async ({ page }) => {
    const agency = await A.signupAgency();
    const mobile = A.freshMobile();
    await A.api("/agency/driver-invites", { token: agency.token, json: { fullName: "Murugan Driver", phone: mobile } });
    await page.goto("/signup/driver");
    await page.getByLabel("Full name").fill("Murugan Driver");
    await page.getByLabel("Associated agency").selectOption({ label: "My agency added me (invite)" });
    await page.locator("#acceptTerms").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await phoneOtpPassword(page, mobile, /create driver account/i);
    await expect(page).toHaveURL(/\/driver\/(profile\/documents|dashboard)/, { timeout: 30_000 });
    const me = await A.login("driver", mobile);
    const profile = await A.api<any>("/driver/profile", { token: me.token });
    expect(JSON.stringify(profile)).toContain(agency.agencyId!);
  });

  test("an already registered number is told to log in", async ({ page }) => {
    const existing = await A.signupCustomer();
    await page.goto("/signup/customer");
    await page.getByLabel("Full name").fill("Someone Else");
    await page.getByLabel("Date of birth").fill("1990-01-01");
    await page.locator("#acceptTerms").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Mobile number").fill(existing.mobile);
    await page.getByRole("button", { name: "Send OTP" }).click();
    await enterOtp(page, existing.mobile);
    await expect(page.getByText(/already has an account|already registered/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: /log in/i }).first()).toBeVisible();
  });

  test("phone verified but no password yet: the next attempt resumes at create-password", async ({ page, browser }) => {
    const mobile = A.freshMobile();
    await page.goto("/signup/customer");
    await page.getByLabel("Full name").fill("Resume User");
    await page.getByLabel("Date of birth").fill("1991-07-07");
    await page.locator("#acceptTerms").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Mobile number").fill(mobile);
    await page.getByRole("button", { name: "Send OTP" }).click();
    await enterOtp(page, mobile);
    await expect(page).toHaveURL(/\/auth\/create-password/, { timeout: 30_000 });
    // Abandon. A dashboard must not open for an incomplete account.
    await page.goto("/customer/shipments");
    await expect(page).toHaveURL(/\/auth\/login|\/auth\/create-password/, { timeout: 20_000 });

    // Later, in a fresh browser: same signup again → OTP → create password → account exists.
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.goto("/signup/customer");
    await p2.getByLabel("Full name").fill("Resume User");
    await p2.getByLabel("Date of birth").fill("1991-07-07");
    await p2.locator("#acceptTerms").check();
    await p2.getByRole("button", { name: "Continue" }).click();
    await phoneOtpPassword(p2, mobile, /create customer account/i);
    await expect(p2).toHaveURL(/\/customer\/dashboard/, { timeout: 30_000 });
    await ctx.close();
  });
});

test.describe("login, logout, reset", () => {
  test("customer logs in, sees the account menu, logs out", async ({ page }) => {
    const c = await A.signupCustomer("Lakshmi Iyer");
    await loginUI(page, c, { expectPath: /\/customer\/dashboard/ });
    await page.getByRole("button", { name: /account menu for lakshmi iyer/i }).click();
    await expect(page.getByRole("menuitem", { name: "Profile" })).toHaveAttribute("href", "/customer/profile");
    await page.keyboard.press("Escape");
    await logoutViaMenu(page);
    await page.goto("/customer/shipments");
    await expect(page).toHaveURL(/\/auth\/login\?role=customer/);
  });

  test("wrong password shows a generic error; wrong role tab offers a switch", async ({ page, watch }) => {
    watch.allow(/401 POST .*\/auth\/login/, /status of 401/, /status of 403/, /403 POST .*\/auth\/login/);
    const agency = await A.signupAgency();
    await page.goto("/auth/login?role=agency");
    await page.getByLabel("Mobile number").fill(agency.mobile);
    await page.getByLabel("Password", { exact: true }).fill("Wrong1234pass");
    await page.getByRole("button", { name: /^log in$/i }).click();
    await expect(page.getByText(/incorrect|invalid/i).first()).toBeVisible();

    await page.goto("/auth/login?role=customer");
    await page.getByLabel("Mobile number").fill(agency.mobile);
    await page.getByLabel("Password", { exact: true }).fill(A.PASSWORD);
    await page.getByRole("button", { name: /^log in$/i }).click();
    const sw = page.getByRole("button", { name: /switch to .*login/i });
    await expect(sw).toBeVisible();
    await sw.click();
    await expect(page).toHaveURL(/role=agency/);
  });

  test("forgot password: OTP → new password → login with the new password", async ({ page }) => {
    const c = await A.signupCustomer();
    await page.goto("/auth/login?role=customer");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/auth\/phone\?.*flow=reset/);
    await page.getByLabel("Mobile number").fill(c.mobile);
    await page.getByRole("button", { name: "Send OTP" }).click();
    await enterOtp(page, c.mobile);
    await expect(page).toHaveURL(/\/auth\/create-password\?.*flow=reset/, { timeout: 30_000 });
    const newPw = "Fresh2026pass";
    await page.getByLabel("New password").fill(newPw);
    await page.getByLabel("Confirm password").fill(newPw);
    await page.getByRole("button", { name: "Save Password" }).click();
    await expect(page).toHaveURL(/\/customer\/dashboard|\/auth\/login/, { timeout: 30_000 });
    await A.login("customer", c.mobile, newPw);
    await expect(A.login("customer", c.mobile, A.PASSWORD)).rejects.toThrow(/401/);
  });

  test("admin login rejects a non-admin with a generic error", async ({ page, watch }) => {
    watch.allow(/40[13] POST .*\/auth\/login/, /status of 40[13]/);
    const c = await A.signupCustomer();
    await page.goto("/admin/login");
    await page.getByLabel("Mobile number").fill(c.mobile);
    await page.getByLabel("Password", { exact: true }).fill(c.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole("alert").filter({ hasText: /./ }).first()).toBeVisible();
    await expect(page.getByText(/customer/i)).toHaveCount(0);
  });
});

test.describe("guards", () => {
  test("signed out → role login with next (query kept) → back to the page after login", async ({ page }) => {
    const c = await A.signupCustomer();
    await page.goto("/customer/shipments?tab=delivered");
    await expect(page).toHaveURL(/\/auth\/login\?role=customer&next=%2Fcustomer%2Fshipments%3Ftab%3Ddelivered/);
    await page.getByLabel("Mobile number").fill(c.mobile);
    await page.getByLabel("Password", { exact: true }).fill(c.password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await expect(page).toHaveURL(/\/customer\/shipments\?tab=delivered/);
  });

  for (const [path, login] of [
    ["/agency/vehicles", /\/auth\/login\?role=agency&next=%2Fagency%2Fvehicles/],
    ["/driver/shipments", /\/auth\/login\?role=driver&next=%2Fdriver%2Fshipments/],
    ["/admin/payments", /\/admin\/login\?next=%2Fadmin%2Fpayments/],
  ] as const) {
    test(`signed out ${path} → ${login.source.split("\\?")[0].replace(/\\/g, "")}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(login);
    });
  }

  test("guests may browse the customer dashboard (quick ship) without a session", async ({ page }) => {
    await page.goto("/customer/dashboard");
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await expect(page.getByRole("region", { name: "Quick ship" })).toBeVisible();
  });

  test("wrong role → own dashboard with an info toast", async ({ page }) => {
    const c = await A.signupCustomer();
    await loginUI(page, c);
    await page.goto("/agency/dashboard");
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await expect(page.getByText(/signed in as a customer/i)).toBeVisible();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/customer\/dashboard/);
  });

  test("signed in on /auth/login → dashboard, unless ?switch=1", async ({ page }) => {
    const c = await A.signupCustomer();
    await loginUI(page, c);
    await page.goto("/auth/login?role=customer");
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await page.goto("/auth/login?role=customer&switch=1");
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByLabel("Mobile number")).toBeVisible();
  });

  test("open redirect ?next=//evil.com is ignored", async ({ page }) => {
    const c = await A.signupCustomer();
    await loginUI(page, c, { next: "//evil.com/x", expectPath: /localhost:\d+\/customer\/dashboard/ });
    expect(new URL(page.url()).host).toMatch(/^localhost:/);
  });
});
