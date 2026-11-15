import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Hidden admin console (D1): staff sign-in, review queues, document view, verify / reject with a reason,
 * settlements. Each test that changes data creates its own pending agency through the API (Dev OTP),
 * so runs don't depend on, or disturb, the seeded records. Needs `npm run seed` for the admin account.
 */
const ADMIN = {
  phone: process.env.E2E_ADMIN_PHONE ?? "9000000001",
  password: process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_PASSWORD ?? "Taki@2026",
};
const CUSTOMER = { phone: process.env.E2E_CUSTOMER_PHONE ?? "9876543210", password: process.env.E2E_PASSWORD ?? "Taki@2026" };
const PASSWORD = "Sunrise2026";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0, 0, 0, 0]);
const PDF = Buffer.from("%PDF-1.4\n%e2e\n");

function randomMobile(): string {
  return "7" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
}

/** A PAN-shaped test number (letters + digits; never a real person's). */
function randomPan(): string {
  const L = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `${L()}${L()}${L()}P${L()}${String(Math.floor(Math.random() * 1e4)).padStart(4, "0")}${L()}`;
}

/** Signs up a travel agency via the API and uploads PAN + photo, so it is ready for review. */
async function createPendingAgency(api: APIRequestContext, baseURL: string, withDocuments = true): Promise<string> {
  const headers = { origin: baseURL };
  const phone = randomMobile();
  const agencyName = `E2E Review ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

  const districts = (await (await api.get("/api/geo/districts")).json()) as { items: Array<{ id: string; state: string }> };
  const district = districts.items[0]!;

  const send = await api.post("/api/auth/otp/send", { headers, data: { phone, role: "agency", purpose: "signup" } });
  expect(send.ok(), await send.text()).toBeTruthy();
  const challenge = (await send.json()) as { challengeId: string; devOtp?: { code: string } };
  expect(challenge.devOtp, "SMS_PROVIDER=dev must return a Dev OTP").toBeTruthy();

  const verify = await api.post("/api/auth/otp/verify", { headers, data: { challengeId: challenge.challengeId, code: challenge.devOtp!.code } });
  expect(verify.ok(), await verify.text()).toBeTruthy();
  const { proofToken } = (await verify.json()) as { proofToken: string };

  const signup = await api.post("/api/auth/signup/agency", {
    headers,
    data: {
      proofToken,
      ownerName: "Review Owner",
      agencyName,
      districtId: district.id,
      vehicleCountRange: "1-5",
      statesCovered: [district.state],
      acceptTerms: true,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    },
  });
  expect(signup.ok(), await signup.text()).toBeTruthy();

  if (withDocuments) {
    const doc = await api.put("/api/me/documents/pan", {
      headers,
      multipart: { number: randomPan(), file: { name: "pan.pdf", mimeType: "application/pdf", buffer: PDF } },
    });
    expect(doc.ok(), await doc.text()).toBeTruthy();
    const photo = await api.put("/api/me/photo", { headers, multipart: { photo: { name: "me.jpg", mimeType: "image/jpeg", buffer: JPEG } } });
    expect(photo.ok(), await photo.text()).toBeTruthy();
  }
  return agencyName;
}

async function adminLogin(page: Page) {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { level: 1, name: "TAKI admin" })).toBeVisible();
  await page.getByLabel("Mobile number").fill(ADMIN.phone);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

async function openAgency(page: Page, agencyName: string) {
  await page.goto("/admin/agencies?status=pending");
  await expect(page.getByRole("tab", { name: "Pending" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("link", { name: agencyName }).click();
  await expect(page.getByRole("heading", { level: 1, name: agencyName })).toBeVisible();
}

test.describe("admin sign-in", () => {
  test("is not linked from public pages and is not indexed", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
    await page.goto("/auth/login");
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
    await page.goto("/admin/login");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("guests are sent to the admin login; wrong credentials and non-admin accounts are refused", async ({ page }) => {
    await page.goto("/admin/agencies");
    await expect(page).toHaveURL(/\/admin\/login\?.*next=%2Fadmin%2Fagencies/);

    await page.getByLabel("Mobile number").fill(ADMIN.phone);
    await page.getByLabel("Password", { exact: true }).fill("Wrong12345");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Phone number or password is incorrect.")).toBeVisible();

    await page.getByLabel("Mobile number").fill(CUSTOMER.phone);
    await page.getByLabel("Password", { exact: true }).fill(CUSTOMER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("This account can't sign in here.")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("admin APIs refuse guests (401) and other roles (403)", async ({ playwright, baseURL }) => {
    const guest = await playwright.request.newContext({ baseURL });
    expect((await guest.get("/api/admin/overview")).status()).toBe(401);
    const login = await guest.post("/api/auth/login", {
      headers: { origin: baseURL! },
      data: { role: "customer", phone: CUSTOMER.phone, password: CUSTOMER.password },
    });
    expect(login.ok(), await login.text()).toBeTruthy();
    expect((await guest.get("/api/admin/overview")).status()).toBe(403);
    expect((await guest.get("/api/admin/agencies?status=pending")).status()).toBe(403);
    await guest.dispose();
  });

  test("admin signs in, sees the overview and returns to ?next", async ({ page }) => {
    await page.goto("/admin/settlements");
    await page.getByLabel("Mobile number").fill(ADMIN.phone);
    await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/admin\/settlements/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Settlements" })).toBeVisible();

    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Admin overview" })).toBeVisible();
    await expect(page.getByText("Agencies ready for review")).toBeVisible();
    await expect(page.getByText("Drivers ready for review")).toBeVisible();
  });
});

test.describe("verification", () => {
  test("verify an agency that uploaded its documents", async ({ page, playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL });
    const agencyName = await createPendingAgency(api, baseURL!);
    await api.dispose();

    await adminLogin(page);
    await openAgency(page, agencyName);
    // Masked number only; the file opens through the access-checked /api/files route.
    await expect(page.getByText(/X{4,}|•{4,}|\*{4,}/).first()).toBeVisible();
    const fileLink = page.getByRole("link", { name: "Open file" }).first();
    await expect(fileLink).toHaveAttribute("href", /\/api\/files\/fil_/);
    const file = await page.request.get((await fileLink.getAttribute("href"))!);
    expect(file.status()).toBe(200);

    await page.getByRole("button", { name: "Verify agency" }).click();
    await expect(page.getByText("Agency verified")).toBeVisible();
    await expect(page.getByRole("button", { name: "Verified" })).toBeDisabled();

    await page.goto("/admin/agencies?status=verified");
    await expect(page.getByRole("link", { name: agencyName })).toBeVisible();
  });

  test("reject an agency with a reason", async ({ page, playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL });
    const agencyName = await createPendingAgency(api, baseURL!);

    await adminLogin(page);
    await openAgency(page, agencyName);
    await page.getByRole("button", { name: "Reject…" }).click();
    const dialog = page.getByRole("dialog", { name: "Reject agency" });
    await dialog.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(dialog.getByText("Give a reason (at least 3 characters)")).toBeVisible();
    await dialog.getByLabel("Reason").fill("The PAN document is unreadable. Please upload a clearer scan.");
    await dialog.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(page.getByText("Marked as rejected")).toBeVisible();
    await expect(page.getByText("The PAN document is unreadable.", { exact: false })).toBeVisible();

    // The agency sees the reason on its own verification status.
    const me = (await (await api.get("/api/me/profile")).json()) as { verification?: { status: string; reason?: string } };
    expect(me.verification).toMatchObject({ status: "rejected", reason: expect.stringContaining("unreadable") });
    await api.dispose();

    await page.goto("/admin/agencies?status=rejected");
    await expect(page.getByRole("link", { name: agencyName })).toBeVisible();
  });

  test("an agency without documents can't be verified yet", async ({ page, playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL });
    const agencyName = await createPendingAgency(api, baseURL!, false);
    await api.dispose();

    await adminLogin(page);
    await openAgency(page, agencyName);
    await expect(page.getByText(/hasn't uploaded every document and photo yet/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify agency" })).toBeDisabled();
  });

  test("the drivers queue loads with status tabs", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/drivers");
    await expect(page.getByRole("heading", { level: 1, name: "Drivers" })).toBeVisible();
    await page.getByRole("tab", { name: "Verified" }).click();
    await expect(page).toHaveURL(/status=verified/);
    await expect(page.getByRole("tabpanel")).toBeVisible();
  });
});

test.describe("settlements", () => {
  test("lists agencies with pending earnings, or an empty state", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/settlements");
    await expect(page.getByRole("heading", { level: 1, name: "Settlements" })).toBeVisible();
    const markButtons = page.getByRole("button", { name: /^Mark settled/ });
    const empty = page.getByText(/Everything is settled|Settlements aren't available yet/);
    await expect(markButtons.first().or(empty)).toBeVisible();
  });

  test("marking settled needs a bank reference", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "Changes shared seed data; run once.");
    await adminLogin(page);
    await page.goto("/admin/settlements");
    const mark = page.getByRole("button", { name: /^Mark settled/ }).first();
    test.skip((await mark.count()) === 0, "No pending earnings in the seed.");
    await mark.click();
    const dialog = page.getByRole("dialog", { name: "Mark earnings settled" });
    await dialog.getByRole("button", { name: "Mark settled" }).click();
    await expect(dialog.getByLabel("Bank reference (UTR)")).toHaveAttribute("aria-invalid", "true");
    await dialog.getByLabel("Bank reference (UTR)").fill(`UTR${Date.now()}`);
    await dialog.getByRole("button", { name: "Mark settled" }).click();
    await expect(page.getByText("Settlement recorded")).toBeVisible();
  });
});
