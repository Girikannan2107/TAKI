import { expect, test, type Page } from "@playwright/test";

/** A fresh, unseeded mobile number (seeded demo numbers start 98765 / 90000). */
function randomMobile(): string {
  return "7" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
}

async function startSignup(page: Page, role: "customer" | "driver", mobile = randomMobile()) {
  await page.goto(`/signup?role=${role}`);
  await expect(page.getByRole("heading", { level: 1, name: "Join TAKI Travel" })).toBeVisible();
  await page.getByRole("link", { name: role === "customer" ? /I'm a Customer/ : /I'm a Lorry Driver/ }).click();
  await expect(page).toHaveURL(new RegExp(`/auth/phone\\?.*role=${role}`));
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByRole("button", { name: "Send OTP" }).click();
  await expect(page).toHaveURL(/\/auth\/verify-otp/);
  const code = (await page.getByTestId("demo-otp-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^\d{6}$/);
  return code;
}

async function enterOtp(page: Page, code: string) {
  await page.getByLabel("Digit 1 of 6").click();
  await page.keyboard.type(code);
}

test.describe("auth", () => {
  test("customer signs up via OTP and lands on the customer dashboard", async ({ page }) => {
    const code = await startSignup(page, "customer");
    await expect(page.getByRole("note").filter({ hasText: "Demo mode — no SMS is sent" })).toBeVisible();
    await enterOtp(page, code); // auto-submits on the 6th digit
    await expect(page).toHaveURL(/\/auth\/create-password/);
    await expect(page.getByRole("heading", { level: 1, name: "Create a Password" })).toBeVisible();
    await page.getByLabel("Full name").fill("Asha Devi");
    await page.getByLabel("Password", { exact: true }).fill("Secure123");
    await page.getByLabel("Confirm password", { exact: true }).fill("Secure123");
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page).toHaveURL(/\/customer\/dashboard/, { timeout: 15_000 });
  });

  test("demo driver logs in with password", async ({ page }) => {
    await page.goto("/auth/login");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
    await page.getByRole("button", { name: "Fill demo driver" }).click();
    await expect(page.getByLabel("Mobile number")).toHaveValue("9876543211");
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page).toHaveURL(/\/driver\/dashboard/, { timeout: 15_000 });
  });

  test("wrong password shows an inline error", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByLabel("Mobile number").fill("9876543210");
    await page.getByLabel("Password", { exact: true }).fill("Wrong12345");
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page.getByText("Mobile number or password is incorrect.")).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("invalid phone number is rejected", async ({ page }) => {
    await page.goto("/auth/phone?flow=signup&role=customer");
    const input = page.getByLabel("Mobile number");
    await page.getByRole("button", { name: "Send OTP" }).click();
    await expect(page.locator("#mobile-error")).toHaveText("Enter your mobile number");
    await input.fill("12345");
    await page.getByRole("button", { name: "Send OTP" }).click();
    await expect(page.getByText("Enter a valid 10-digit Indian mobile number")).toBeVisible();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await input.fill("5123456789");
    await expect(page.getByText("Enter a valid 10-digit Indian mobile number")).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/phone/);
  });

  test("signup without a role goes back to role selection", async ({ page }) => {
    await page.goto("/auth/phone?flow=signup");
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("verify page without a pending OTP redirects to the phone step", async ({ page }) => {
    await page.goto("/auth/verify-otp?flow=login");
    await expect(page).toHaveURL(/\/auth\/phone\?flow=login/);
  });

  test("wrong OTP shows attempts left", async ({ page }) => {
    const code = await startSignup(page, "driver");
    const wrong = code
      .split("")
      .map((d) => String((Number(d) + 1) % 10))
      .join("");
    await enterOtp(page, wrong);
    await expect(page.getByText("Incorrect code. 4 attempts left.")).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/verify-otp/);
    await expect(page.getByLabel("Digit 1 of 6")).toHaveValue("");
  });

  test("password mismatch blocks account creation", async ({ page }) => {
    const code = await startSignup(page, "driver");
    await enterOtp(page, code);
    await expect(page).toHaveURL(/\/auth\/create-password/);
    await expect(page.getByLabel("Business name")).toBeVisible();
    await page.getByLabel("Full name").fill("Mani Raj");
    await page.getByLabel("Password", { exact: true }).fill("Secure123");
    await page.getByLabel("Confirm password", { exact: true }).fill("Secure124");
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByText("Passwords don't match")).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/create-password/);
  });
});
